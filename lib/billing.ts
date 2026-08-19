import { prisma } from "@/lib/prisma";

/**
 * FastSpring fulfilment helpers. FastSpring is the Merchant of Record for the WEB version
 * (in-app purchases on iOS/Android still go through the stores). When FastSpring notifies us
 * of a completed purchase / renewal / cancellation via webhook, these functions apply it to
 * the member's account — the single, trusted place premium is granted from payments.
 */

export type SkuAction =
  | { kind: "plan"; tier: "basic" | "vip" }
  | { kind: "addon"; pack: "voice" | "media" | "storage" }
  | null;

/**
 * Map a FastSpring product path/SKU to what it grants. The SKUs are read from env so they
 * match whatever you named the products in your FastSpring store — no code change needed.
 */
export function skuAction(sku: string): SkuAction {
  const s = (sku || "").trim().toLowerCase();
  if (!s) return null;
  const map: Record<string, SkuAction> = {
    [(process.env.FASTSPRING_SKU_GOLDEN || "prfet-app-gold-monthly-subscription").toLowerCase()]: { kind: "plan", tier: "basic" },
    [(process.env.FASTSPRING_SKU_VIP || "prfet-vip-subscription").toLowerCase()]: { kind: "plan", tier: "vip" },
    [(process.env.FASTSPRING_SKU_ADDON_VOICE || "prfet-voice-communication-add-on").toLowerCase()]: { kind: "addon", pack: "voice" },
    [(process.env.FASTSPRING_SKU_ADDON_MEDIA || "prfet-media-chat-add-on").toLowerCase()]: { kind: "addon", pack: "media" },
    [(process.env.FASTSPRING_SKU_ADDON_STORAGE || "prfet-cloud-storage-subscription").toLowerCase()]: { kind: "addon", pack: "storage" },
  };
  return map[s] ?? null;
}

/**
 * Find the app user a webhook is about. We prefer the `uid` tag we attach at checkout
 * (the reliable link); if it's missing we fall back to matching the buyer's email.
 */
export async function resolveUser(tags: Record<string, unknown> | undefined, email?: string | null): Promise<string | null> {
  const uid = tags && typeof tags.uid === "string" ? tags.uid.trim() : "";
  if (uid) {
    const u = await prisma.user.findUnique({ where: { id: uid }, select: { id: true } }).catch(() => null);
    if (u) return u.id;
  }
  if (email) {
    const u = await prisma.user.findFirst({ where: { email: email.trim().toLowerCase() }, select: { id: true } }).catch(() => null);
    if (u) return u.id;
  }
  return null;
}

/** Turn a paid plan on (or extend it). `untilMs` = FastSpring's next charge date when known. */
export async function grantPlan(userId: string, tier: "basic" | "vip", untilMs?: number): Promise<void> {
  const until = untilMs && untilMs > Date.now() ? new Date(untilMs) : new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
  await prisma.user.update({
    where: { id: userId },
    data: { isPremium: true, premiumTier: tier, premiumUntil: until, autoRenew: true },
  }).catch(() => {});
  // A receipt row for the archive (real amount not tracked here — FastSpring holds the ledger).
  await prisma.subscription.create({
    data: { userId, plan: tier === "vip" ? "vip" : "premium", amount: 0, currency: "USD", status: "active", expiresAt: until },
  }).catch(() => {});
}

/** Cancellation: stop auto-renew. Access continues until premiumUntil, then the sweep lapses it. */
export async function cancelPlan(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { autoRenew: false } }).catch(() => {});
}
