import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// POST /api/meetings/[id]/join — join a room. Requires the host's code; seat cap enforced.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting || meeting.status !== "live") return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Time's up — the room closes itself the moment anyone tries to enter it late.
  if (meeting.endsAt && meeting.endsAt <= new Date()) {
    await prisma.meeting.update({ where: { id }, data: { status: "ended" } }).catch(() => {});
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const isHost = meeting.hostId === payload.sub;
  const already = await prisma.meetingParticipant.findUnique({ where: { meetingId_userId: { meetingId: id, userId: payload.sub } } });

  // Kicked users cannot come back.
  if (already?.kicked) return NextResponse.json({ error: "kicked" }, { status: 403 });

  // A host-approved join request works instead of the code.
  const approved = await prisma.meetingJoinRequest.findUnique({
    where: { meetingId_userId: { meetingId: id, userId: payload.sub } },
  });
  const hasApproval = approved?.status === "approved";

  // No codes anywhere anymore. Only public rooms are open; friends (announced) and
  // private (hidden) rooms both need the host to approve each person first.
  if (meeting.privacy !== "public" && !isHost && !already && !hasApproval) {
    return NextResponse.json({ error: "approval_required" }, { status: 403 });
  }

  // Public rooms are open to unlimited viewers. Other rooms keep the seat cap.
  // (The 4-on-stage limit is enforced separately when the host grants mic/camera/screen.)
  if (!already && meeting.privacy !== "public") {
    const activeCount = await prisma.meetingParticipant.count({ where: { meetingId: id, kicked: false } });
    if (activeCount >= meeting.maxSeats) return NextResponse.json({ error: "full" }, { status: 409 });
  }

  await prisma.meetingParticipant.upsert({
    where: { meetingId_userId: { meetingId: id, userId: payload.sub } },
    create: { meetingId: id, userId: payload.sub, role: isHost ? "host" : "guest", audioState: "muted", canAudio: false, canText: meeting.allowText, canVideo: false },
    update: {},
  });
  return NextResponse.json({ ok: true, allowRecording: meeting.allowRecording });
}
