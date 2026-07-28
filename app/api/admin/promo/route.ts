import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
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

type BranchLink = { id: string; name: string; url: string };

/** Safely read the branchLinks JSON column into a typed array. */
function readBranchLinks(v: unknown): BranchLink[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    .map((b) => ({ id: String(b.id ?? ""), name: String(b.name ?? ""), url: String(b.url ?? "") }))
    .filter((b) => b.id && b.name);
}

const shape = (u: {
  id: string; displayName: string; email: string | null; phone: string | null; avatarUrl: string | null;
  country: string | null; accountType: string;
  promoVideoUrl: string | null; promoLinkUrl: string | null; parentId: string | null; branchLinks?: unknown;
}) => ({
  id: u.id, name: u.displayName, email: u.email, phone: u.phone, avatarUrl: u.avatarUrl,
  country: u.country, accountType: u.accountType,
  promoVideoUrl: u.promoVideoUrl, promoLinkUrl: u.promoLinkUrl, parentId: u.parentId,
  branches: readBranchLinks(u.branchLinks),
});

const SELECT = {
  id: true, displayName: true, email: true, phone: true, avatarUrl: true, country: true, accountType: true,
  promoVideoUrl: true, promoLinkUrl: true, parentId: true, branchLinks: true,
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
  addBranch: z.object({ name: z.string().min(1).max(60), url: z.string().max(500) }).optional(), // a name+link tile
  removeBranchId: z.string().max(40).optional(), // remove a branch tile by its id
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

  // ---- branches (name + link tiles, stored on the account's branchLinks) ----
  if (d.addBranch || d.removeBranchId) {
    const cur = await prisma.user.findUnique({ where: { id: d.userId }, select: { branchLinks: true } });
    let list = readBranchLinks(cur?.branchLinks);
    if (d.addBranch) {
      const url = d.addBranch.url.trim();
      list = [...list, { id: crypto.randomUUID(), name: d.addBranch.name.trim(), url }].slice(0, 50); // cap at 50
    }
    if (d.removeBranchId) {
      list = list.filter((b) => b.id !== d.removeBranchId);
    }
    await prisma.user.update({ where: { id: d.userId }, data: { branchLinks: list } });
  }

  const u = await prisma.user.findUnique({ where: { id: d.userId }, select: SELECT });
  const settings = await prisma.appSettings.findUnique({ where: { id: "app" }, select: { sponsorUserId: true } });
  return NextResponse.json({ sponsorUserId: settings?.sponsorUserId || "", user: u ? shape(u) : null });
}
