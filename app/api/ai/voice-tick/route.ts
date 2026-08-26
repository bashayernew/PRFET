import { NextResponse } from "next/server";
import { z } from "zod";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { voiceCapCheck, voiceBump } from "@/lib/ai-usage";

export const runtime = "nodejs";

const schema = z.object({ seconds: z.number().int().min(1).max(120) });

/**
 * POST /api/ai/voice-tick — live-voice heartbeat.
 *
 * While the member is in live voice mode, the client posts the elapsed seconds here every
 * few seconds so the monthly voice cap is charged for the TIME spent talking to the AI —
 * not just the length of the TTS audio. Returns 403 `voice_limit` when the cap is used up,
 * which the client uses to end the session and show the renew / add-ons prompt.
 */
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const cap = await voiceCapCheck(payload.sub);
  if (!cap.allowed) return NextResponse.json({ error: "voice_limit" }, { status: 403 });

  await voiceBump(payload.sub, parsed.data.seconds);
  return NextResponse.json({ ok: true });
}
