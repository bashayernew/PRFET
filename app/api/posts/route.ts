import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

const createSchema = z.object({
  kind: z.enum(["image", "video"]).default("image"),
  mediaUrl: z.string().min(1).max(500),
  caption: z.string().max(2000).optional(),
  allowRepost: z.boolean().optional(),
  allowSave: z.boolean().optional(),
  allowComment: z.boolean().optional(),
});

const userSel = { id: true, displayName: true, avatarUrl: true, category: true, bio: true, isPremium: true, textColor: true } as const;

// GET /api/posts — newest posts (optionally one user's), with like/comment counts.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId") || undefined;
  const token = bearerFromRequest(req);
  const me = token ? verifyAccessToken(token)?.sub : undefined;

  const posts = await prisma.post.findMany({
    where: userId ? { userId } : {},
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      user: { select: userSel },
      repostOf: { include: { user: { select: userSel } } },
      _count: { select: { likes: true, comments: true, reposts: true } },
      likes: me ? { where: { userId: me }, select: { id: true } } : false,
    },
  });

  return NextResponse.json({
    posts: posts.map((p) => ({
      id: p.id,
      userId: p.userId,
      kind: p.kind,
      mediaUrl: p.mediaUrl,
      caption: p.caption,
      views: p.views,
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
    })),
  });
}

// POST /api/posts — publish an image post or a video reel.
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const post = await prisma.post.create({
    data: {
      userId: payload.sub,
      kind: parsed.data.kind,
      mediaUrl: parsed.data.mediaUrl,
      caption: parsed.data.caption?.trim() || null,
      allowRepost: parsed.data.allowRepost ?? true,
      allowSave: parsed.data.allowSave ?? true,
      allowComment: parsed.data.allowComment ?? true,
    },
  });
  return NextResponse.json({ id: post.id }, { status: 201 });
}
