import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { guard } from "@/lib/guard";

function auth(req: Request) {
  const token = bearerFromRequest(req);
  return token ? verifyAccessToken(token) : null;
}

async function ensureConversation(userId: string, peerId: string) {
  return prisma.conversation.upsert({
    where: { userId_peerId: { userId, peerId } },
    create: { userId, peerId },
    update: {},
  });
}

// GET /api/conversations/:peerId — load the thread and mark it read.
export async function GET(req: Request, { params }: { params: Promise<{ peerId: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { peerId } = await params;

  const convo = await ensureConversation(payload.sub, peerId);
  const messages = await prisma.message.findMany({
    where: { conversationId: convo.id },
    orderBy: { createdAt: "asc" },
  });
  await prisma.conversation.update({ where: { id: convo.id }, data: { lastReadAt: new Date() } });

  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      fromMe: m.fromMe,
      kind: m.kind,
      body: m.deletedAt ? "" : m.body,
      // view-once media disappears for the receiver after they've opened it
      mediaUrl: m.deletedAt || (m.viewOnce && m.viewedAt && !m.fromMe) ? null : m.mediaUrl,
      deleted: !!m.deletedAt,
      viewOnce: m.viewOnce,
      expired: m.viewOnce && !!m.viewedAt && !m.fromMe,
      allowSave: m.allowSave,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}

const sendSchema = z.object({
  body: z.string().min(1).max(4000),
  kind: z.enum(["text", "image", "voice", "video", "location"]).default("text"),
  mediaUrl: z.string().max(500).optional(),
  viewOnce: z.boolean().optional(), // media disappears after viewing
  allowSave: z.boolean().optional(), // receiver may save the media
});

// POST /api/conversations/:peerId — send a message.
export async function POST(req: Request, { params }: { params: Promise<{ peerId: string }> }) {
  // Sending a DM. Reading a thread is left alone on purpose — a blocked member can still
  // see what was said to them, they just can't reply.
  const g = await guard(req, "chat");
  if ("response" in g) return g.response;
  const payload = { sub: g.userId };
  const { peerId } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = sendSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // Enforce blocking either direction.
  const block = await prisma.block.findFirst({
    where: { OR: [{ userId: payload.sub, targetId: peerId }, { userId: peerId, targetId: payload.sub }] },
  });
  if (block) return NextResponse.json({ error: "blocked" }, { status: 403 });

  // A closed inbox: only people the receiver allowed can write to them.
  const peer = await prisma.user.findUnique({ where: { id: peerId }, select: { dmClosed: true } });
  if (peer?.dmClosed) {
    const allowed = await prisma.dmAllow.findUnique({
      where: { userId_targetId: { userId: peerId, targetId: payload.sub } },
    });
    if (!allowed) return NextResponse.json({ error: "dm_closed" }, { status: 403 });
  }

  const viewOnce = !!parsed.data.viewOnce;
  const allowSave = parsed.data.allowSave ?? true;
  const convo = await ensureConversation(payload.sub, peerId);
  const message = await prisma.message.create({
    data: { conversationId: convo.id, fromMe: true, kind: parsed.data.kind, body: parsed.data.body.trim(), mediaUrl: parsed.data.mediaUrl ?? null, viewOnce, allowSave },
  });
  await prisma.conversation.update({ where: { id: convo.id }, data: { updatedAt: new Date() } });

  // Mirror into the peer's own conversation so the other real user sees it, and push it live.
  const peerConvo = await ensureConversation(peerId, payload.sub);
  const mirrored = await prisma.message.create({
    data: { conversationId: peerConvo.id, fromMe: false, kind: parsed.data.kind, body: parsed.data.body.trim(), mediaUrl: parsed.data.mediaUrl ?? null, mirrorId: message.id, viewOnce, allowSave },
  });
  // Link both copies so deleting one can delete the other.
  await prisma.message.update({ where: { id: message.id }, data: { mirrorId: mirrored.id } });
  await prisma.conversation.update({ where: { id: peerConvo.id }, data: { updatedAt: new Date() } });
  // preview text: for media, say what it is instead of leaking a file path
  const preview = parsed.data.kind === "text" ? parsed.data.body.trim() : parsed.data.body.trim().slice(0, 60);
  notify(peerId, "new_message", { actorId: payload.sub, targetId: payload.sub, text: preview }).catch(() => {});

  // Real-time push to the peer's socket room (no-op if they're offline).
  const io = (globalThis as unknown as { __herotIo?: { to: (room: string) => { emit: (ev: string, payload: unknown) => void } } }).__herotIo;
  io?.to(peerId).emit("message:new", {
    from: payload.sub,
    message: { id: mirrored.id, fromMe: false, kind: mirrored.kind, body: mirrored.body, mediaUrl: mirrored.mediaUrl, viewOnce: mirrored.viewOnce, allowSave: mirrored.allowSave, createdAt: mirrored.createdAt.toISOString() },
  });
  io?.to(peerId).emit("notif:new", { kind: "new_message" });

  return NextResponse.json({
    message: {
      id: message.id,
      fromMe: message.fromMe,
      kind: message.kind,
      body: message.body,
      mediaUrl: message.mediaUrl,
      createdAt: message.createdAt.toISOString(),
    },
  });
}
