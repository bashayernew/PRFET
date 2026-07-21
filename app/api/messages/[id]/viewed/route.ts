import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// POST /api/messages/[id]/viewed — the receiver opened a view-once media message.
// After this, the media is gone for them (the sender's copy is unaffected).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const message = await prisma.message.findUnique({ where: { id }, include: { conversation: true } });
  if (!message) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Must be a view-once message RECEIVED by me, not yet consumed.
  if (message.conversation.userId !== payload.sub || message.fromMe || !message.viewOnce) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!message.viewedAt) {
    await prisma.message.update({ where: { id }, data: { viewedAt: new Date() } });
  }
  return NextResponse.json({ ok: true });
}
