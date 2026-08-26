import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { getPrices } from "@/lib/pricing";
import { createInvoice } from "@/lib/invoice";

const DAYS = 30;

// Only the two plans now — gift one month of Golden (basic) or VIP. No month bundles.
const schema = z.object({
  peerId: z.string().min(1).max(40),
  tier: z.enum(["basic", "vip"]).default("basic"),
});

/**
 * POST /api/subscribe/gift — pay for someone else's subscription.
 * Their premium is extended from whenever it currently runs out (never shortened),
 * a receipt is stored against THEM with me recorded as the payer, and they're told.
 *
 * NOTE: like /api/subscribe, this is still the test payment path — no real money moves yet.
 */
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const { peerId, tier } = parsed.data;

  if (peerId === payload.sub) return NextResponse.json({ error: "self" }, { status: 400 });

  const peer = await prisma.user.findUnique({ where: { id: peerId }, select: { id: true, displayName: true, premiumUntil: true } });
  if (!peer) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const prices = await getPrices();
  const giftAmount = tier === "vip" ? prices.vip : prices.subscription; // one month of the chosen plan
  const planLabel = tier === "vip" ? "VIP" : "Golden";

  // A gift is one month, and never cuts their existing time short — it stacks on top.
  const base = peer.premiumUntil && peer.premiumUntil > new Date() ? peer.premiumUntil : new Date();
  const expiresAt = new Date(base.getTime() + DAYS * 24 * 60 * 60 * 1000);

  await prisma.subscription.create({
    data: {
      userId: peerId,
      gifterId: payload.sub,
      plan: tier === "vip" ? "vip" : "premium",
      amount: giftAmount,
      currency: "USD",
      expiresAt,
    },
  });

  await prisma.user.update({ where: { id: peerId }, data: { isPremium: true, premiumTier: tier, premiumUntil: expiresAt } });

  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { displayName: true } });

  // Drop a line in the chat, so both sides can see it happened.
  const body = `🎁 ${me?.displayName ?? ""} — ${planLabel} premium`;
  const mineConvo = await prisma.conversation.upsert({
    where: { userId_peerId: { userId: payload.sub, peerId } },
    create: { userId: payload.sub, peerId },
    update: {},
  });
  const theirConvo = await prisma.conversation.upsert({
    where: { userId_peerId: { userId: peerId, peerId: payload.sub } },
    create: { userId: peerId, peerId: payload.sub },
    update: {},
  });
  await prisma.message.create({ data: { conversationId: mineConvo.id, fromMe: true, kind: "gift", body } });
  await prisma.message.create({ data: { conversationId: theirConvo.id, fromMe: false, kind: "gift", body } });

  notify(peerId, "gift_premium", { actorId: payload.sub, targetId: payload.sub, text: planLabel }).catch(() => {});

  // the gifter is the one billed
  await createInvoice({ userId: payload.sub, kind: "subscription", description: `Gifted ${planLabel} Premium (1 month)`, amount: giftAmount });

  return NextResponse.json({ ok: true, expiresAt: expiresAt.toISOString(), amount: giftAmount });
}
