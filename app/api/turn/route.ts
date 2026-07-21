import { NextResponse } from "next/server";
import crypto from "crypto";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// GET /api/turn — ICE servers for WebRTC calls. Public STUN always; TURN with
// short-lived HMAC credentials when TURN_SECRET is configured (coturn --use-auth-secret).
export async function GET(req: Request) {
  const token = bearerFromRequest(req);
  if (!token || !verifyAccessToken(token)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const iceServers: Array<{ urls: string; username?: string; credential?: string }> = [
    { urls: "stun:stun.l.google.com:19302" },
  ];
  const url = process.env.NEXT_PUBLIC_TURN_URL;
  const secret = process.env.TURN_SECRET;
  if (url && secret) {
    const username = `${Math.floor(Date.now() / 1000) + 3600}`;
    const credential = crypto.createHmac("sha1", secret).update(username).digest("base64");
    iceServers.push({ urls: url, username, credential });
  }
  return NextResponse.json({ iceServers });
}
