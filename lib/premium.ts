import { prisma } from "@/lib/prisma";

/**
 * Premium has lapsed when it was cancelled (auto-renew off) and its paid time
 * has now run out. Admins never lapse (their premium is permanent).
 */
export function premiumLapsed(u: { isPremium: boolean; premiumUntil: Date | null; autoRenew: boolean; isAdmin?: boolean }): boolean {
  if (u.isAdmin) return false;
  return u.isPremium && !u.autoRenew && !!u.premiumUntil && u.premiumUntil < new Date();
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
