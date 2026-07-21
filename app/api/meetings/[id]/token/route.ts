import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// GET /api/meetings/[id]/token — a LiveKit join token for this room (if LiveKit is configured).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!key || !secret || !url) return NextResponse.json({ error: "livekit_not_configured" }, { status: 501 });

  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { displayName: true } });
  const { AccessToken } = await import("livekit-server-sdk");
  const at = new AccessToken(key, secret, { identity: payload.sub, name: me?.displayName || payload.sub });
  // canPublish covers mic, camera and screen share; the app gates them by the host's grants.
  at.addGrant({ roomJoin: true, room: id, canPublish: true, canSubscribe: true, canPublishData: true });
  const jwt = await at.toJwt();
  return NextResponse.json({ token: jwt, url });
}
