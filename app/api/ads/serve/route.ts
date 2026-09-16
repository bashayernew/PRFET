import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/ads/serve?country=XX — active ads targeted to a country (or global "ALL"),
// counts one impression per served ad. Lazily expires ads whose window has passed.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const country = (url.searchParams.get("country") || "").toUpperCase();
  const limit = Math.min(Number(url.searchParams.get("limit") || 30), 100);

  // expire ads whose window passed (maintenance sweep)
  await prisma.ad.updateMany({
    where: { status: "active", expiresAt: { lt: new Date() } },
    data: { status: "expired" },
  });

  const candidates = await prisma.ad.findMany({
    where: {
      status: "active",
      expiresAt: { gt: new Date() },
      // an ad with no image AND no text is an empty box — never show it to anyone
      AND: [{ OR: [{ mediaUrl: { not: null } }, { caption: { not: null } }] }],
      // country column may hold a CSV of targets (e.g. "KW,SA"); coarse prefilter here,
      // exact CSV membership is enforced in JS below so "SA" can't match "USA" etc.
      ...(country ? { OR: [{ country: { contains: country } }, { country: "ALL" }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: { select: { displayName: true } } },
  });

  // Exact country targeting: an ad reaches everyone whose country is in the ad's target list
  // (or an ad marked "ALL"). No follow relationship required.
  const ads = country
    ? candidates.filter((a) => {
        const targets = (a.country || "").toUpperCase().split(",").map((c) => c.trim()).filter(Boolean);
        return targets.includes("ALL") || targets.includes(country);
      })
    : candidates;

  // impression counting per served ad
  if (ads.length) {
    await prisma.ad.updateMany({ where: { id: { in: ads.map((a) => a.id) } }, data: { views: { increment: 1 } } });
  }

  return NextResponse.json({
    ads: ads.map((a) => ({
      id: a.id,
      caption: a.caption,
      country: a.country,
      mediaUrl: a.mediaUrl,
      advertiser: a.user.displayName,
      userId: a.userId, // so viewers can message the advertiser
    })),
  });
}
