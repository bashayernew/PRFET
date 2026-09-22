import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";

/**
 * POST /api/stories/[id]/like — toggle a like on a story.
 *
 * Expired stories are refused. A story is a 24-hour thing; letting someone like one that
 * has already gone would put a notification in front of its owner about content neither of
 * them can still see.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const story = await prisma.story.findUnique({
    where: { id },
    select: { id: true, userId: true, expiresAt: true },
  });
  if (!story) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (story.expiresAt <= new Date()) return NextResponse.json({ error: "expired" }, { status: 410 });

  const existing = await prisma.storyLike.findUnique({
    where: { storyId_userId: { storyId: id, userId: payload.sub } },
    select: { id: true },
  });

  if (existing) {
    await prisma.storyLike.delete({ where: { id: existing.id } }).catch(() => {});
  } else {
    await prisma.storyLike.create({ data: { storyId: id, userId: payload.sub } }).catch(() => {});
    if (story.userId !== payload.sub) {
      notify(story.userId, "story_like", { actorId: payload.sub, targetId: id }).catch(() => {});
    }
  }

  const likes = await prisma.storyLike.count({ where: { storyId: id } });
  return NextResponse.json({ ok: true, liked: !existing, likes });
}
