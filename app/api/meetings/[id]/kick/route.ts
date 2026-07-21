import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

const schema = z.object({ userId: z.string().min(1).max(40), reason: z.string().max(200).optional() });

// POST /api/meetings/[id]/kick — the host removes a participant (they can't rejoin).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (meeting.hostId !== payload.sub) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (parsed.data.userId === meeting.hostId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await prisma.meetingParticipant.updateMany({
    where: { meetingId: id, userId: parsed.data.userId },
    data: { kicked: true, blocked: true, canAudio: false, canText: false, canVideo: false, audioState: "muted" },
  });

  // Boot them out of the live room immediately.
  const io = (globalThis as unknown as { __herotIo?: { to: (room: string) => { emit: (ev: string, payload: unknown) => void } } }).__herotIo;
  io?.to(parsed.data.userId).emit("meeting:kicked", { meetingId: id, reason: parsed.data.reason ?? null });

  return NextResponse.json({ ok: true });
}
