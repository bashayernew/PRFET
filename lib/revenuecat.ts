import { prisma } from "@/lib/prisma";
import { grantPlan, cancelPlan } from "@/lib/billing";
import { aiGrantAddon } from "@/lib/ai-usage";
import { addCredits } from "@/lib/credits";
import { iapGrant, tierFromEntitlements } from "@/lib/iap-products";

/**
 * RevenueCat is the Merchant-of-Record bridge for the NATIVE apps, the way FastSpring is for
 * the web (see `lib/billing.ts`). Apple and Google take the money; RevenueCat validates the
 * receipt and tells us what the member is entitled to.
 *
 * The rule is the same as everywhere else in this codebase: the client is never trusted to
 * grant premium. A purchase becomes real only when it arrives here, from RevenueCat's
 * servers, over a channel we can authenticate.
 */

const RC_API = "https://api.revenuecat.com/v1";

/** Shape of the bits of a RevenueCat webhook event we act on. */
export type RcEvent = {
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  product_id?: string;
  entitlement_ids?: string[];
  expiration_at_ms?: number;
  purchased_at_ms?: number;
  store?: string;
  environment?: string;
};

/**
 * RevenueCat signs webhooks by sending whatever Authorization header you configure in its
 * dashboard. Set the same value in REVENUECAT_WEBHOOK_AUTH.
 *
 * Compared in constant time. If the env var is unset we refuse everything rather than
 * accepting everything — an unauthenticated grant endpoint is a free-premium button.
 */
export function verifyWebhookAuth(header: string | null): boolean {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH || "";
  if (!expected) return false;
  const got = header || "";
  if (got.length !== expected.length) return false;
  // Length is already equal, so a plain char-by-char accumulate is constant time here.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * The RevenueCat `app_user_id` is set to our own user id when the SDK is configured
 * (see `lib/iap.ts`). Verify it actually exists before granting anything.
 */
export async function resolveRcUser(ev: RcEvent): Promise<string | null> {
  for (const candidate of [ev.app_user_id, ev.original_app_user_id]) {
    const id = (candidate || "").trim();
    if (!id || id.startsWith("$RCAnonymousID:")) continue;
    const u = await prisma.user.findUnique({ where: { id }, select: { id: true } }).catch(() => null);
    if (u) return u.id;
  }
  return null;
}

/**
 * Apply one RevenueCat event. Returns a short string describing what happened, for the log.
 *
 * Sandbox events are ignored unless RC_ALLOW_SANDBOX=1 — otherwise anyone with a sandbox
 * tester account could mint themselves real premium.
 */
export async function applyRcEvent(ev: RcEvent): Promise<string> {
  const type = (ev.type || "").toUpperCase();

  if ((ev.environment || "").toUpperCase() === "SANDBOX" && process.env.RC_ALLOW_SANDBOX !== "1") {
    return `ignored sandbox ${type}`;
  }

  const userId = await resolveRcUser(ev);
  if (!userId) return `no matching user for ${type}`;

  const grant = iapGrant(ev.product_id || "");

  switch (type) {
    // A new subscription, a renewal, an un-cancel, or an upgrade/downgrade — all mean
    // "this member is entitled right now, until expiration_at_ms".
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "UNCANCELLATION":
    case "PRODUCT_CHANGE":
    case "SUBSCRIPTION_EXTENDED":
    case "TRANSFER": {
      // Some stores report a consumable as INITIAL_PURCHASE rather than NON_RENEWING —
      // catch credit packs here too so a top-up can never be read as a subscription.
      if (grant?.kind === "credits") {
        const total = await addCredits(userId, grant.cents);
        return `credited ${grant.cents}c to ${userId} (balance ${total}c)`;
      }
      const tier =
        grant?.kind === "plan" ? grant.tier : tierFromEntitlements(ev.entitlement_ids);
      if (!tier) return `unknown product ${ev.product_id} on ${type}`;
      await grantPlan(userId, tier, ev.expiration_at_ms);
      return `granted ${tier} to ${userId} (${type})`;
    }

    // One-off add-on packs and credit top-ups.
    case "NON_RENEWING_PURCHASE": {
      if (grant?.kind === "credits") {
        const total = await addCredits(userId, grant.cents);
        return `credited ${grant.cents}c to ${userId} (balance ${total}c)`;
      }
      if (grant?.kind === "addon") {
        await aiGrantAddon(userId, grant.pack);
        return `granted addon ${grant.pack} to ${userId}`;
      }
      if (grant?.kind === "plan") {
        await grantPlan(userId, grant.tier, Date.now() + grant.months * 31 * 24 * 60 * 60 * 1000);
        return `granted ${grant.tier} (${grant.months}m, non-renewing) to ${userId}`;
      }
      return `unknown non-renewing product ${ev.product_id}`;
    }

    // Auto-renew switched off. Access continues until the paid period ends — matching how
    // cancelPlan behaves for FastSpring. Cancelling an add-on must not lapse premium.
    case "CANCELLATION":
    case "SUBSCRIPTION_PAUSED": {
      if (grant?.kind === "addon") return `addon ${grant.pack} cancelled — premium untouched`;
      await cancelPlan(userId);
      return `auto-renew off for ${userId} (${type})`;
    }

    // The subscription is actually over. Let the existing lapse logic in `lib/premium.ts`
    // handle the downgrade by clearing auto-renew and letting premiumUntil pass.
    case "EXPIRATION": {
      if (grant?.kind === "addon") return `addon ${grant.pack} expired — premium untouched`;
      await cancelPlan(userId);
      return `expired for ${userId}`;
    }

    // Billing trouble: do NOT revoke. Apple retries for days and usually recovers; pulling
    // access on the first failed charge is how you generate angry support tickets.
    case "BILLING_ISSUE":
      return `billing issue noted for ${userId} — access left intact`;

    default:
      return `ignored ${type}`;
  }
}

/**
 * Ask RevenueCat directly what a member is entitled to.
 *
 * Webhooks can be delayed by seconds, and a member who has just paid should not stare at a
 * locked screen. The app calls `/api/iap/sync` after a purchase, which calls this — so the
 * grant still comes from RevenueCat's servers, never from the client's word.
 */
export async function fetchRcEntitlement(
  appUserId: string,
): Promise<{ tier: "basic" | "vip"; expiresMs?: number } | null> {
  const key = process.env.REVENUECAT_SECRET_KEY || "";
  if (!key) return null;

  const res = await fetch(`${RC_API}/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    cache: "no-store",
  }).catch(() => null);
  if (!res || !res.ok) return null;

  const body = (await res.json().catch(() => null)) as {
    subscriber?: { entitlements?: Record<string, { expires_date?: string | null; product_identifier?: string }> };
  } | null;

  const ents = body?.subscriber?.entitlements;
  if (!ents) return null;

  const now = Date.now();
  let best: { tier: "basic" | "vip"; expiresMs?: number } | null = null;

  for (const [name, ent] of Object.entries(ents)) {
    // A null expires_date means a lifetime/non-expiring entitlement — still active.
    const expiresMs = ent.expires_date ? Date.parse(ent.expires_date) : undefined;
    if (expiresMs !== undefined && (isNaN(expiresMs) || expiresMs <= now)) continue;

    const fromProduct = iapGrant(ent.product_identifier || "");
    const tier =
      fromProduct?.kind === "plan" ? fromProduct.tier : tierFromEntitlements([name]);
    if (!tier) continue;

    // VIP outranks basic when both are somehow active.
    if (!best || (tier === "vip" && best.tier === "basic")) best = { tier, expiresMs };
  }

  return best;
}
