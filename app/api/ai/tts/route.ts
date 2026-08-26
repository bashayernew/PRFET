import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { premiumLapsed } from "@/lib/premium";
import { geminiTTS } from "@/lib/gemini";
import { voiceCapCheck, voiceBump } from "@/lib/ai-usage";
import { ttsKey, ttsGet, ttsSet } from "@/lib/ai-cache";

const schema = z.object({
  text: z.string().min(1).max(1200),
  gender: z.enum(["male", "female"]).optional(),
  // In live voice mode the client meters TIME via /api/ai/voice-tick, so it asks TTS not to
  // also charge the audio length (would double-count). Defaults to metering for one-off playback.
  meter: z.boolean().default(true),
});

// POST /api/ai/tts — speak a reply in a natural voice (Gemini text-to-speech).
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Anti-abuse guard only — keyed PER USER (voice mode splits a reply into several chunks,
  // so it's kept high). The real limit is the dashboard-editable monthly voice cap below.
  const rl = rateLimit(req, "ai-tts:" + payload.sub, 120, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { isPremium: true, premiumUntil: true, autoRenew: true, isAdmin: true },
  });
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // same gate as the chat: off entirely, or premium-only
  const s = await prisma.appSettings.findUnique({ where: { id: "app" }, select: { aiEnabled: true, aiPremiumOnly: true } }).catch(() => null);
  if (s && s.aiEnabled === false) return NextResponse.json({ error: "disabled" }, { status: 403 });
  if (s?.aiPremiumOnly && !user.isAdmin) {
    const effPremium = user.isPremium && !premiumLapsed(user as never);
    if (!effPremium) return NextResponse.json({ error: "premium_only" }, { status: 403 });
  }

  // Monthly AI-voice cap (dashboard-editable). Admins are unlimited.
  const voice = await voiceCapCheck(payload.sub);
  if (!voice.allowed) return NextResponse.json({ error: "voice_limit" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const text = parsed.data.text.trim();

  // Token saver: identical text in the same voice returns the audio we already generated,
  // instead of paying to synthesize it again. Shared across members (audio has no personal
  // content). The spoken time still counts against the member's monthly voice cap.
  const meter = parsed.data.meter;
  const tkey = ttsKey(parsed.data.gender, text);
  const hit = ttsGet(tkey);
  if (hit) {
    if (meter) await voiceBump(payload.sub, hit.seconds);
    return NextResponse.json({ url: hit.url });
  }

  const r = await geminiTTS(text, parsed.data.gender);
  if (!r.ok) {
    const status = r.error === "quota" ? 429 : r.error === "not_configured" ? 503 : 502;
    return NextResponse.json({ error: r.error }, { status });
  }
  ttsSet(tkey, r.dataUrl, r.seconds); // remember it for the next identical request
  if (meter) await voiceBump(payload.sub, r.seconds); // count the spoken time against the monthly cap
  return NextResponse.json({ url: r.dataUrl });
}
