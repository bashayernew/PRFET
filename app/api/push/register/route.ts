import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

/**
 * POST /api/push/register — the native app calls this with its FCM device token so the
 * server can push to the phone even when the app is closed. Idempotent: the same token is
 * re-pointed at the current user (a shared phone / re-login moves the token to whoever is
 * signed in now).
 * Body: { token: string, platform?: "android" | "ios" }
 */
const schema = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(["android", "ios"]).default("android"),
});

export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  await prisma.deviceToken.upsert({
    where: { token: parsed.data.token },
    update: { userId: payload.sub, platform: parsed.data.platform, updatedAt: new Date() },
    create: { userId: payload.sub, token: parsed.data.token, platform: parsed.data.platform },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
