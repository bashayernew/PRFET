import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { haversineKm } from "@/lib/geo";



// GET /api/users?q=... — public directory of (business) accounts.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const sort = url.searchParams.get("sort");
  const scope = url.searchParams.get("scope"); // business (default) | people | all

  // Distance is measured from where the viewer actually is. If we don't know where they
  // are, we say so (null) instead of inventing a distance from some default city.
  const maxKmRaw = Number(url.searchParams.get("maxKm"));
  const maxKm = Number.isFinite(maxKmRaw) && maxKmRaw > 0 ? maxKmRaw : null;

  let origin: { lat: number; lng: number } | null = null;
  let browse: string[] = [];
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (payload) {
    const me = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { locationLat: true, locationLng: true, browseCountries: true },
    });
    if (me?.locationLat != null && me?.locationLng != null) origin = { lat: me.locationLat, lng: me.locationLng };
    browse = (me?.browseCountries || "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
  }

  // ?countries=KW,SA overrides the saved choice for this one search. Empty = the whole world.
  const qCountries = (url.searchParams.get("countries") || "")
    .split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
  const countries = qCountries.length ? qCountries : browse;

  const users = await prisma.user.findMany({
    where: {
      ...(scope === "all" ? {} : scope === "people" ? { accountType: "personal" } : { accountType: "business" }),
      visibility: "public",
      // Never show the viewer their own account in search results.
      ...(payload ? { id: { not: payload.sub } } : {}),
      // A name search should find anyone by that name, so the country filter is bypassed
      // when q is present (distance filtering below is likewise skipped for name searches).
      ...(countries.length && !q ? { country: { in: countries } } : {}),
      ...(q ? { displayName: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: sort === "views" ? { profileViews: "desc" } : { rating: "desc" },
    take: 50,
  });

  const ids = users.map((u) => u.id);
  // Real follower/following counts in two grouped queries.
  const [followerGroups, followingGroups] = await Promise.all([
    prisma.follow.groupBy({ by: ["targetId"], where: { targetId: { in: ids } }, _count: { targetId: true } }),
    prisma.follow.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _count: { userId: true } }),
  ]);
  const followerOf = new Map(followerGroups.map((g) => [g.targetId, g._count.targetId]));
  const followingOf = new Map(followingGroups.map((g) => [g.userId, g._count.userId]));

  // Who is currently live (hosting a room right now) — so the UI can show a LIVE badge.
  const liveHosts = await prisma.meeting.findMany({
    where: { hostId: { in: ids }, status: "live" },
    select: { hostId: true },
  }).catch(() => []);
  const liveSet = new Set(liveHosts.map((m) => m.hostId));

  const list = users.map((u) => {
    // 3 decimals = metre precision, so "right next to me" really means metres.
    const dist =
      origin && u.showDistance && u.locationLat != null && u.locationLng != null
        ? haversineKm(origin.lat, origin.lng, u.locationLat, u.locationLng).toFixed(3)
        : null;
    return {
      id: u.id,
      displayName: u.displayName,
      category: u.category,
      bio: u.bio,
      rating: u.rating,
      reviews: u.reviews,
      online: u.online,
      avatarUrl: u.avatarUrl,
      accountType: u.accountType,
      isPremium: u.isPremium,
      textColor: u.textColor,
      gender: u.gender,
      nationality: u.nationality,
      dist,
      profileViews: u.profileViews,
      followers: followerOf.get(u.id) ?? 0,
      following: followingOf.get(u.id) ?? 0,
      live: liveSet.has(u.id),
    };
  });

  // A narrowed slider means "only people I KNOW are this close" — unknown locations drop out.
  // At the full 100 km range we keep unknowns, so the list never looks needlessly empty.
  // Distance filtering applies to browsing by proximity, NOT to a name search — a name
  // search should surface the person wherever they are.
  const filtered = (maxKm != null && !q)
    ? list.filter((u) => (u.dist == null ? maxKm >= 100 : parseFloat(u.dist) <= maxKm))
    : list;

  // Collapse duplicate accounts: if the same official/business account was created more than
  // once (same name + same avatar), it was showing up 2–3 times. Keep the first (highest-rated,
  // since the query is already ordered) and drop the rest. Distinct real people practically
  // never share both name and photo, so genuine users aren't hidden.
  const seen = new Set<string>();
  const deduped = filtered.filter((u) => {
    const key = `${(u.displayName || "").trim().toLowerCase()}|${u.avatarUrl || ""}`;
    if (u.avatarUrl && seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return NextResponse.json({ users: deduped, hasOrigin: !!origin });
}
// (sync)
