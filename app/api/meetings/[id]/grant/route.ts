import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

const schema = z.object({
  userId: z.string().min(1).max(40),
  // what the host is deciding on
  kind: z.enum(["audio", "video", "text", "screen"]),
  allow: z.boolean(),
  // screen-share only: does the sharer take the stage alone, or split it with whoever is already on?
  mode: z.enum(["solo", "split"]).optional(),
});

const MAX_STAGE = 4;   // up to 4 video/screen tiles on the stage
const MAX_SPEAKERS = 4; // at most 4 people (besides the host) may have mic/camera/screen

// POST /api/meetings/[id]/grant — the host approves or denies a participant's request.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const { userId, kind, allow, mode } = parsed.data;

  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (meeting.hostId !== payload.sub) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Cap the number of people the host can put on air. Granting mic/camera/screen to a NEW
  // person is blocked once 4 others already have any of them.
  if (allow && (kind === "audio" || kind === "video" || kind === "screen")) {
    const speakers = await prisma.meetingParticipant.count({
      where: {
        meetingId: id, kicked: false, role: { not: "host" }, userId: { not: userId },
        OR: [{ canAudio: true }, { canVideo: true }, { canScreen: true }],
      },
    });
    if (speakers >= MAX_SPEAKERS) return NextResponse.json({ error: "stage_full" }, { status: 409 });
  }

  const data: Record<string, unknown> = { wants: null };
  if (kind === "audio") {
    data.canAudio = allow;
    data.audioState = allow ? "talking" : "muted";
  }
  if (kind === "text") data.canText = allow;

  // Stage kinds (video / screen) — the stage holds at most 2 publishers.
  if (kind === "video" || kind === "screen") {
    if (allow) {
      const onStage = await prisma.meetingParticipant.findMany({ where: { meetingId: id, onStage: true, NOT: { userId } } });
      // "solo" clears the stage; "split" keeps one other publisher (the newest).
      if (mode === "solo" || onStage.length >= MAX_STAGE) {
        const keep = mode === "split" && onStage.length ? [onStage[onStage.length - 1].userId] : [];
        const drop = onStage.filter((p) => !keep.includes(p.userId)).map((p) => p.userId);
        if (drop.length) {
          await prisma.meetingParticipant.updateMany({
            where: { meetingId: id, userId: { in: drop } },
            data: { onStage: false, canVideo: false, canScreen: false },
          });
          const ioDrop = (globalThis as unknown as { __herotIo?: { to: (room: string) => { emit: (ev: string, payload: unknown) => void } } }).__herotIo;
          drop.forEach((uid) => ioDrop?.to(uid).emit("meeting:stage", { meetingId: id, onStage: false }));
        }
      }
      data.onStage = true;
      if (kind === "video") data.canVideo = true;
      if (kind === "screen") data.canScreen = true;
    } else {
      data.onStage = false;
      if (kind === "video") data.canVideo = false;
      if (kind === "screen") data.canScreen = false;
    }
  }

  await prisma.meetingParticipant.updateMany({ where: { meetingId: id, userId }, data });

  // Tell the participant what they may now do.
  const io = (globalThis as unknown as { __herotIo?: { to: (room: string) => { emit: (ev: string, payload: unknown) => void } } }).__herotIo;
  io?.to(userId).emit("meeting:granted", { meetingId: id, kind, allow, mode: mode ?? null });

  return NextResponse.json({ ok: true });
}
