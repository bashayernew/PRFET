import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { getPrices, adPrice } from "@/lib/pricing";
import { createInvoice, sendPurchaseNotice } from "@/lib/invoice";
import { isNativeRequest, spendCredits, toCents } from "@/lib/credits";

const ALLOWED_DAYS = [1, 2, 3, 7, 15, 30];

function auth(req: Request) {
  const token = bearerFromRequest(req);
  return token ? verifyAccessToken(token) : null;
}

// GET /api/ads — the current user's ads (newest first).
export async function GET(req: Request) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await prisma.ad.updateMany({ where: { userId: payload.sub, status: "active", expiresAt: { lt: new Date() } }, data: { status: "expired" } });

  const ads = await prisma.ad.findMany({
    where: { userId: payload.sub },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { displayName: true, accountType: true } } },
  });

  return NextResponse.json({
    ads: ads.map((a) => ({
      id: a.id,
      caption: a.caption,
      country: a.country,
      durationDays: a.durationDays,
      price: a.price,
      mediaUrl: a.mediaUrl,
      status: a.status,
      views: a.views,
      advertiser: a.user.displayName,
      createdAt: a.createdAt.toISOString(),
      expiresAt: a.expiresAt.toISOString(),
    })),
  });
}

const createSchema = z.object({
  // multi-country targeting (stored as CSV in the country column); old single `country` still accepted
  countries: z.array(z.string().min(2).max(4)).min(1).max(20).optional(),
  country: z.string().min(2).max(4).optional(),
  durationDays: z.number().int().refine((d) => ALLOWED_DAYS.includes(d), "bad_duration"),
  caption: z.string().max(280).optional(),
  mediaName: z.string().max(200).optional(),
  mediaUrl: z.string().max(400).optional(),
});

// POST /api/ads — submit a new ad (status: pending review).
export async function POST(req: Request) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // master switch: when ads are paused from the dashboard, posting still works but is FREE.
  const feat = await prisma.appSettings.findUnique({ where: { id: "app" }, select: { adsEnabled: true } });
  const adsPaid = feat?.adsEnabled !== false;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // An ad needs something to show: an image/video, or at least some text. Not neither.
  if (!parsed.data.mediaUrl && !parsed.data.caption?.trim()) {
    return NextResponse.json({ error: "empty_ad" }, { status: 400 });
  }
  const d = parsed.data;

  const countryList = [...new Set(d.countries?.length ? d.countries : d.country ? [d.country] : [])];
  if (!countryList.length) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // the client's formula: base = 1 country + 1 day; each extra country/day adds its increment.
  // Users with admin-gifted free ads pay nothing (and one free credit is spent).
  const poster = await prisma.user.findUnique({ where: { id: payload.sub }, select: { freeAdsLeft: true } });
  const freeAd = (poster?.freeAdsLeft ?? 0) > 0;
  const prices = await getPrices();
  const price = freeAd || !adsPaid ? 0 : adPrice(prices, countryList.length, d.durationDays);
  const expiresAt = new Date(Date.now() + d.durationDays * 24 * 60 * 60 * 1000);

  // Inside the native apps, Apple requires the money to move through the App Store. The
  // price is still yours (the formula above is untouched) — it is just paid from the credit
  // wallet the member topped up with. On the web nothing here applies and the flow is
  // exactly as it was. Charge BEFORE creating the ad so a failed payment leaves no row.
  if (price > 0 && isNativeRequest(req)) {
    const paid = await spendCredits(payload.sub, toCents(price));
    if (!paid.ok) {
      return NextResponse.json(
        {
          error: "insufficient_credits",
          price,
          needCents: paid.short,
          balanceCents: paid.balance,
        },
        { status: 402 },
      );
    }
  }

  const ad = await prisma.ad.create({
    data: {
      userId: payload.sub,
      caption: d.caption?.trim() || null,
      country: countryList.join(","),
      durationDays: d.durationDays,
      price,
      mediaName: d.mediaName ?? null,
      mediaUrl: d.mediaUrl ?? null,
      // AD_AUTO_APPROVE=1 (testing phase): ads go live immediately. Remove for real launch + build a review flow.
      status: process.env.NODE_ENV !== "production" || process.env.AD_AUTO_APPROVE === "1" ? "active" : "pending",
      expiresAt,
    },
  });

  if (freeAd) await prisma.user.update({ where: { id: payload.sub }, data: { freeAdsLeft: { decrement: 1 } } }).catch(() => {});
  await prisma.notification.create({ data: { userId: payload.sub, kind: "ad_review", data: ad.caption ?? null, targetId: ad.id } });
  await createInvoice({ userId: payload.sub, kind: "ad", description: `Ad — ${countryList.length} country/ies × ${d.durationDays} day(s)`, amount: price });
  if (price > 0) await sendPurchaseNotice(payload.sub, "ad", price);

  return NextResponse.json({ id: ad.id, price, status: ad.status }, { status: 201 });
}
