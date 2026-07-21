import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";

/** Owner-only guard shared by the admin endpoints. */
async function requireAdmin(req: Request): Promise<string | null> {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return null;
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isAdmin: true } });
  return me?.isAdmin ? payload.sub : null;
}

const shape = (u: {
  id: string; displayName: string; email: string | null; phone: string | null; avatarUrl: string | null;
  country: string | null; accountType: string;
  promoVideoUrl: string | null; promoLinkUrl: string | null; parentId: string | null;
  branches?: { id: string; displayName: string; avatarUrl: string | null }[];
}) => ({
  id: u.id, name: u.displayName, email: u.email, phone: u.phone, avatarUrl: u.avatarUrl,
  country: u.country, accountType: u.accountType,
  promoVideoUrl: u.promoVideoUrl, promoLinkUrl: u.promoLinkUrl, parentId: u.parentId,
  branches: (u.branches ?? []).map((b) => ({ id: b.id, name: b.displayName, avatarUrl: b.avatarUrl })),
});

const SELECT = {
  id: true, displayName: true, email: true, phone: true, avatarUrl: true, country: true, accountType: true,
  promoVideoUrl: true, promoLinkUrl: true, parentId: true,
  branches: { select: { id: true, displayName: true, avatarUrl: true } },
} as const;

// GET /api/admin/promo?userId=… — one account's promo state; no userId = the current sponsor.
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const userId = (url.searchParams.get("userId") || "").trim();
  const settings = await prisma.appSettings.findUnique({ where: { id: "app" }, select: { sponsorUserId: true } });
  const sponsorUserId = settings?.sponsorUserId || "";

  const id = userId || sponsorUserId;
  if (!id) return NextResponse.json({ sponsorUserId: "", user: null });

  const u = await prisma.user.findUnique({ where: { id }, select: SELECT });
  return NextResponse.json({ sponsorUserId, user: u ? shape(u) : null });
}

const schema = z.object({
  userId: z.string().min(1).max(40),
  makeSponsor: z.boolean().optional(), // true = appoint, false = step down
  videoUrl: z.string().max(500).nullable().optional(), // null clears it
  linkUrl: z.string().max(500).nullable().optional(),
  addBranchId: z.string().max(40).optional(), // link another account under this one
  removeBranchId: z.string().max(40).optional(),
});

// POST /api/admin/promo — appoint the sponsor, pin their video & link, manage branches.
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const d = parsed.data;

  const target = await prisma.user.findUnique({ where: { id: d.userId }, select: { id: true, displayName: true, locale: true } });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // ---- sponsor appointment ----
  if (typeof d.makeSponsor === "boolean") {
    await prisma.appSettings.upsert({
      where: { id: "app" },
      create: { id: "app", sponsorUserId: d.makeSponsor ? d.userId : "" },
      update: { sponsorUserId: d.makeSponsor ? d.userId : "" },
    });
    if (d.makeSponsor) {
      const ar = (target.locale || "ar") === "ar";
      notify(d.userId, "sponsor_appointed", {
        actorId: admin,
        text: ar ? "أصبحت الراعي الرسمي للتطبيق 🎉" : "You are now the app's official sponsor 🎉",
      }).catch(() => {});
    }
  }

  // ---- pinned video & link ----
  const data: Record<string, unknown> = {};
  if (d.videoUrl !== undefined) data.promoVideoUrl = d.videoUrl;
  if (d.linkUrl !== undefined) data.promoLinkUrl = d.linkUrl?.trim() || null;
  if (Object.keys(data).length) {
    await prisma.user.update({ where: { id: d.userId }, data });
  }

  // ---- branches ----
  if (d.addBranchId) {
    if (d.addBranchId === d.userId) return NextResponse.json({ error: "self_branch" }, { status: 400 });
    const branch = await prisma.user.findUnique({ where: { id: d.addBranchId }, select: { id: true, parentId: true, locale: true } });
    if (!branch) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });
    // one level only: a branch cannot itself own branches, and the main account cannot be a branch
    const main = await prisma.user.findUnique({ where: { id: d.userId }, select: { parentId: true } });
    if (main?.parentId) return NextResponse.json({ error: "main_is_branch" }, { status: 400 });
    await prisma.user.update({ where: { id: d.addBranchId }, data: { parentId: d.userId } });
    const ar = (branch.locale || "ar") === "ar";
    notify(d.addBranchId, "branch_linked", {
      actorId: admin,
      text: ar ? `تم ربط حسابك كفرع تابع لـ ${target.displayName}` : `Your account is now linked as a branch of ${target.displayName}`,
    }).catch(() => {});
  }
  if (d.removeBranchId) {
    await prisma.user.updateMany({ where: { id: d.removeBranchId, parentId: d.userId }, data: { parentId: null } });
  }

  const u = await prisma.user.findUnique({ where: { id: d.userId }, select: SELECT });
  const settings = await prisma.appSettings.findUnique({ where: { id: "app" }, select: { sponsorUserId: true } });
  return NextResponse.json({ sponsorUserId: settings?.sponsorUserId || "", user: u ? shape(u) : null });
}
