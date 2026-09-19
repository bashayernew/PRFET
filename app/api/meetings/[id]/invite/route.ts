import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({ userIds: z.array(z.string().min(1).max(40)).min(1).max(20) });

/**
 * POST /api/meetings/[id]/invite — invite people to a room that is already running.
 *
 * Invites could only be sent at creation time (the `inviteIds` field), so the share button
 * inside a live room had nothing to call: it fell back to copying a link, which notifies
 * nobody and is useless to a host mid-broadcast.
 *
 * The notification row doubles as the invite record — GET /api/meetings reads these back so
 * an invited person actually sees the room in their list, whatever its privacy setting.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rl = rateLimit(req, "meeting-invite", 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    select: { id: true, title: true, hostId: true, status: true },
  });
  if (!meeting || meeting.status !== "live") return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Host, or anyone already in the room — a guest telling a friend to come is normal, and
  // the room's own privacy rules still decide whether they can actually get in.
  if (meeting.hostId !== payload.sub) {
    const part = await prisma.meetingParticipant
      .findUnique({ where: { meetingId_userId: { meetingId: id, userId: payload.sub } } })
      .catch(() => null);
    if (!part || part.kicked) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const targets = [...new Set(parsed.data.userIds)].filter((uid) => uid !== payload.sub).slice(0, 20);
  if (!targets.length) return NextResponse.json({ ok: true, sent: 0 });

  // Don't re-notify someone who already has an invite to this room — a host tapping the
  // share button twice shouldn't buzz everyone's phone twice.
  const already = await prisma.notification
    .findMany({
      where: { kind: "meeting_invite", targetId: id, userId: { in: targets } },
      select: { userId: true },
    })
    .catch(() => []);
  const seen = new Set(already.map((n: { userId: string }) => n.userId));
  const fresh = targets.filter((uid) => !seen.has(uid));

  await Promise.all(
    fresh.map((uid) => notify(uid, "meeting_invite", { actorId: payload.sub, targetId: id, text: meeting.title }))
  ).catch(() => {});

  return NextResponse.json({ ok: true, sent: fresh.length });
}
