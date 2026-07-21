import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// POST /api/meetings/[id]/verify-code — a member proves they know the code before sharing the room.
// (Never returns the code itself — only whether the one they typed is right.)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  let code = "";
  try {
    const raw = (await req.json()) as { code?: unknown };
    if (typeof raw?.code === "string") code = raw.code.trim().toUpperCase();
  } catch { /* no body */ }

  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting || meeting.status !== "live") return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Must be inside the room to share it at all.
  const inside = await prisma.meetingParticipant.findUnique({ where: { meetingId_userId: { meetingId: id, userId: payload.sub } } });
  if (!inside || inside.kicked) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (meeting.joinCode.toUpperCase() !== code) return NextResponse.json({ error: "bad_code" }, { status: 403 });
  return NextResponse.json({ ok: true });
}
