import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken, hashPassword, normalizePhone } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { MODERATION_SELECT, moderationSummary, type ModerationState } from "@/lib/moderation";

/**
 * Admin user management — the dashboard's own Users page.
 *
 * GET    search / list members
 * POST   create an account by hand
 * PATCH  block, restrict, unblock, disable, restore
 *
 * Note on names: normal signup requires a display name of at least 4 characters. That rule
 * lives in the register route and in register-screen, and it deliberately does NOT apply
 * here — an admin creating an account (an official page, a short brand, a test user) can
 * use any name of any length.
 */

async function requireAdmin(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const me = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, isAdmin: true, isOwner: true },
  });
  if (!me?.isAdmin) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { me };
}

const LIST_SELECT = {
  id: true,
  displayName: true,
  email: true,
  phone: true,
  avatarUrl: true,
  country: true,
  accountType: true,
  isAdmin: true,
  isOwner: true,
  createdAt: true,
  // The Grants page reads this endpoint too and needs these — dropping them would
  // silently break it, so they stay in the shared shape.
  isPremium: true,
  premiumUntil: true,
  freeAdsLeft: true,
  freeJobPostLeft: true,
  freeSeekerLeft: true,
  ...MODERATION_SELECT,
} as const;

type ListRow = { id: string; displayName: string; email: string | null; phone: string | null;
  avatarUrl: string | null; country: string | null; accountType: string; isAdmin: boolean;
  isOwner: boolean; createdAt: Date; isPremium: boolean; premiumUntil: Date | null;
  freeAdsLeft: number; freeJobPostLeft: number; freeSeekerLeft: number } & ModerationState;

function shape(u: ListRow) {
  return {
    id: u.id,
    name: u.displayName,
    email: u.email,
    phone: u.phone,
    avatarUrl: u.avatarUrl,
    country: u.country,
    accountType: u.accountType,
    isAdmin: u.isAdmin,
    isOwner: u.isOwner,
    createdAt: u.createdAt.toISOString(),
    isPremium: u.isPremium,
    premiumUntil: u.premiumUntil?.toISOString() ?? null,
    freeAdsLeft: u.freeAdsLeft,
    freeJobPostLeft: u.freeJobPostLeft,
    freeSeekerLeft: u.freeSeekerLeft,
    disabled: !!u.disabledAt,
    disabledReason: u.disabledReason ?? null,
    ...moderationSummary(u),
  };
}

// GET /api/admin/users?q=&country=&status=all|blocked|restricted|disabled&take=50
//
// Two callers with different needs. The Grants page is a type-ahead: it must stay quiet
// until there are at least 2 characters, or every keystroke dumps the whole member list.
// The Users page browses, so it passes scope=manage and gets results with no query.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate.error) return gate.error;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const country = (url.searchParams.get("country") || "").trim().toUpperCase();
  const status = url.searchParams.get("status") || "all";
  const manage = url.searchParams.get("scope") === "manage";
  const take = Math.min(200, Math.max(1, Number(url.searchParams.get("take") || 50)));

  if (!manage && q.length < 2) return NextResponse.json({ users: [] });

  const where: Record<string, unknown> = {};
  if (q) {
    where.OR = [
      { displayName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
      { id: q },
    ];
  }
  if (country && country !== "ALL") where.country = country;

  if (status === "blocked") where.suspendedUntil = { gt: new Date() };
  else if (status === "disabled") where.disabledAt = { not: null };
  else if (status === "restricted") {
    where.OR = [
      ...((where.OR as unknown[]) ?? []),
    ];
    // Any single feature flag set is enough to count as restricted.
    where.AND = [
      {
        OR: [
          { blockCalls: true }, { blockPosts: true }, { blockAi: true }, { blockJobs: true },
          { blockAds: true }, { blockChat: true }, { blockRooms: true },
        ],
      },
    ];
    if (!(where.OR as unknown[]).length) delete where.OR;
  } else {
    // Default list hides soft-deleted accounts; the "disabled" filter is how you find them.
    where.disabledAt = null;
  }

  const users = await prisma.user.findMany({
    where,
    select: LIST_SELECT,
    orderBy: { createdAt: "desc" },
    take,
  });

  return NextResponse.json({ users: (users as ListRow[]).map(shape) });
}

const createSchema = z.object({
  // No minimum length, unlike public signup — see the note at the top of this file.
  displayName: z.string().trim().min(1).max(80),
  email: z.string().email().max(120).optional().or(z.literal("")),
  phone: z.string().max(20).optional().or(z.literal("")),
  password: z.string().min(8).max(128).optional().or(z.literal("")),
  accountType: z.enum(["personal", "business"]).default("personal"),
  country: z.string().max(4).optional(),
  locale: z.enum(["ar", "en"]).default("ar"),
  realName: z.string().max(80).optional(),
  isAdmin: z.boolean().default(false),
});

