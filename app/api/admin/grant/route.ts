import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";

/** Any admin may call; the response tells us whether they're THE owner. */
async function requireAdmin(req: Request): Promise<{ id: string; isOwner: boolean } | null> {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return null;
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isAdmin: true, isOwner: true } });
  return me?.isAdmin ? { id: payload.sub, isOwner: !!me.isOwner } : null;
}

const schema = z.object({
  userId: z.string().min(1).max(40),
  // gift premium: either a bundle of months OR an exact end date; revoke turns it off
  premiumMonths: z.number().int().min(1).max(120).optional(),
  premiumUntil: z.string().optional(), // ISO date, e.g. "2027-01-01"
  premiumTier: z.enum(["basic", "vip"]).optional(), // which plan to gift (Golden = basic)
  revokePremium: z.boolean().optional(),
  // free-posting rights
  freeAdsLeft: z.number().int().min(0).max(9999).optional(),
  freeJobPostLeft: z.number().int().min(0).max(9999).optional(),
  freeSeekerLeft: z.number().int().min(0).max(9999).optional(),
});

// POST /api/admin/grant — the Grants page: gift premium and free-posting rights.
// Gifted premium is recorded as a $0 subscription so the books stay honest.
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const d = parsed.data;

  const target = await prisma.user.findUnique({
    where: { id: d.userId },
    select: { id: true, premiumUntil: true, locale: true },
  });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // A sub-admin's premium gift goes to the owner's queue instead of applying directly.
  // Revoking and free-posting flags stay owner-only.
  if (!admin.isOwner) {
    if (d.revokePremium || typeof d.freeAdsLeft === "number" || typeof d.freeJobPostLeft === "number" || typeof d.freeSeekerLeft === "number") {
      return NextResponse.json({ error: "owner_only" }, { status: 403 });
    }
    if (d.premiumMonths || d.premiumUntil) {
      let until: Date | null = null;
      if (d.premiumUntil) {
        until = new Date(d.premiumUntil);
        if (isNaN(until.getTime()) || until <= new Date()) return NextResponse.json({ error: "bad_date" }, { status: 400 });
      }
      await prisma.adminGrantRequest.create({
        data: { requesterId: admin.id, targetId: d.userId, months: d.premiumMonths ?? null, until },
      });
      return NextResponse.json({ pending: true });
    }
    return NextResponse.json({ error: "nothing_to_do" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};

  // ---- premium ----
  if (d.revokePremium) {
    data.isPremium = false;
    data.premiumUntil = null;
    data.premiumTier = "basic";
  } else if (d.premiumMonths || d.premiumUntil) {
    let until: Date;
    if (d.premiumUntil) {
      until = new Date(d.premiumUntil);
      if (isNaN(until.getTime()) || until <= new Date()) {
        return NextResponse.json({ error: "bad_date" }, { status: 400 });
      }
    } else {
      // months stack on whatever time is already there — a gift never shortens
      const base = target.premiumUntil && target.premiumUntil > new Date() ? target.premiumUntil : new Date();
      until = new Date(base.getTime() + (d.premiumMonths as number) * 30 * 24 * 60 * 60 * 1000);
    }
    data.isPremium = true;
    data.premiumUntil = until;
    data.premiumTier = d.premiumTier === "vip" ? "vip" : "basic"; // Golden = basic
    // the $0 receipt — visible in the archive, never inflates revenue
    await prisma.subscription.create({
      data: { userId: d.userId, gifterId: admin.id, plan: "premium", amount: 0, currency: "USD", expiresAt: until },
    });
    const ar = (target.locale || "ar") === "ar";
    notify(d.userId, "gift_premium", {
      actorId: admin.id,
      text: ar ? "هدية من الإدارة 🎁" : "A gift from the administration 🎁",
    }).catch(() => {});
  }

  // ---- free-posting rights ----
  if (typeof d.freeAdsLeft === "number") data.freeAdsLeft = d.freeAdsLeft;
  if (typeof d.freeJobPostLeft === "number") data.freeJobPostLeft = d.freeJobPostLeft;
  if (typeof d.freeSeekerLeft === "number") data.freeSeekerLeft = d.freeSeekerLeft;

  if (!Object.keys(data).length) return NextResponse.json({ error: "nothing_to_do" }, { status: 400 });

  const u = await prisma.user.update({
    where: { id: d.userId },
    data,
    select: {
      id: true, displayName: true, email: true, phone: true, avatarUrl: true, country: true,
      accountType: true, isPremium: true, premiumUntil: true, isAdmin: true,
      freeAdsLeft: true, freeJobPostLeft: true, freeSeekerLeft: true,
    },
  });

  return NextResponse.json({
    user: {
      id: u.id, name: u.displayName, email: u.email, phone: u.phone, avatarUrl: u.avatarUrl,
      country: u.country, accountType: u.accountType,
      isPremium: u.isPremium, premiumUntil: u.premiumUntil?.toISOString() ?? null, isAdmin: u.isAdmin,
      freeAdsLeft: u.freeAdsLeft, freeJobPostLeft: u.freeJobPostLeft, freeSeekerLeft: u.freeSeekerLeft,
    },
  });
}
