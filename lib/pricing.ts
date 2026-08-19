import { prisma } from "@/lib/prisma";

export type Prices = {
  subscription: number; sub3m: number; sub6m: number; sub12m: number; vip: number;
  adBase: number; adExtraCountry: number; adExtraDay: number;
  jobApply: number; jobPost: number; seekerAd: number;
};

export const DEFAULT_PRICES: Prices = {
  subscription: 4.99, sub3m: 13.99, sub6m: 26.99, sub12m: 53.99, vip: 9.99,
  adBase: 14.99, adExtraCountry: 1, adExtraDay: 2,
  jobApply: 0, jobPost: 1.99, seekerAd: 0.99,
};

/** The dashboard-set prices, with sane fallbacks when the row doesn't exist yet. */
export async function getPrices(): Promise<Prices> {
  const s = await prisma.appSettings.findUnique({
    where: { id: "app" },
    select: {
      priceSubscription: true, priceSub3m: true, priceSub6m: true, priceSub12m: true, priceVip: true,
      priceAdBase: true, priceAdExtraCountry: true, priceAdExtraDay: true,
      priceJobApply: true, priceJobPost: true, priceSeekerAd: true,
    },
  });
  return {
    subscription: s?.priceSubscription ?? DEFAULT_PRICES.subscription,
    sub3m: s?.priceSub3m ?? DEFAULT_PRICES.sub3m,
    sub6m: s?.priceSub6m ?? DEFAULT_PRICES.sub6m,
    sub12m: s?.priceSub12m ?? DEFAULT_PRICES.sub12m,
    vip: s?.priceVip ?? DEFAULT_PRICES.vip,
    adBase: s?.priceAdBase ?? DEFAULT_PRICES.adBase,
    adExtraCountry: s?.priceAdExtraCountry ?? DEFAULT_PRICES.adExtraCountry,
    adExtraDay: s?.priceAdExtraDay ?? DEFAULT_PRICES.adExtraDay,
    jobApply: s?.priceJobApply ?? DEFAULT_PRICES.jobApply,
    jobPost: s?.priceJobPost ?? DEFAULT_PRICES.jobPost,
    seekerAd: s?.priceSeekerAd ?? DEFAULT_PRICES.seekerAd,
  };
}

/** Job & seeker ads run for a month, then pause until renewed. */
export const AD_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/** Price for a subscription. Basic uses the 1/3/6/12-month bundle prices; VIP is a flat
 *  monthly rate × months (its own gold-badge tier). */
export function subPrice(p: Prices, months: number, tier: "basic" | "vip" = "basic"): number {
  if (tier === "vip") return Math.round(p.vip * Math.max(1, months) * 100) / 100;
  if (months === 3) return p.sub3m;
  if (months === 6) return p.sub6m;
  if (months === 12) return p.sub12m;
  return Math.round(p.subscription * Math.max(1, months) * 100) / 100;
}

/** The client's ad formula: base covers 1 country + 1 day; extras are added per unit. */
export function adPrice(p: Prices, countries: number, days: number): number {
  const c = Math.max(1, countries), d = Math.max(1, days);
  return Math.round((p.adBase + (c - 1) * p.adExtraCountry + (d - 1) * p.adExtraDay) * 100) / 100;
}
