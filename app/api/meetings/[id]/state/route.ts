import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

const schema = z.object({ audioState: z.enum(["talking", "muted"]) });

// PATCH /api/meetings/[id]/state — publish my mic state so the room shows the right ring.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  await prisma.meetingParticipant.updateMany({
    where: { meetingId: id, userId: payload.sub },
    data: { audioState: parsed.data.audioState },
  });
  return NextResponse.json({ ok: true });
}
