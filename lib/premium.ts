import { prisma } from "@/lib/prisma";

/**
 * Premium has lapsed once its paid time runs out. A store auto-renew pushes
 * `premiumUntil` forward on every successful charge, so an actively-renewing
 * subscription always has a future date and won't lapse here. A one-off gift, an
 * admin grant, or a cancelled/failed renewal keeps its date — so once `premiumUntil`
 * passes, the account drops back to free. This is what makes a subscription actually
 * END after its month instead of staying premium forever. Admins never lapse.
 */
export function premiumLapsed(u: { isPremium: boolean; premiumUntil: Date | null; autoRenew?: boolean; isAdmin?: boolean }): boolean {
  if (u.isAdmin) return false;
  return u.isPremium && !!u.premiumUntil && u.premiumUntil < new Date();
}

/**
 * If the account's premium has lapsed, flip it back to free (no perks) and return
 * the updated row. Otherwise return the row unchanged. Called lazily on read.
 */
export async function expireIfLapsed<T extends { id: string; isPremium: boolean; premiumUntil: Date | null; autoRenew: boolean; isAdmin?: boolean }>(u: T): Promise<T> {
  if (!premiumLapsed(u)) return u;
  const updated = await prisma.user
    .update({ where: { id: u.id }, data: { isPremium: false, premiumTier: "basic", premiumUntil: null, textColor: null, shareLocation: false } })
    .catch(() => null);
  return (updated as unknown as T) ?? { ...u, isPremium: false, premiumUntil: null };
}
