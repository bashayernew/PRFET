import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const sel = { id: true, displayName: true, avatarUrl: true, category: true } as const;

// GET /api/users/[id]/follows — who follows this account, and who it follows.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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
