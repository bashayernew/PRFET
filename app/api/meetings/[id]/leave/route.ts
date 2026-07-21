import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// POST /api/meetings/[id]/leave — drop out of the room (host leaving ends it).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const meeting = await prisma.meeting.findUnique({ where: { id }, select: { hostId: true } });
  if (!meeting) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (meeting.hostId === payload.sub) {
    await prisma.meeting.update({ where: { id }, data: { status: "ended" } });
    const io = (globalThis as unknown as { __herotIo?: { to: (r: string) => { emit: (e: string, p: unknown) => void } } }).__herotIo;
    io?.to(`meet:${id}`).emit("meeting:ended", { meetingId: id });
    return NextResponse.json({ ok: true, ended: true });
  }

  await prisma.meetingParticipant.deleteMany({ where: { meetingId: id, userId: payload.sub } });
  return NextResponse.json({ ok: true });
}
