import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { getClosedCountries } from "@/lib/closed";

/** Owner-only guard shared by the admin endpoints. */
async function requireAdmin(req: Request): Promise<string | null> {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return null;
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isAdmin: true } });
  return me?.isAdmin ? payload.sub : null;
}

/** "2026-07" → [monthStart, nextMonthStart], or null for all-time. */
function monthWindow(period: string | null): { gte: Date; lt: Date } | null {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return null;
  const [y, m] = period.split("-").map(Number);
  if (m < 1 || m > 12) return null;
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

/** Every month from the first member's arrival to today — the Archive's picker. */
function monthsSince(first: Date | null): string[] {
  const out: string[] = [];
  const now = new Date();
  const start = first ?? now;
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  while (y < now.getUTCFullYear() || (y === now.getUTCFullYear() && m <= now.getUTCMonth())) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m += 1;
    if (m === 12) { m = 0; y += 1; }
  }
  return out.reverse(); // newest first
}

// GET /api/admin/stats?country=KW&period=2026-07 — the whole app at a glance.
// No country (or "all") = every country combined. No period (or "all") = since
// launch; "YYYY-MM" = only what happened inside that month (the monthly flow).
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const country = (url.searchParams.get("country") || "").trim().toUpperCase();
  const byCountry = country && country !== "ALL" ? country : null;
  const win = monthWindow(url.searchParams.get("period"));
  const W = win ? { createdAt: win } : {}; // spread into any where-clause to scope it to the month

  const userWhere = byCountry ? { country: byCountry } : {};
  const now = new Date();

  // Which users belong to the selected country — used to scope money/report queries.
  const scopedUserIds = byCountry
    ? (await prisma.user.findMany({ where: { country: byCountry }, select: { id: true } })).map((u) => u.id)
    : null;
  const inScope = (field: string) => (scopedUserIds ? { [field]: { in: scopedUserIds } } : {});

  const [
    totalUsers, newUsers, premiumUsers, businessUsers, suspendedUsers,
    subAgg, subCount,
    adAgg, adsCount, advertisers,
    jobsCount, jobPosters, jobApplyAgg,
    reportsOpen, reportsTotal,
    blockedPeople,
    countryGroups,
    firstUser,
  ] = await Promise.all([
    // membership counts are always the current snapshot…
    prisma.user.count({ where: userWhere }),
    // …while "new members" respects the selected month.
    prisma.user.count({ where: { ...userWhere, ...W } }),
    prisma.user.count({ where: { ...userWhere, isPremium: true } }),
    prisma.user.count({ where: { ...userWhere, accountType: "business" } }),
    prisma.user.count({ where: { ...userWhere, suspendedUntil: { gt: now } } }),
    // subscription revenue — payments recorded inside the window (fake gateway for now, real later)
    prisma.subscription.aggregate({ _sum: { amount: true }, where: { ...inScope("userId"), ...W } }),
    prisma.subscription.count({ where: { ...inScope("userId"), ...W } }),
    // ads have their own country on the ad itself
    prisma.ad.aggregate({ _sum: { price: true }, where: { ...(byCountry ? { country: byCountry } : {}), ...W } }),
    prisma.ad.count({ where: { ...(byCountry ? { country: byCountry } : {}), ...W } }),
    prisma.ad.groupBy({ by: ["userId"], where: { ...(byCountry ? { country: byCountry } : {}), ...W } }),
    prisma.job.count({ where: { ...(byCountry ? { country: byCountry } : {}), ...W } }),
    prisma.job.groupBy({ by: ["companyId"], where: { ...(byCountry ? { country: byCountry } : {}), ...W } }),
    // jobs revenue — posting fees + seeker-listing fees + any application fees, inside the window
    Promise.all([
      prisma.job.aggregate({ _sum: { cost: true }, where: { ...(byCountry ? { country: byCountry } : {}), ...W } }),
      prisma.jobSeeker.aggregate({ _sum: { cost: true }, where: { ...inScope("userId"), ...W } }),
      prisma.jobApplication.aggregate({ _sum: { cost: true }, where: { ...inScope("userId"), ...W } }),
    ]),
    prisma.report.count({ where: { status: "open", ...inScope("targetId"), ...W } }),
    prisma.report.count({ where: { ...inScope("targetId"), ...W } }),
    // people who were blocked by at least one other member (inside the window)
    prisma.block.groupBy({ by: ["targetId"], where: { ...inScope("targetId"), ...W } }),
    // which countries exist in the user base (for the dashboard's picker)
    prisma.user.groupBy({ by: ["country"], _count: { country: true } }),
    prisma.user.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);

  const closed = await getClosedCountries();

  return NextResponse.json({
    country: byCountry ?? "all",
    period: win ? url.searchParams.get("period") : "all",
    months: monthsSince(firstUser?.createdAt ?? null),
    stats: {
      totalUsers,
      newUsers,
      premiumUsers,
      businessUsers,
      suspendedUsers,
      subscriptionCount: subCount,
      subscriptionRevenue: subAgg._sum.amount ?? 0,
      adsCount,
      advertisers: advertisers.length,
      adRevenue: adAgg._sum.price ?? 0,
      jobsCount,
      jobPosters: jobPosters.length,
      jobRevenue:
        (jobApplyAgg[0]._sum.cost ?? 0) + (jobApplyAgg[1]._sum.cost ?? 0) + (jobApplyAgg[2]._sum.cost ?? 0),
      reportsOpen,
      reportsTotal,
      blockedPeople: blockedPeople.length,
    },
    countries: countryGroups
      .filter((g) => g.country)
      .map((g) => ({ code: g.country as string, users: g._count.country, closed: closed.has(g.country as string) }))
      .sort((a, b) => b.users - a.users),
  });
}
