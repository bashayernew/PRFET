import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { pushCall } from "@/lib/fcm";

const schema = z.object({ peerId: z.string().min(1).max(40) });

// POST /api/call/ring — the caller dialled. Push an "incoming call" alert to the callee so
// they're notified even if the app is closed (the live ring only reaches an open app).
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // In-app notification (notification bell, and web-push while the app is open).
  await notify(parsed.data.peerId, "incoming_call", { actorId: payload.sub, targetId: payload.sub });

  // Native ring. Separate from notify() on purpose: this one is data-only and high
  // priority so Android wakes our code and draws the full-screen call UI, rather than the
  // system quietly posting a banner the user never sees on a locked phone.
  const me = await prisma.user
    .findUnique({ where: { id: payload.sub }, select: { displayName: true, avatarUrl: true } })
    .catch(() => null);
  await pushCall(parsed.data.peerId, {
    id: payload.sub,
    name: me?.displayName || "PRFET",
    avatarUrl: me?.avatarUrl ?? null,
  });

  return NextResponse.json({ ok: true });
}
