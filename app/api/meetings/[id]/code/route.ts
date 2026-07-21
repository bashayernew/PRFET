import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// GET /api/meetings/[id]/code — the host reads their own room code (to build a share link).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (meeting.hostId !== payload.sub) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  return NextResponse.json({ code: meeting.joinCode });
}
