import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";

// POST /api/posts/[id]/repost — republish someone's post on my profile (if they allowed it).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const src = await prisma.post.findUnique({ where: { id } });
  if (!src) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!src.allowRepost) return NextResponse.json({ error: "repost_off" }, { status: 403 });

  // Reposting a repost points at the original.
  const originalId = src.repostOfId ?? src.id;

  const already = await prisma.post.findFirst({ where: { userId: payload.sub, repostOfId: originalId } });
  if (already) return NextResponse.json({ id: already.id, already: true });

  const post = await prisma.post.create({
    data: {
      userId: payload.sub,
      kind: src.kind,
      mediaUrl: src.mediaUrl,
      caption: src.caption,
      repostOfId: originalId,
      allowRepost: src.allowRepost,
      allowSave: src.allowSave,
      allowComment: src.allowComment,
    },
  });
  if (src.userId !== payload.sub) notify(src.userId, "post_repost", { actorId: payload.sub, targetId: originalId, text: src.caption }).catch(() => {});

  return NextResponse.json({ id: post.id }, { status: 201 });
}
