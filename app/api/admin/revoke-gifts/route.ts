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

// POST /api/admin/revoke-gifts — cancel ALL subscriptions (paid AND gifted) plus admin
// free-posting perks, for everyone, a country, or one person. Admins/owner are spared.
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

  // 1) free-posting rights (admin gifts) — zero them out in scope.
  const freed = await prisma.user.updateMany({
    where: { ...scopeWhere, OR: [{ freeAdsLeft: { gt: 0 } }, { freeJobPostLeft: { gt: 0 } }, { freeSeekerLeft: { gt: 0 } }] },
    data: { freeAdsLeft: 0, freeJobPostLeft: 0, freeSeekerLeft: 0 },
  });

  // 2) EVERY active subscription in scope — paid or gifted alike — is cancelled.
  const premTargets = await prisma.user.findMany({
    where: { ...scopeWhere, OR: [{ isPremium: true }, { premiumUntil: { gt: now } }] },
    select: { id: true },
  });
  const premIds = premTargets.map((u) => u.id);
  let revokedPremium = 0;
  if (premIds.length) {
    const res = await prisma.user.updateMany({
      where: { id: { in: premIds } },
      data: { isPremium: false, premiumUntil: null, premiumTier: "basic", textColor: null, shareLocation: false, autoRenew: false },
    });
    revokedPremium = res.count;
    // Also close any still-open subscription records for these users, so nothing lingers.
    await prisma.subscription.updateMany({
      where: { userId: { in: premIds }, expiresAt: { gt: now } },
      data: { expiresAt: now },
    }).catch(() => {});
    premIds.forEach((id) => notify(id, "sub_ended", {}).catch(() => {}));
  }

  return NextResponse.json({ ok: true, revokedPremium, revokedFreePosting: freed.count });
}
