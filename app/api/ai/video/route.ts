import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { premiumLapsed } from "@/lib/premium";
import { geminiVideoStart, geminiVideoPoll } from "@/lib/gemini";
import { aiCapCheck, aiCapBump } from "@/lib/ai-usage";

type Guard = { error: string; status: number } | { ok: true; userId: string };

async function guard(req: Request): Promise<Guard> {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return { error: "unauthorized", status: 401 };
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { isPremium: true, premiumUntil: true, autoRenew: true, isAdmin: true },
  });
  if (!user) return { error: "unauthorized", status: 401 };
  const s = await prisma.appSettings.findUnique({ where: { id: "app" }, select: { aiEnabled: true, aiPremiumOnly: true } }).catch(() => null);
  if (s && s.aiEnabled === false) return { error: "disabled", status: 403 };
  if (s?.aiPremiumOnly && !user.isAdmin) {
    const effPremium = user.isPremium && !premiumLapsed(user as never);
    if (!effPremium) return { error: "premium_only", status: 403 };
  }
  return { ok: true, userId: payload.sub };
}

const startSchema = z.object({ prompt: z.string().min(1).max(1000) });

// POST /api/ai/video — start a video generation, returns the operation id to poll.
export async function POST(req: Request) {
  const g = await guard(req);
  if (!("ok" in g)) return NextResponse.json({ error: g.error }, { status: g.status });

  // Per-user anti-abuse guard (video is heavy, so a low ceiling is fine per member).
  const rl = rateLimit(req, "ai-video:" + g.userId, 5, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = startSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // Monthly per-tier cap (admins unlimited). Counted at start — a started job costs the money.
  const cap = await aiCapCheck(g.userId, "video");
  if (!cap.allowed) return NextResponse.json({ error: "limit_reached", cap: cap.cap, used: cap.used }, { status: 429 });

  const r = await geminiVideoStart(parsed.data.prompt.trim());
  if (!r.ok) {
    const status = r.error === "quota" ? 429 : r.error === "not_configured" ? 503 : 502;
    return NextResponse.json({ error: r.error }, { status });
  }
  await aiCapBump(g.userId, "video");
  return NextResponse.json({ op: r.op, remaining: Math.max(0, cap.remaining - 1) });
}

// GET /api/ai/video?op=... — poll a running video; returns { done, url? }.
export async function GET(req: Request) {
  const g = await guard(req);
  if (!("ok" in g)) return NextResponse.json({ error: g.error }, { status: g.status });

  const op = new URL(req.url).searchParams.get("op") || "";
  if (!op) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const r = await geminiVideoPoll(op);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json({ done: r.done, url: r.url });
}
