import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

const LIVE_MINUTES = 45; // a profile live always runs 45 minutes, then closes itself

/** My active profile live, if one is still running. */
async function activeLive(hostId: string) {
  return prisma.meeting.findFirst({
    where: { hostId, isProfileLive: true, status: "live", endsAt: { gt: new Date() } },
    select: { id: true, endsAt: true },
  });
}

// GET /api/live — am I live right now?
export async function GET(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const live = await activeLive(payload.sub);
  return NextResponse.json({ live: live ? { id: live.id, endsAt: live.endsAt?.toISOString() } : null });
}

// POST /api/live — open my profile room for a 45-minute live. Premium hosts only;
// visitors do NOT need premium. Reopening after it ends is always allowed.
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { displayName: true, isPremium: true } });
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!me.isPremium) return NextResponse.json({ error: "premium_required" }, { status: 403 });

  // Already live? Return the same room instead of opening a second one.
  const existing = await activeLive(payload.sub);
  if (existing) return NextResponse.json({ id: existing.id, endsAt: existing.endsAt?.toISOString() });

  // Close any stale profile lives that ran out of time but were never marked ended.
  await prisma.meeting.updateMany({
    where: { hostId: payload.sub, isProfileLive: true, status: "live" },
    data: { status: "ended" },
  });

  const endsAt = new Date(Date.now() + LIVE_MINUTES * 60 * 1000);
  const meeting = await prisma.meeting.create({
    data: {
      hostId: payload.sub,
      title: me.displayName,
      durationMin: LIVE_MINUTES,
      pricePerHour: 0, // profile lives are free to join
      maxSeats: 20,
      allowAudio: true,
      allowText: true,
      allowVideo: false,
      joinCode: "", // open room — anyone visiting the profile can walk in
      followersOnly: false,
      allowRecording: false,
      isProfileLive: true,
      endsAt,
      participants: {
        create: { userId: payload.sub, role: "host", audioState: "talking", canAudio: true, canText: true },
      },
    },
  });
  return NextResponse.json({ id: meeting.id, endsAt: endsAt.toISOString() }, { status: 201 });
}

// DELETE /api/live — end my live early.
export async function DELETE(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await prisma.meeting.updateMany({
    where: { hostId: payload.sub, isProfileLive: true, status: "live" },
    data: { status: "ended" },
  });
  return NextResponse.json({ ok: true });
}
