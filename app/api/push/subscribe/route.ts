import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// POST /api/push/subscribe — save a browser/device push subscription for the current user.
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  await prisma.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    create: { userId: payload.sub, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth },
    update: { userId: payload.sub, p256dh: body.keys.p256dh, auth: body.keys.auth },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
