import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// GET /api/follows — the targetIds the current user follows (newest first).
export async function GET(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);

  // Everyone we return comes with their real name, photo and counts — never a raw id.
  async function hydrate(ids: string[]) {
    const [users, followerGroups, followingGroups] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, displayName: true, avatarUrl: true, category: true, online: true, isPremium: true, textColor: true },
      }),
      prisma.follow.groupBy({ by: ["targetId"], where: { targetId: { in: ids } }, _count: { targetId: true } }),
      prisma.follow.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _count: { userId: true } }),
    ]);
    const followerOf = new Map(followerGroups.map((g) => [g.targetId, g._count.targetId]));
    const followingOf = new Map(followingGroups.map((g) => [g.userId, g._count.userId]));
    const byId = new Map(users.map((u) => [u.id, u]));
    return ids
      .map((i) => byId.get(i))
      .filter((u): u is NonNullable<typeof u> => !!u)
      .map((u) => ({ ...u, followers: followerOf.get(u.id) ?? 0, following: followingOf.get(u.id) ?? 0 }));
  }

  // ?followers=1 — who follows ME (instead of who I follow).
  if (url.searchParams.get("followers") === "1") {
    const rows = await prisma.follow.findMany({ where: { targetId: payload.sub }, orderBy: { createdAt: "desc" } });
    const ids = rows.map((r) => r.userId);
    return NextResponse.json({ targetIds: ids, targets: await hydrate(ids) });
  }

  const follows = await prisma.follow.findMany({
    where: { userId: payload.sub },
    orderBy: { createdAt: "desc" },
  });
  const targetIds = follows.map((f) => f.targetId);

  if (url.searchParams.get("full") === "1") {
    return NextResponse.json({ targetIds, targets: await hydrate(targetIds) });
  }
  return NextResponse.json({ targetIds });
}
