import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";

const schema = z.object({
  userId: z.string().min(1).max(40),
  days: z.number().int().min(0).max(3650), // 0 = lift the suspension
  reason: z.string().max(300).optional(),
  reportId: z.string().max(40).optional(), // the report that triggered this, marked actioned
});

// GET /api/admin/suspend?country=KW — everyone currently locked out, soonest release last.
export async function GET(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isAdmin: true } });
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const country = (url.searchParams.get("country") || "").trim().toUpperCase();
  const byCountry = country && country !== "ALL" ? country : null;

  const users = await prisma.user.findMany({
    where: { suspendedUntil: { gt: new Date() }, ...(byCountry ? { country: byCountry } : {}) },
    select: {
      id: true, displayName: true, email: true, phone: true, avatarUrl: true,
      country: true, suspendedUntil: true, suspendReason: true,
    },
    orderBy: { suspendedUntil: "desc" },
  });

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id, name: u.displayName, email: u.email, phone: u.phone, avatarUrl: u.avatarUrl,
      country: u.country, suspendedUntil: u.suspendedUntil?.toISOString() ?? null, reason: u.suspendReason,
    })),
  });
}

// POST /api/admin/suspend — lock an account for N days (0 lifts it).
// The person is told by notification; login refuses them until the time passes.
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isAdmin: true } });
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const { userId, days, reason, reportId } = parsed.data;

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isAdmin: true, locale: true } });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (target.isAdmin) return NextResponse.json({ error: "cannot_suspend_admin" }, { status: 400 });

  const until = days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;
  await prisma.user.update({
    where: { id: userId },
    data: { suspendedUntil: until, suspendReason: days > 0 ? (reason?.trim() || null) : null, online: false },
  });

  // Kill their sessions so the suspension takes effect immediately, not at next login.
  if (until) {
    await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => {});
  }

  if (until) {
    const ar = (target.locale || "ar") === "ar";
    const msg = ar
      ? `تم إيقاف حسابك ${days} يوم${reason ? ` — السبب: ${reason}` : ""}`
      : `Your account is suspended for ${days} day(s)${reason ? ` — reason: ${reason}` : ""}`;
    notify(userId, "suspended", { text: msg }).catch(() => {});
  }

  if (reportId) {
    await prisma.report.update({ where: { id: reportId }, data: { status: "actioned" } }).catch(() => {});
  }

  return NextResponse.json({ ok: true, suspendedUntil: until?.toISOString() ?? null });
}
