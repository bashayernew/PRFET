import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

const userSel = { id: true, displayName: true, avatarUrl: true, category: true, bio: true, isPremium: true, textColor: true } as const;

// GET /api/posts/[id] — one post (used by the shared-post permalink).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = bearerFromRequest(req);
  const me = token ? verifyAccessToken(token)?.sub : undefined;

  const p = await prisma.post.findUnique({
    where: { id },
    include: {
      user: { select: userSel },
      repostOf: { include: { user: { select: userSel } } },
      _count: { select: { likes: true, comments: true, reposts: true } },
      likes: me ? { where: { userId: me }, select: { id: true } } : false,
    },
  });
  if (!p) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.post.update({ where: { id }, data: { views: { increment: 1 } } }).catch(() => {});

  return NextResponse.json({
    post: {
      id: p.id,
      userId: p.userId,
      kind: p.kind,
      mediaUrl: p.mediaUrl,
      caption: p.caption,
      views: p.views + 1,
      allowRepost: p.allowRepost,
      allowSave: p.allowSave,
      allowComment: p.allowComment,
      likes: p._count.likes,
      comments: p._count.comments,
      reposts: p._count.reposts,
      likedByMe: Array.isArray(p.likes) ? p.likes.length > 0 : false,
      mine: p.userId === me,
      repostOf: p.repostOf ? { id: p.repostOf.id, user: p.repostOf.user } : null,
      createdAt: p.createdAt.toISOString(),
      user: p.user,
    },
  });
}

// DELETE /api/posts/[id] — remove my own post.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (post.userId !== payload.sub) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await prisma.post.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
