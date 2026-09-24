import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { premiumLapsed } from "@/lib/premium";
import { geminiImage } from "@/lib/gemini";
import { aiCapCheck, aiCapBump } from "@/lib/ai-usage";
import { guard } from "@/lib/guard";

const schema = z.object({
  prompt: z.string().min(1).max(1000),
  image: z.string().max(8_000_000).optional(), // optional data-URL photo to base the result on
});

// POST /api/ai/image — generate one image from a prompt (Imagen via the Gemini API).
export async function POST(req: Request) {
  const g = await guard(req, "ai");
  if ("response" in g) return g.response;
  const payload = { sub: g.userId };

  // Per-user anti-abuse guard (real limit is the dashboard image cap below).
  const rl = rateLimit(req, "ai-image:" + payload.sub, 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { isPremium: true, premiumUntil: true, autoRenew: true, isAdmin: true, premiumTier: true },
  });
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // same master switches as the chat: off entirely, or Premium-only
  const s = await prisma.appSettings.findUnique({ where: { id: "app" }, select: { aiEnabled: true, aiPremiumOnly: true } }).catch(() => null);
  if (s && s.aiEnabled === false) return NextResponse.json({ error: "disabled" }, { status: 403 });
  if (s?.aiPremiumOnly && !user.isAdmin) {
    const effPremium = user.isPremium && !premiumLapsed(user as never);
    if (!effPremium) return NextResponse.json({ error: "premium_only" }, { status: 403 });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // Monthly per-tier cap (admins unlimited). Blocks before we spend anything.
  const cap = await aiCapCheck(payload.sub, "image");
  if (!cap.allowed) return NextResponse.json({ error: "limit_reached", cap: cap.cap, used: cap.used }, { status: 429 });

  const result = await geminiImage(parsed.data.prompt.trim(), parsed.data.image);
  if (!result.ok) {
    const status = result.error === "quota" ? 429 : result.error === "not_configured" ? 503 : 502;
    return NextResponse.json({ error: result.error }, { status });
  }
  await aiCapBump(payload.sub, "image"); // only count a real success
  return NextResponse.json({ url: result.dataUrl, remaining: Math.max(0, cap.remaining - 1) });
}
