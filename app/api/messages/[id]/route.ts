import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// DELETE /api/messages/[id] — soft-delete a message I sent (removes it for both sides).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const message = await prisma.message.findUnique({ where: { id }, include: { conversation: true } });
  if (!message) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Only the sender may delete: it must live in MY conversation and be marked as sent by me.
  if (message.conversation.userId !== payload.sub || !message.fromMe) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const now = new Date();
  await prisma.message.update({ where: { id }, data: { deletedAt: now } });
  if (message.mirrorId) {
    await prisma.message.updateMany({ where: { id: message.mirrorId }, data: { deletedAt: now } });
  }

  // Tell the peer's open chat to remove it live.
  const peerId = message.conversation.peerId;
  const io = (globalThis as unknown as { __herotIo?: { to: (room: string) => { emit: (ev: string, payload: unknown) => void } } }).__herotIo;
  if (message.mirrorId) io?.to(peerId).emit("message:deleted", { id: message.mirrorId });

  return NextResponse.json({ ok: true });
}
