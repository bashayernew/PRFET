/**
 * The App Store / Play Store product catalogue.
 *
 * One source of truth, shared by the native purchase UI and the RevenueCat webhook, so a
 * product can never grant one thing on the client and another on the server.
 *
 * Every id is overridable from env, matching the pattern in `lib/billing.ts` — so if you
 * name a product differently in App Store Connect you change an env var, not code.
 *
 * IMPORTANT — these ids are permanent. App Store Connect will not let you reuse a product
 * id after it has been created, even if you delete the product. Get them right first time.
 */

export type IapGrant =
  | { kind: "plan"; tier: "basic" | "vip"; months: number }
  | { kind: "addon"; pack: "voice" | "media" | "storage" }
  | { kind: "credits"; cents: number }
  | null;

/** Auto-renewing subscriptions. `months` is how far a fresh purchase extends premium. */
export const SUB_PRODUCTS = {
  basic1m: process.env.NEXT_PUBLIC_IAP_BASIC_1M || "prfet_basic_1m",
  basic3m: process.env.NEXT_PUBLIC_IAP_BASIC_3M || "prfet_basic_3m",
  basic6m: process.env.NEXT_PUBLIC_IAP_BASIC_6M || "prfet_basic_6m",
  basic12m: process.env.NEXT_PUBLIC_IAP_BASIC_12M || "prfet_basic_12m",
  vip1m: process.env.NEXT_PUBLIC_IAP_VIP_1M || "prfet_vip_1m",
} as const;

/** Non-renewing add-on packs (RevenueCat reports these as NON_RENEWING_PURCHASE). */
export const ADDON_PRODUCTS = {
  voice: process.env.NEXT_PUBLIC_IAP_ADDON_VOICE || "prfet_addon_voice",
  media: process.env.NEXT_PUBLIC_IAP_ADDON_MEDIA || "prfet_addon_media",
  storage: process.env.NEXT_PUBLIC_IAP_ADDON_STORAGE || "prfet_addon_storage",
} as const;

/**
 * Consumable credit packs, for the things Apple will not let us price dynamically: ads
 * (base + per-country + per-day), job posts, and seeker ads.
 *
 * The value is what the pack is WORTH in the wallet, in cents — set it to match the Apple
 * price tier you choose in App Store Connect. Give the larger packs a bonus if you want to
 * encourage bigger top-ups; that is a pricing decision, not a code one.
 */
export const CREDIT_PACKS: Record<string, number> = {
  [process.env.NEXT_PUBLIC_IAP_CREDITS_10 || "prfet_credits_10"]: 1000,
  [process.env.NEXT_PUBLIC_IAP_CREDITS_25 || "prfet_credits_25"]: 2500,
  [process.env.NEXT_PUBLIC_IAP_CREDITS_50 || "prfet_credits_50"]: 5000,
  [process.env.NEXT_PUBLIC_IAP_CREDITS_100 || "prfet_credits_100"]: 10000,
  [process.env.NEXT_PUBLIC_IAP_CREDITS_250 || "prfet_credits_250"]: 25000,
  [process.env.NEXT_PUBLIC_IAP_CREDITS_500 || "prfet_credits_500"]: 50000,
  // A $1,000 tier was considered and left out for now. If it is added later, raise
  // MAX_BALANCE_CENTS in lib/credits.ts to at least $2,000 FIRST, or the largest top-up
  // will be silently truncated and the buyer short-changed.
};

/** Credit pack ids in ascending order — used to build the top-up sheet. */
export const ALL_CREDIT_PRODUCT_IDS: string[] = Object.keys(CREDIT_PACKS);

/**
 * What a purchased product id grants. Returns null for anything unrecognised — an unknown
 * product must never fall through to granting premium.
 */
export function iapGrant(productId: string): IapGrant {
  // Apple appends the subscription group suffix on some StoreKit paths; strip it.
  const id = (productId || "").trim().toLowerCase().split(":")[0];
  if (!id) return null;

  const map: Record<string, IapGrant> = {
    [SUB_PRODUCTS.basic1m.toLowerCase()]: { kind: "plan", tier: "basic", months: 1 },
    [SUB_PRODUCTS.basic3m.toLowerCase()]: { kind: "plan", tier: "basic", months: 3 },
    [SUB_PRODUCTS.basic6m.toLowerCase()]: { kind: "plan", tier: "basic", months: 6 },
    [SUB_PRODUCTS.basic12m.toLowerCase()]: { kind: "plan", tier: "basic", months: 12 },
    [SUB_PRODUCTS.vip1m.toLowerCase()]: { kind: "plan", tier: "vip", months: 1 },
    [ADDON_PRODUCTS.voice.toLowerCase()]: { kind: "addon", pack: "voice" },
    [ADDON_PRODUCTS.media.toLowerCase()]: { kind: "addon", pack: "media" },
    [ADDON_PRODUCTS.storage.toLowerCase()]: { kind: "addon", pack: "storage" },
  };
  if (map[id]) return map[id];

  // Credit packs are matched case-insensitively against their configured ids.
  for (const [packId, cents] of Object.entries(CREDIT_PACKS)) {
    if (packId.toLowerCase() === id) return { kind: "credits", cents };
  }
  return null;
}

/**
 * Fallback for when a webhook carries an entitlement but no id we recognise — e.g. after a
 * plan change. RevenueCat entitlement ids are configured in its dashboard.
 */
export function tierFromEntitlements(ids: string[] | undefined): "basic" | "vip" | null {
  if (!ids?.length) return null;
  const lower = ids.map((e) => e.toLowerCase());
  if (lower.includes("vip")) return "vip";
  if (lower.includes("premium") || lower.includes("basic")) return "basic";
  return null;
}

/** Every subscription product id, in display order — used to build the paywall. */
export const ALL_SUB_PRODUCT_IDS: string[] = [
  SUB_PRODUCTS.basic1m,
  SUB_PRODUCTS.basic3m,
  SUB_PRODUCTS.basic6m,
  SUB_PRODUCTS.basic12m,
  SUB_PRODUCTS.vip1m,
];
