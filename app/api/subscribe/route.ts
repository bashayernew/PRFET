import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken, publicUser } from "@/lib/auth";
import { getPrices, subPrice } from "@/lib/pricing";

const DAYS = 30;
const ALLOWED_MONTHS = [1, 3, 6, 12];

// POST /api/subscribe — fake payment gateway: activates Premium.
// Body: { months?: 1 | 3 | 6 | 12 } — bundles priced from the dashboard.
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let months = 1;
  try {
    const raw = await req.json();
    if (raw && ALLOWED_MONTHS.includes(raw.months)) months = raw.months;
  } catch { /* empty body = 1 month */ }

  const prices = await getPrices();
  const price = subPrice(prices, months);

  // Buying more time never eats what's left — it stacks on top (same rule as gifts).
  const current = await prisma.user.findUnique({ where: { id: payload.sub }, select: { premiumUntil: true } });
  const base = current?.premiumUntil && current.premiumUntil > new Date() ? current.premiumUntil : new Date();
  const expiresAt = new Date(base.getTime() + months * DAYS * 24 * 60 * 60 * 1000);

  await prisma.subscription.create({
    data: { userId: payload.sub, plan: "premium", amount: price, currency: "USD", expiresAt },
  });
  const user = await prisma.user.update({
    where: { id: payload.sub },
    // buying (re)arms auto-renewal with this bundle as the one to rebill
    data: { isPremium: true, premiumUntil: expiresAt, autoRenew: true, renewMonths: months, subRenewNotified: false },
  });

  return NextResponse.json({ ok: true, user: publicUser(user) });
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
