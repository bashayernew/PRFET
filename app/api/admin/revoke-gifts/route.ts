import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";

async function requireOwner(req: Request): Promise<string | null> {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return null;
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isAdmin: true, isOwner: true } });
  // revoking gifts is an owner-only action, same as granting/revoking in the Grants page
  return me?.isOwner ? payload.sub : null;
}

const schema = z.object({
  scope: z.enum(["all", "country", "user"]),
  country: z.string().max(4).optional(),
  userId: z.string().max(40).optional(),
});

// POST /api/admin/revoke-gifts — pull back admin-gifted perks (free premium + free posting)
// for everyone, a country, or one person. Paid subscribers are never touched.
export async function POST(req: Request) {
  const admin = await requireOwner(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const { scope, country, userId } = parsed.data;
  if (scope === "country" && !country) return NextResponse.json({ error: "country_required" }, { status: 400 });
  if (scope === "user" && !userId) return NextResponse.json({ error: "user_required" }, { status: 400 });

  const now = new Date();
  // narrow to the chosen scope; admins/owner are always spared
  const scopeWhere: Record<string, unknown> = { isAdmin: false };
  if (scope === "country") scopeWhere.country = country;
  if (scope === "user") scopeWhere.id = userId;

  // 1) free-posting rights are always admin gifts — zero them out in scope.
  const freed = await prisma.user.updateMany({
    where: { ...scopeWhere, OR: [{ freeAdsLeft: { gt: 0 } }, { freeJobPostLeft: { gt: 0 } }, { freeSeekerLeft: { gt: 0 } }] },
    data: { freeAdsLeft: 0, freeJobPostLeft: 0, freeSeekerLeft: 0 },
  });

  // 2) gifted premium: users with an active $0 gift subscription and NO active paid one.
  const [giftSubs, paidSubs] = await Promise.all([
    prisma.subscription.findMany({ where: { gifterId: { not: null }, expiresAt: { gt: now } }, select: { userId: true } }),
    prisma.subscription.findMany({ where: { gifterId: null, amount: { gt: 0 }, expiresAt: { gt: now } }, select: { userId: true } }),
  ]);
  const paidSet = new Set(paidSubs.map((s) => s.userId));
  const giftedIds = [...new Set(giftSubs.map((s) => s.userId))].filter((id) => !paidSet.has(id));

  let revokedPremium = 0;
  if (giftedIds.length) {
    const targets = await prisma.user.findMany({
      where: { id: { in: giftedIds }, ...scopeWhere },
      select: { id: true },
    });
    const ids = targets.map((u) => u.id);
    if (ids.length) {
      const res = await prisma.user.updateMany({
        where: { id: { in: ids } },
        data: { isPremium: false, premiumUntil: null, textColor: null, shareLocation: false },
      });
      revokedPremium = res.count;
      ids.forEach((id) => notify(id, "sub_ended", {}).catch(() => {}));
    }
  }

  return NextResponse.json({ ok: true, revokedPremium, revokedFreePosting: freed.count });
}
