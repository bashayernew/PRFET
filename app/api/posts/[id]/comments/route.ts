import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";

const addSchema = z.object({ body: z.string().min(1).max(600) });

// GET /api/posts/[id]/comments — everyone's comments, oldest first.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = bearerFromRequest(req);
  const me = token ? verifyAccessToken(token)?.sub : undefined;

  const rows = await prisma.postComment.findMany({
    where: { postId: id },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: { user: { select: { id: true, displayName: true, avatarUrl: true, isPremium: true, textColor: true } } },
  });

  return NextResponse.json({
    comments: rows.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      user: c.user,
      mine: c.userId === me,
    })),
  });
}

// POST /api/posts/[id]/comments — add a comment (blocked when the author disabled comments).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = addSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const post = await prisma.post.findUnique({ where: { id }, select: { id: true, userId: true, caption: true, allowComment: true } });
  if (!post) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!post.allowComment) return NextResponse.json({ error: "comments_off" }, { status: 403 });

  const c = await prisma.postComment.create({
    data: { postId: id, userId: payload.sub, body: parsed.data.body.trim() },
    include: { user: { select: { id: true, displayName: true, avatarUrl: true, isPremium: true, textColor: true } } },
  });
  if (post.userId !== payload.sub) notify(post.userId, "post_comment", { actorId: payload.sub, targetId: id, text: parsed.data.body.trim() }).catch(() => {});

  return NextResponse.json(
    { comment: { id: c.id, body: c.body, createdAt: c.createdAt.toISOString(), user: c.user, mine: true } },
    { status: 201 }
  );
}

// DELETE /api/posts/[id]/comments?commentId=... — delete my comment (or any on my post).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const commentId = new URL(req.url).searchParams.get("commentId") ?? "";

  const c = await prisma.postComment.findUnique({ where: { id: commentId }, include: { post: { select: { userId: true } } } });
  if (!c || c.postId !== id) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (c.userId !== payload.sub && c.post.userId !== payload.sub) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await prisma.postComment.delete({ where: { id: commentId } });
  return NextResponse.json({ ok: true });
}
