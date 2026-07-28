import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

/** Owner/admin guard. */
async function requireAdmin(req: Request): Promise<string | null> {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return null;
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isAdmin: true } });
  return me?.isAdmin ? payload.sub : null;
}

/** "2026-07" → month window, or null for all-time. */
function monthWindow(period: string | null): { gte: Date; lt: Date } | null {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return null;
  const [y, m] = period.split("-").map(Number);
  if (m < 1 || m > 12) return null;
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

type Row = { id: string; title: string; subtitle?: string; meta?: string; userId?: string; suspended?: boolean };

// GET /api/admin/stat-list?kind=newUsers&country=&period= — the records behind a stat card.
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") || "";
  const country = (url.searchParams.get("country") || "").trim().toUpperCase();
  const byCountry = country && country !== "ALL" ? country : null;
  const win = monthWindow(url.searchParams.get("period"));
  const W = win ? { createdAt: win } : {};
  const now = new Date();
  const userWhere = byCountry ? { country: byCountry } : {};
  const scopedUserIds = byCountry
    ? (await prisma.user.findMany({ where: { country: byCountry }, select: { id: true } })).map((u) => u.id)
    : null;
  const inScope = (field: string) => (scopedUserIds ? { [field]: { in: scopedUserIds } } : {});

  const contact = (u: { email: string | null; phone: string | null }) => u.email ?? u.phone ?? "";
  const dateStr = (d: Date) => d.toISOString().slice(0, 10);

  let rows: Row[] = [];

  if (kind === "newUsers" || kind === "premiumUsers" || kind === "businessUsers" || kind === "suspendedUsers") {
    const where: Record<string, unknown> = { ...userWhere };
    if (kind === "newUsers") Object.assign(where, W);
    if (kind === "premiumUsers") where.isPremium = true;
    if (kind === "businessUsers") where.accountType = "business";
    if (kind === "suspendedUsers") where.suspendedUntil = { gt: now };
    const users = await prisma.user.findMany({
      where, orderBy: { createdAt: "desc" }, take: 300,
      select: { id: true, displayName: true, email: true, phone: true, country: true, createdAt: true, suspendedUntil: true },
    });
    rows = users.map((u) => ({ id: u.id, userId: u.id, title: u.displayName, subtitle: contact(u), meta: dateStr(u.createdAt), suspended: !!u.suspendedUntil && u.suspendedUntil > now }));
  } else if (kind === "blockedPeople") {
    const groups = await prisma.block.groupBy({ by: ["targetId"], where: { ...inScope("targetId"), ...W }, _count: { targetId: true } });
    const ids = groups.map((g) => g.targetId);
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, email: true, phone: true, suspendedUntil: true } });
    const map = new Map(users.map((u) => [u.id, u]));
    rows = groups.map((g) => {
      const u = map.get(g.targetId);
      return { id: g.targetId, userId: g.targetId, title: u?.displayName ?? "—", subtitle: u ? contact(u) : "", meta: `× ${g._count.targetId}`, suspended: !!u?.suspendedUntil && u.suspendedUntil > now };
    });
  } else if (kind === "ads") {
    const ads = await prisma.ad.findMany({
      where: { ...(byCountry ? { country: byCountry } : {}), ...W }, orderBy: { createdAt: "desc" }, take: 300,
      include: { user: { select: { displayName: true } } },
    });
    rows = ads.map((a) => ({ id: a.id, title: a.user.displayName, subtitle: a.caption || a.country, meta: `$${a.price} · ${dateStr(a.createdAt)}` }));
  } else if (kind === "jobs") {
    const jobs = await prisma.job.findMany({
      where: { ...(byCountry ? { country: byCountry } : {}), ...W }, orderBy: { createdAt: "desc" }, take: 300,
      include: { company: { select: { displayName: true } } },
    });
    rows = jobs.map((j) => ({ id: j.id, title: j.title, subtitle: j.company?.displayName ?? "", meta: dateStr(j.createdAt) }));
  } else if (kind === "subscriptions") {
    const subs = await prisma.subscription.findMany({
      where: { ...inScope("userId"), ...W }, orderBy: { createdAt: "desc" }, take: 300,
      include: { user: { select: { displayName: true, email: true, phone: true, suspendedUntil: true } } },
    });
    rows = subs.map((sub) => ({ id: sub.id, userId: sub.userId, title: sub.user.displayName, subtitle: contact(sub.user), meta: `$${sub.amount} · ${dateStr(sub.createdAt)}`, suspended: !!sub.user.suspendedUntil && sub.user.suspendedUntil > now }));
  } else {
    return NextResponse.json({ error: "bad_kind" }, { status: 400 });
  }

  return NextResponse.json({ rows });
}
