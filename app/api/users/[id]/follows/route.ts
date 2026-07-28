import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

const sel = { id: true, displayName: true, avatarUrl: true, category: true } as const;

// GET /api/users/[id]/follows — who follows this account, and who it follows.
// Private: only the account owner (or an admin) may see the lists.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = bearerFromRequest(req);
  const viewer = token ? verifyAccessToken(token)?.sub : undefined;
  if (viewer !== id) {
    const me = viewer ? await prisma.user.findUnique({ where: { id: viewer }, select: { isAdmin: true } }) : null;
    if (!me?.isAdmin) return NextResponse.json({ followers: [], following: [], private: true }, { status: 200 });
  }

  const [followerRows, followingRows] = await Promise.all([
    prisma.follow.findMany({ where: { targetId: id }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.follow.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);

  const ids = [...new Set([...followerRows.map((r) => r.userId), ...followingRows.map((r) => r.targetId)])];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: sel });
  const byId = new Map(users.map((u) => [u.id, u]));

  return NextResponse.json({
    followers: followerRows.map((r) => byId.get(r.userId)).filter(Boolean),
    following: followingRows.map((r) => byId.get(r.targetId)).filter(Boolean),
  });
}
