import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

const schema = z.object({ want: z.enum(["audio", "video", "text", "screen"]).nullable() });

// POST /api/meetings/[id]/request — a participant asks the host for mic / camera / text / screen.
// Sending { want: null } cancels a pending request.
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
  if (!meeting || meeting.status !== "live") return NextResponse.json({ error: "not_found" }, { status: 404 });

  const want = parsed.data.want;
  await prisma.meetingParticipant.updateMany({
    where: { meetingId: id, userId: payload.sub },
    data: { wants: want, audioState: want === "audio" ? "requesting" : undefined },
  });

  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { displayName: true, avatarUrl: true } });

  // Tell the host live.
  const io = (globalThis as unknown as { __herotIo?: { to: (room: string) => { emit: (ev: string, payload: unknown) => void } } }).__herotIo;
  io?.to(meeting.hostId).emit("meeting:request", {
    meetingId: id,
    userId: payload.sub,
    name: me?.displayName ?? "",
    avatarUrl: me?.avatarUrl ?? null,
    want,
  });

  return NextResponse.json({ ok: true });
}
