import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { transferCredits, toCents, toDollars } from "@/lib/credits";
import { createInvoice } from "@/lib/invoice";
import { notify } from "@/lib/notify";
import { rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/credits/send — support another member by sending credits to their wallet.
 *
 * Closed loop: the recipient can spend what they receive inside PRFET (ads, job posts,
 * gifting a subscription) but can never withdraw it as money. That is what keeps this a
 * transfer of virtual goods rather than a payment service.
 *
 * `note` lets the sender say what they're supporting — a post, an ad — and it is carried
 * into the recipient's notification so the gesture means something.
 */

/** Sending sub-cent amounts is pointless; huge amounts are almost always a mistake. */
const MIN_DOLLARS = 0.5;
const MAX_DOLLARS = 100;

const schema = z.object({
  toUserId: z.string().min(1).max(40),
  amount: z.number().positive().max(MAX_DOLLARS),
  note: z.string().max(140).optional(),
});

export async function POST(req: Request) {
  // Tighter than most endpoints: this one moves stored value.
  const rl = rateLimit(req, "credits-send", 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { toUserId, amount, note } = parsed.data;
  if (amount < MIN_DOLLARS) {
    return NextResponse.json({ error: "amount_too_small", minimum: MIN_DOLLARS }, { status: 400 });
  }

  const [me, them] = await Promise.all([
    prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, displayName: true, suspendedUntil: true } }),
    prisma.user.findUnique({ where: { id: toUserId }, select: { id: true, displayName: true, suspendedUntil: true } }),
  ]);
  if (!me || !them) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Don't let value flow into an account that's been suspended for abuse.
  const now = new Date();
  if (them.suspendedUntil && them.suspendedUntil > now) {
    return NextResponse.json({ error: "recipient_unavailable" }, { status: 403 });
  }

  const res = await transferCredits(me.id, them.id, toCents(amount));
  if (!res.ok) {
    const status = res.reason === "insufficient" ? 402 : 400;
    return NextResponse.json(
      {
        error: res.reason,
        ...(res.short !== undefined ? { needCents: res.short, balanceCents: res.balance } : {}),
      },
      { status }
    );
  }

  // A receipt for each side. The wallet is real value to the people using it, so a transfer
  // that leaves no trace is unanswerable when someone later asks where their credit went.
  await Promise.all([
    createInvoice({
      userId: me.id,
      kind: "support",
      description: `Support sent to ${them.displayName}${note ? ` — ${note}` : ""}`,
      amount,
    }),
    createInvoice({
      userId: them.id,
      kind: "support",
      description: `Support received from ${me.displayName}${note ? ` — ${note}` : ""}`,
      amount,
    }),
    notify(them.id, "credits_received", { actorId: me.id, targetId: me.id, text: `${toDollars(toCents(amount))}` }),
  ]).catch(() => { /* the transfer already succeeded — receipts are best effort */ });

  return NextResponse.json({ ok: true, remainingCents: res.remaining });
}
