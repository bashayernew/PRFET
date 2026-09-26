import { prisma } from "@/lib/prisma";

/**
 * The credit wallet — the bridge between your pricing and Apple's rules.
 *
 * Your prices stay exactly where they are: in the dashboard, in `AppSettings`, computed by
 * `lib/pricing.ts`. An ad still costs base + per-country + per-day. Nothing about that moves.
 *
 * What Apple forbids is charging a *computed* amount. Every App Store product must be one
 * fixed price. So inside the native apps a member tops up at fixed price points, and the
 * dashboard price is then spent from the balance. On the web, FastSpring charges the exact
 * amount as it always has and this wallet is never touched.
 *
 * Stored in integer US cents. Never floats — 14.99 + 1 + 2 in binary floating point is not
 * 17.99, and a wallet that loses a cent per transaction is a support nightmare.
 */

export const CENTS = 100;

/**
 * A wallet can never hold more than this. Keeps stored value sane and matches the store
 * limits for consumable balances.
 *
 * Raised from $500 to $1,000 (2026-09-26) because the top-up tiers now go up to **$500**.
 * With a $500 ceiling, a member holding any balance who bought the largest pack would have
 * been charged in full and credited only the remainder — addCredits() silently truncates to
 * the available room. $1,000 means even a $500 top-up on top of a $500 balance lands whole.
 *
 * RULE: this must always be at least (largest top-up pack × 2). Raise it BEFORE adding a
 * bigger pack, never after.
 */
export const MAX_BALANCE_CENTS = 1000 * CENTS;

/** Dollars (as used throughout `lib/pricing.ts`) → integer cents. */
export function toCents(dollars: number): number {
  return Math.round((dollars || 0) * CENTS);
}

/** Integer cents → dollars, for display and for invoice rows. */
export function toDollars(cents: number): number {
  return Math.round(cents) / CENTS;
}

export async function balance(userId: string): Promise<number> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { creditCents: true } }).catch(() => null);
  return u?.creditCents ?? 0;
}

/** Top up. Called only from the RevenueCat webhook — never from a client request.
 *  Caps the balance at MAX_BALANCE_CENTS ($500) so a wallet can never exceed the limit. */
export async function addCredits(userId: string, cents: number): Promise<number> {
  if (!Number.isFinite(cents) || cents <= 0) return balance(userId);
  const have = await balance(userId);
  const room = Math.max(0, MAX_BALANCE_CENTS - have);
  const add = Math.min(Math.round(cents), room);

  // Truncation means the member paid for credit they did not receive. It must never happen
  // silently — if this ever appears in the log, the cap is too low for the tiers on sale
  // and someone is owed a refund.
  if (add < Math.round(cents)) {
    console.error(
      `[credits] TOP-UP TRUNCATED for ${userId}: paid ${cents}c, credited ${add}c ` +
      `(balance ${have}c, cap ${MAX_BALANCE_CENTS}c). The member is owed ${Math.round(cents) - add}c.`,
    );
  }
  if (add <= 0) return have; // already at the cap
  const u = await prisma.user.update({
    where: { id: userId },
    data: { creditCents: { increment: add } },
    select: { creditCents: true },
  });
  return u.creditCents;
}

/**
 * Spend, atomically.
 *
 * The guard lives in the WHERE clause, not in application code: `updateMany` with
 * `creditCents: { gte: cents }` either matches one row and decrements it, or matches nothing.
 * Two purchases racing on the same account cannot both pass a read-then-write check and
 * overdraw the wallet — the database decides, once.
 */
export async function spendCredits(
  userId: string,
  cents: number,
): Promise<{ ok: true; remaining: number } | { ok: false; short: number; balance: number }> {
  const need = Math.round(cents);
  if (!Number.isFinite(need) || need <= 0) return { ok: true, remaining: await balance(userId) };

  const res = await prisma.user.updateMany({
    where: { id: userId, creditCents: { gte: need } },
    data: { creditCents: { decrement: need } },
  });

  if (res.count === 1) return { ok: true, remaining: await balance(userId) };

  const have = await balance(userId);
  return { ok: false, short: Math.max(0, need - have), balance: have };
}

export type TransferResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: "invalid" | "self" | "insufficient" | "recipient_full"; short?: number; balance?: number };

/**
 * Move credits from one member's wallet to another's — "support this person".
 *
 * Closed loop by design: credits can be spent inside PRFET (ads, job posts, gifting a
 * subscription) but never withdrawn as money. That keeps this a virtual-goods transfer
 * rather than a payment service, which is both what the stores permit and what avoids
 * becoming a regulated money transmitter.
 *
 * Runs in a transaction for a reason that isn't obvious: the recipient has a $500 wallet
 * cap, and `addCredits` silently trims to fit. Debiting the sender and then discovering the
 * recipient had no room would quietly destroy the difference. So the room is checked and
 * both balances move together, or neither does.
 */
export async function transferCredits(fromId: string, toId: string, cents: number): Promise<TransferResult> {
  const need = Math.round(cents);
  if (!Number.isFinite(need) || need <= 0) return { ok: false, reason: "invalid" };
  if (fromId === toId) return { ok: false, reason: "self" };

  return prisma.$transaction(async (tx) => {
    const to = await tx.user.findUnique({ where: { id: toId }, select: { creditCents: true } });
    if (!to) return { ok: false, reason: "invalid" } as const;

    if (MAX_BALANCE_CENTS - to.creditCents < need) return { ok: false, reason: "recipient_full" } as const;

    // Same atomic guard as spendCredits: the WHERE clause decides, so two transfers racing
    // on one account can't both pass and overdraw it.
    const debited = await tx.user.updateMany({
      where: { id: fromId, creditCents: { gte: need } },
      data: { creditCents: { decrement: need } },
    });
    if (debited.count !== 1) {
      const me = await tx.user.findUnique({ where: { id: fromId }, select: { creditCents: true } });
      const have = me?.creditCents ?? 0;
      return { ok: false, reason: "insufficient", short: Math.max(0, need - have), balance: have } as const;
    }

    const after = await tx.user.update({
      where: { id: toId },
      data: { creditCents: { increment: need } },
      select: { id: true },
    });
    if (!after) throw new Error("transfer credit failed"); // rolls back the debit

    const me = await tx.user.findUnique({ where: { id: fromId }, select: { creditCents: true } });
    return { ok: true, remaining: me?.creditCents ?? 0 } as const;
  });
}

/**
 * Does this request need to pay from the wallet?
 *
 * True only for the native apps, where Apple's rules apply. The web keeps its existing
 * behaviour untouched. The native client sends this header (see `lib/iap.ts`); a client
 * that omits it gets today's web behaviour, so a forged header can only ever make someone
 * pay, never let them skip paying.
 */
export function isNativeRequest(req: Request): boolean {
  const p = (req.headers.get("x-prfet-platform") || "").toLowerCase();
  return p === "ios" || p === "android";
}
