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

/** A wallet can never hold more than this. Keeps stored value sane and matches the store
 *  limits for consumable balances. $500. */
export const MAX_BALANCE_CENTS = 500 * CENTS;

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