// POST /api/admin/users — create an account directly. Pre-verified: no OTP is sent, which
// also means an admin can create phone accounts while SMS delivery is unavailable.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate.error) return gate.error;

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const email = d.email ? d.email.trim().toLowerCase() : null;
  const phone = d.phone ? normalizePhone(d.phone) : null;
  if (!email && !phone) {
    return NextResponse.json({ error: "contact_required" }, { status: 400 });
  }

  // Only an owner may mint another admin — otherwise any admin could escalate silently.
  if (d.isAdmin && !gate.me!.isOwner) {
    return NextResponse.json({ error: "owner_only" }, { status: 403 });
  }

  const clash = await prisma.user.findFirst({
    where: email && phone ? { OR: [{ email }, { phone }] } : email ? { email } : { phone: phone! },
    select: { id: true },
  });
  if (clash) return NextResponse.json({ error: "identifier_taken" }, { status: 409 });

  const user = await prisma.user.create({
    data: {
      email,
      phone,
      contactMethod: email ? "email" : "phone",
      passwordHash: d.password ? await hashPassword(d.password) : null,
      displayName: d.displayName,
      realName: d.realName?.trim() || null,
      accountType: d.accountType,
      country: d.country || null,
      locale: d.locale,
      isAdmin: d.isAdmin,
    },
    select: LIST_SELECT,
  });

  return NextResponse.json({ ok: true, user: shape(user as ListRow) }, { status: 201 });
}

const FEATURES = ["calls", "posts", "ai", "jobs", "ads", "chat", "rooms"] as const;

const patchSchema = z.object({
  userId: z.string().min(1).max(40),
  action: z.enum(["block", "restrict", "unblock", "disable", "restore"]),
  // 0 or omitted = open-ended for a restriction, or "lift" for a block.
  days: z.number().int().min(0).max(3650).optional(),
  reason: z.string().max(300).optional(),
  features: z.array(z.enum(FEATURES)).optional(),
});

// PATCH /api/admin/users — block / restrict / unblock / disable / restore.
export async function PATCH(req: Request) {
  const gate = await requireAdmin(req);
  if (gate.error) return gate.error;

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const { userId, action, days = 0, reason, features = [] } = parsed.data;

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isAdmin: true, isOwner: true, locale: true },
  });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Admins are not moderatable by other admins, and nobody moderates the owner.
  if (target.isOwner || (target.isAdmin && !gate.me!.isOwner)) {
    return NextResponse.json({ error: "cannot_moderate_admin" }, { status: 400 });
  }
  if (target.id === gate.me!.id) {
    return NextResponse.json({ error: "cannot_moderate_self" }, { status: 400 });
  }

  const ar = (target.locale || "ar") === "ar";
  const until = days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;
  const clearFlags = Object.fromEntries(
    ["blockCalls", "blockPosts", "blockAi", "blockJobs", "blockAds", "blockChat", "blockRooms"].map((k) => [k, false]),
  );

  if (action === "block") {
    if (!until) return NextResponse.json({ error: "days_required" }, { status: 400 });
    await prisma.user.update({
      where: { id: userId },
      data: {
        suspendedUntil: until,
        suspendedAt: new Date(),
        suspendReason: reason?.trim() || null,
        online: false,
      },
    });
    // End their sessions so the block bites now rather than at next login. They can sign
    // in again — that's how they see the reason and the countdown — but every route will
    // refuse them until it expires.
    await prisma.refreshToken
      .updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })
      .catch(() => {});
    notify(userId, "suspended", {
      text: ar
        ? `تم حظر حسابك ${days} يوم${reason ? ` — السبب: ${reason}` : ""}`
        : `Your account is blocked for ${days} day(s)${reason ? ` — reason: ${reason}` : ""}`,
    }).catch(() => {});
  } else if (action === "restrict") {
    if (!features.length) return NextResponse.json({ error: "features_required" }, { status: 400 });
    const flags = Object.fromEntries(
      FEATURES.map((f) => [
        `block${f[0].toUpperCase()}${f.slice(1)}`,
        features.includes(f),
      ]),
    );
    await prisma.user.update({
      where: { id: userId },
      data: { ...flags, restrictUntil: until, restrictReason: reason?.trim() || null },
    });
    notify(userId, "suspended", {
      text: ar
        ? `تم تقييد بعض الميزات في حسابك${days ? ` لمدة ${days} يوم` : ""}${reason ? ` — السبب: ${reason}` : ""}`
        : `Some features on your account were restricted${days ? ` for ${days} day(s)` : ""}${reason ? ` — reason: ${reason}` : ""}`,
    }).catch(() => {});
  } else if (action === "unblock") {
    await prisma.user.update({
      where: { id: userId },
      data: {
        suspendedUntil: null,
        suspendedAt: null,
        suspendReason: null,
        restrictUntil: null,
        restrictReason: null,
        ...clearFlags,
      },
    });
    notify(userId, "suspended", {
      text: ar ? "تم رفع الحظر عن حسابك" : "The block on your account has been lifted",
    }).catch(() => {});
  } else if (action === "disable") {
    await prisma.user.update({
      where: { id: userId },
      data: { disabledAt: new Date(), disabledReason: reason?.trim() || null, online: false },
    });
    await prisma.refreshToken
      .updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })
      .catch(() => {});
  } else if (action === "restore") {
    await prisma.user.update({
      where: { id: userId },
      data: { disabledAt: null, disabledReason: null },
    });
  }

  const fresh = await prisma.user.findUnique({ where: { id: userId }, select: LIST_SELECT });
  return NextResponse.json({ ok: true, user: fresh ? shape(fresh as ListRow) : null });
}

// DELETE /api/admin/users?id=… — permanent removal, cascading to everything the member
// ever created. Kept because existing dashboard screens call it, but the Users page
// offers "disable" instead: that is reversible and leaves reports and invoices intact.
export async function DELETE(req: Request) {
  const gate = await requireAdmin(req);
  if (gate.error) return gate.error;

  const url = new URL(req.url);
  const id = (url.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "no_id" }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { id }, select: { isAdmin: true } });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (target.isAdmin) return NextResponse.json({ error: "cannot_delete_admin" }, { status: 400 });

  try {
    await prisma.user.delete({ where: { id } });
  } catch {
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
