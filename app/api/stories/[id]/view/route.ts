import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// POST /api/stories/[id]/view — mark a story seen by the current viewer (idempotent).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await prisma.storyView.upsert({
    where: { storyId_viewerId: { storyId: id, viewerId: payload.sub } },
    create: { storyId: id, viewerId: payload.sub },
    update: {},
  });
  return NextResponse.json({ ok: true });
}
