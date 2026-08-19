import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken, publicUser } from "@/lib/auth";

// POST /api/subscribe — DISABLED. There is no self-serve payment: real subscriptions come
// only from a verified app-store purchase (Google Play / App Store, handled inside the
// native app) or from an admin grant. This route no longer activates Premium, so nobody
// can get it for free from the web.
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ error: "store_only" }, { status: 403 });
}

// DELETE /api/subscribe — cancel: auto-renewal stops, but the time already paid
// for stays. Premium simply lapses at its end date instead of renewing.
export async function DELETE(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const user = await prisma.user.update({
    where: { id: payload.sub },
    data: { autoRenew: false },
  });

  return NextResponse.json({ ok: true, user: publicUser(user) });
}

// PATCH /api/subscribe — flip auto-renewal back on (undo a cancel).
export async function PATCH(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const user = await prisma.user.update({
    where: { id: payload.sub },
    data: { autoRenew: true, subRenewNotified: false },
  });

  return NextResponse.json({ ok: true, user: publicUser(user) });
}
