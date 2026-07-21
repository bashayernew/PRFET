import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// POST /api/meetings/[id]/recording-alert — a participant's device signalled a possible
// screen recording / capture in a room where recording is NOT allowed. Warn the host live.
// NOTE: browsers cannot reliably detect screen recording — this is best-effort
// (native Android FLAG_SECURE + page-visibility heuristics), not a guarantee.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting || meeting.status !== "live") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (meeting.allowRecording) return NextResponse.json({ ok: true, ignored: true });

  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { displayName: true } });

  const io = (globalThis as unknown as { __herotIo?: { to: (room: string) => { emit: (ev: string, payload: unknown) => void } } }).__herotIo;
  io?.to(meeting.hostId).emit("meeting:recording", {
    meetingId: id,
    userId: payload.sub,
    name: me?.displayName ?? "",
  });

  return NextResponse.json({ ok: true });
}
