import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

const createSchema = z.object({
  kind: z.enum(["image", "video"]).default("image"),
  mediaUrl: z.string().min(1).max(500),
  caption: z.string().max(300).optional(),
});

// GET /api/stories            → all active (non-expired) stories, newest first
// GET /api/stories?userId=xxx  → active stories for one account
export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId") || undefined;
  const stories = await prisma.story.findMany({
    where: { expiresAt: { gt: new Date() }, ...(userId ? { userId } : {}) },
    orderBy: { createdAt: userId ? "asc" : "desc" },
    include: { user: { select: { id: true, displayName: true, avatarUrl: true, category: true } } },
  });
  return NextResponse.json({
    stories: stories.map((s) => ({
      id: s.id,
      userId: s.userId,
      kind: s.kind,
      mediaUrl: s.mediaUrl,
      caption: s.caption,
      createdAt: s.createdAt.toISOString(),
      user: s.user,
    })),
  });
}

// POST /api/stories — publish a story (24h expiry).
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const story = await prisma.story.create({
    data: {
      userId: payload.sub,
      kind: parsed.data.kind,
      mediaUrl: parsed.data.mediaUrl,
      caption: parsed.data.caption ?? null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  return NextResponse.json({ id: story.id }, { status: 201 });
}
