import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

const schema = z.object({
  peerId: z.string().min(1).max(40),
  seconds: z.number().int().min(0).max(60 * 60 * 12),
  outgoing: z.boolean().default(true),
});

async function ensureConversation(userId: string, peerId: string) {
  return prisma.conversation.upsert({
    where: { userId_peerId: { userId, peerId } },
    create: { userId, peerId },
    update: {},
  });
}

/**
 * POST /api/call/log — record a finished 1:1 call in BOTH sides of the conversation, so
 * the chat shows a call entry the way a phone's call history does.
 *
 * `body` holds the duration in seconds ("0" = never connected / declined). The client
 * renders it; storing a raw number keeps it language-independent.
 *
 * Only ONE side of a call posts this (whoever hangs up first), and both copies are
 * written here, so a call can't be logged twice.
 */
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { peerId, seconds } = parsed.data;
  const me = payload.sub;
  if (peerId === me) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const body = String(seconds);

  // Guard against a double-log when both ends hang up at the same moment.
  const myConvo = await ensureConversation(me, peerId);
  const recent = await prisma.message.findFirst({
    where: { conversationId: myConvo.id, kind: "call", createdAt: { gt: new Date(Date.now() - 15_000) } },
  });
  if (recent) return NextResponse.json({ ok: true, deduped: true });

  const mine = await prisma.message.create({
    data: { conversationId: myConvo.id, fromMe: true, kind: "call", body },
  });
  await prisma.conversation.update({ where: { id: myConvo.id }, data: { updatedAt: new Date() } });

  const peerConvo = await ensureConversation(peerId, me);
  const theirs = await prisma.message.create({
    data: { conversationId: peerConvo.id, fromMe: false, kind: "call", body, mirrorId: mine.id },
  });
  await prisma.message.update({ where: { id: mine.id }, data: { mirrorId: theirs.id } });
  await prisma.conversation.update({ where: { id: peerConvo.id }, data: { updatedAt: new Date() } });

  // Show it live in the peer's open chat, same as a normal message.
  const io = (globalThis as unknown as { __herotIo?: { to: (room: string) => { emit: (ev: string, payload: unknown) => void } } }).__herotIo;
  io?.to(peerId).emit("message:new", {
    from: me,
    message: {
      id: theirs.id, fromMe: false, kind: "call", body, mediaUrl: null,
      viewOnce: false, allowSave: true, createdAt: theirs.createdAt.toISOString(),
    },
  });

  return NextResponse.json({ ok: true });
}
