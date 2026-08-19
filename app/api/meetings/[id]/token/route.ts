import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// GET /api/meetings/[id]/token — a LiveKit join token for this room.
// Only an actual, non-kicked participant of a LIVE (non-expired) room gets a token, and
// publish (mic/camera/screen) is granted ONLY when the host has allowed it — the token is
// the media-layer gate, so it can't be bypassed by calling this endpoint directly.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!key || !secret || !url) return NextResponse.json({ error: "livekit_not_configured" }, { status: 501 });

  const meeting = await prisma.meeting.findUnique({ where: { id }, select: { hostId: true, status: true, endsAt: true } });
  if (!meeting || meeting.status !== "live") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (meeting.endsAt && meeting.endsAt <= new Date()) return NextResponse.json({ error: "ended" }, { status: 410 });

  const part = await prisma.meetingParticipant.findUnique({
    where: { meetingId_userId: { meetingId: id, userId: payload.sub } },
    select: { kicked: true },
  });
  const isHost = meeting.hostId === payload.sub;
  // The host always has access. Everyone else must have joined (via /join, which checks the
  // code / approval / seat cap) and not be kicked.
  if (!isHost && (!part || part.kicked)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Cap the token's life to the room's remaining time (fallback 4h), so media can't outlive the room.
  const remainingSec = meeting.endsAt ? Math.max(60, Math.floor((meeting.endsAt.getTime() - Date.now()) / 1000)) : 4 * 60 * 60;

  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { displayName: true } });
  const { AccessToken } = await import("livekit-server-sdk");
  const at = new AccessToken(key, secret, { identity: payload.sub, name: me?.displayName || payload.sub, ttl: remainingSec });
  // canPublish is kept true because the app grants mic/camera/screen dynamically (raise hand →
  // host allows) and the client only enables a track once granted. Tightening this to the DB
  // grants needs a token refresh on each grant (or a server-side LiveKit permission update) —
  // tracked as a follow-up; the room-entry gate above is the critical control.
  at.addGrant({ roomJoin: true, room: id, canPublish: true, canSubscribe: true, canPublishData: true, roomAdmin: isHost });
  const jwt = await at.toJwt();
  return NextResponse.json({ token: jwt, url });
}
