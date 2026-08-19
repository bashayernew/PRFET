import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { aiCapCheck, msgCapCheck, voiceCapCheck, storageCheck } from "@/lib/ai-usage";

/**
 * GET /api/ai/usage — how much of each metered allowance the signed-in member has left
 * this month. Powers the "X left" strip and the "you've hit your limit" prompt in the app.
 * Every figure is { cap, used, remaining, unlimited }; admins (and any 0-cap) come back
 * unlimited. Storage is cumulative (GB); the rest reset monthly.
 */
const GB = 1024 * 1024 * 1024;

export async function GET(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const me = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { isPremium: true, premiumTier: true },
  });
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [messages, images, videos, voice, storage] = await Promise.all([
    msgCapCheck(payload.sub),
    aiCapCheck(payload.sub, "image"),
    aiCapCheck(payload.sub, "video"),
    voiceCapCheck(payload.sub),
    storageCheck(payload.sub, 0),
  ]);

  // Turn a CapCheck into a JSON-safe shape (Infinity doesn't serialise).
  const box = (c: { cap: number; used: number; remaining: number }, scale = 1, round = false) => {
    const unlimited = !c.cap || c.cap <= 0;
    const f = (n: number) => (round ? Math.round((n / scale) * 10) / 10 : Math.floor(n / scale));
    return unlimited
      ? { unlimited: true, cap: 0, used: f(c.used), remaining: -1 }
      : { unlimited: false, cap: f(c.cap), used: f(c.used), remaining: Math.max(0, f(c.cap) - f(c.used)) };
  };

  return NextResponse.json({
    isPremium: me.isPremium,
    tier: me.premiumTier || "basic",
    messages: box(messages),
    images: box(images),
    videos: box(videos),
    voiceMin: box(voice, 60),        // seconds → minutes
    storageGb: box(storage, GB, true), // bytes → GB (1 decimal)
  });
}
