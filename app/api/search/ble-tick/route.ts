import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { premiumLapsed } from "@/lib/premium";
import { voiceCapCheck, voiceBump } from "@/lib/ai-usage";

export const runtime = "nodejs";

const schema = z.object({ seconds: z.number().int().min(1).max(120) });

/**
 * POST /api/search/ble-tick — AI Bluetooth-radar heartbeat.
 *
 * While auto-radar is running, the client posts elapsed seconds here every few seconds so the
 * monthly "radar minutes" cap (the same `callMinutes` quota that used to meter AI-voice time)
 * is charged for the TIME the radar ran. Premium-only. Returns 403 `radar_limit` when the cap
 * is used up (client ends the session and shows the renew / add-ons prompt), or `premium_only`.
 */
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { isPremium: true, premiumUntil: true, autoRenew: true, isAdmin: true },
  });
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const effPremium = user.isAdmin || (user.isPremium && !premiumLapsed(user as never));
  if (!effPremium) return NextResponse.json({ error: "premium_only" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const cap = await voiceCapCheck(payload.sub);
  if (!cap.allowed) return NextResponse.json({ error: "radar_limit" }, { status: 403 });

  await voiceBump(payload.sub, parsed.data.seconds);
  return NextResponse.json({ ok: true, remaining: cap.remaining });
}
