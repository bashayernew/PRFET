import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";

// POST /api/posts/[id]/like — toggle my like. Everyone sees the new count.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const post = await prisma.post.findUnique({ where: { id }, select: { id: true, userId: true, caption: true } });
  if (!post) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const existing = await prisma.postLike.findUnique({
    where: { postId_userId: { postId: id, userId: payload.sub } },
  });

  if (existing) {
    await prisma.postLike.delete({ where: { id: existing.id } });
  } else {
    await prisma.postLike.create({ data: { postId: id, userId: payload.sub } });
    if (post.userId !== payload.sub) notify(post.userId, "post_like", { actorId: payload.sub, targetId: id, text: post.caption }).catch(() => {});
  }

  const likes = await prisma.postLike.count({ where: { postId: id } });
  return NextResponse.json({ liked: !existing, likes });
}
