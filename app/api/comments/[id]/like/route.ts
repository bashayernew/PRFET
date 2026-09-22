import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";

/**
 * POST /api/comments/[id]/like — toggle a like on a comment.
 *
 * One endpoint rather than a POST/DELETE pair: the client taps a heart and wants the new
 * state back, and a toggle can't get out of step with what's on screen the way two separate
 * calls can. The [commentId, userId] unique index means a double-tap (or two devices at
 * once) can't create two likes — the database refuses, not the client.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const comment = await prisma.postComment.findUnique({
    where: { id },
    select: { id: true, userId: true, postId: true },
  });
  if (!comment) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const existing = await prisma.commentLike.findUnique({
    where: { commentId_userId: { commentId: id, userId: payload.sub } },
    select: { id: true },
  });

  if (existing) {
    await prisma.commentLike.delete({ where: { id: existing.id } }).catch(() => {});
  } else {
    await prisma.commentLike.create({ data: { commentId: id, userId: payload.sub } }).catch(() => {});
    // Only on the way up, and never for your own comment — nobody wants a notification
    // every time someone changes their mind.
    if (comment.userId !== payload.sub) {
      notify(comment.userId, "comment_like", { actorId: payload.sub, targetId: comment.postId }).catch(() => {});
    }
  }

  const likes = await prisma.commentLike.count({ where: { commentId: id } });
  return NextResponse.json({ ok: true, liked: !existing, likes });
}
