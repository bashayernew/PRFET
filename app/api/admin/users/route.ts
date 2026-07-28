import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

/** Owner-only guard shared by the admin endpoints. */
async function requireAdmin(req: Request): Promise<string | null> {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return null;
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isAdmin: true } });
  return me?.isAdmin ? payload.sub : null;
}

// GET /api/admin/users?q=… — find members by name / email / phone (for the Grants page).
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ users: [] });

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { displayName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ],
    },
    take: 20,
    orderBy: { createdAt: "desc" },
    select: {
      id: true, displayName: true, email: true, phone: true, avatarUrl: true, country: true,
      accountType: true, isPremium: true, premiumUntil: true, isAdmin: true,
      freeAdsLeft: true, freeJobPostLeft: true, freeSeekerLeft: true,
    },
  });

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id, name: u.displayName, email: u.email, phone: u.phone, avatarUrl: u.avatarUrl,
      country: u.country, accountType: u.accountType,
      isPremium: u.isPremium, premiumUntil: u.premiumUntil?.toISOString() ?? null, isAdmin: u.isAdmin,
      freeAdsLeft: u.freeAdsLeft, freeJobPostLeft: u.freeJobPostLeft, freeSeekerLeft: u.freeSeekerLeft,
    })),
  });
}

// DELETE /api/admin/users?id=… — permanently remove an account (admins can't be removed).
export async function DELETE(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

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
