import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

function auth(req: Request) {
  const token = bearerFromRequest(req);
  return token ? verifyAccessToken(token) : null;
}

// GET — the host's inbox of pending join requests.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (meeting.hostId !== payload.sub) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const rows = await prisma.meetingJoinRequest.findMany({
    where: { meetingId: id, status: "pending" },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
  });
  return NextResponse.json({
    requests: rows.map((r) => ({ userId: r.userId, name: r.user?.displayName ?? "", avatarUrl: r.user?.avatarUrl ?? null })),
  });
}

// POST — ask the host to let me in (no code needed).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting || meeting.status !== "live") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (meeting.hostId === payload.sub) return NextResponse.json({ ok: true }); // host needs nothing

  const kicked = await prisma.meetingParticipant.findUnique({ where: { meetingId_userId: { meetingId: id, userId: payload.sub } } });
  if (kicked?.kicked) return NextResponse.json({ error: "kicked" }, { status: 403 });

  await prisma.meetingJoinRequest.upsert({
    where: { meetingId_userId: { meetingId: id, userId: payload.sub } },
    create: { meetingId: id, userId: payload.sub, status: "pending" },
    update: { status: "pending" },
  });

  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { displayName: true, avatarUrl: true } });
  const io = (globalThis as unknown as { __herotIo?: { to: (room: string) => { emit: (ev: string, payload: unknown) => void } } }).__herotIo;
  io?.to(meeting.hostId).emit("meeting:joinRequest", {
    meetingId: id,
    userId: payload.sub,
    name: me?.displayName ?? "",
    avatarUrl: me?.avatarUrl ?? null,
  });

  return NextResponse.json({ ok: true, status: "pending" });
}

const decideSchema = z.object({ userId: z.string().min(1).max(40), allow: z.boolean() });

// PATCH — the host approves or declines a join request.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = decideSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (meeting.hostId !== payload.sub) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await prisma.meetingJoinRequest.updateMany({
    where: { meetingId: id, userId: parsed.data.userId },
    data: { status: parsed.data.allow ? "approved" : "denied" },
  });

  const io = (globalThis as unknown as { __herotIo?: { to: (room: string) => { emit: (ev: string, payload: unknown) => void } } }).__herotIo;
  io?.to(parsed.data.userId).emit("meeting:joinDecision", { meetingId: id, allow: parsed.data.allow });

  return NextResponse.json({ ok: true });
}
