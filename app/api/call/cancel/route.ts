import { NextResponse } from "next/server";
import { z } from "zod";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { pushCallCancelled } from "@/lib/fcm";

const schema = z.object({ peerId: z.string().min(1).max(40) });

/**
 * POST /api/call/cancel — the caller hung up before the other side picked up.
 *
 * Hanging up sends "end" over the socket, which is fine when the other phone is connected.
 * But the whole point of the native ringer is that it reaches a phone whose app is CLOSED —
 * and a closed app has no socket, so it never hears the hang-up and keeps ringing at a call
 * that no longer exists. Answering it then lands on a dead "connecting" screen.
 *
 * This pushes a silent data message that dismisses the notification on that phone.
 */
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  await pushCallCancelled(parsed.data.peerId);
  return NextResponse.json({ ok: true });
}
