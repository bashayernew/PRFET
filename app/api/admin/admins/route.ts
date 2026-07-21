import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { OWNER_RED } from "@/lib/vip";

/** Only THE owner may manage who is an admin. */
async function requireOwner(req: Request): Promise<string | null> {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return null;
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isOwner: true } });
  return me?.isOwner ? payload.sub : null;
}

// GET /api/admin/admins — every admin account.
export async function GET(req: Request) {
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ error: "owner_only" }, { status: 403 });

  const admins = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { id: true, displayName: true, email: true, phone: true, avatarUrl: true, isOwner: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({
    admins: admins.map((a) => ({ id: a.id, name: a.displayName, email: a.email, phone: a.phone, avatarUrl: a.avatarUrl, isOwner: a.isOwner })),
  });
}

const schema = z.object({
  userId: z.string().min(1).max(40),
  makeAdmin: z.boolean(),
});

// POST /api/admin/admins — promote an existing account to admin, or demote one.
// Admins get the red identity + permanent premium; the owner can never be demoted.
export async function POST(req: Request) {
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ error: "owner_only" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const { userId, makeAdmin } = parsed.data;

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isOwner: true, locale: true } });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (target.isOwner) return NextResponse.json({ error: "cannot_touch_owner" }, { status: 400 });

  if (makeAdmin) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        isAdmin: true,
        // the admin look: red name everywhere + premium for life
        textColor: OWNER_RED,
        isPremium: true,
        premiumUntil: new Date("2099-01-01"),
        autoRenew: false,
      },
    });
    const ar = (target.locale || "ar") === "ar";
    notify(userId, "admin_appointed", {
      actorId: owner,
      text: ar ? "أصبحت مشرفاً في PRFET 🛡️" : "You are now a PRFET admin 🛡️",
    }).catch(() => {});
  } else {
    await prisma.user.update({
      where: { id: userId },
      data: { isAdmin: false, textColor: null, isPremium: false, premiumUntil: null },
    });
  }

  return NextResponse.json({ ok: true });
}
