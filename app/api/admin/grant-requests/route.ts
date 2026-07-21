import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";

/** Only THE owner approves or denies grant requests. */
async function requireOwner(req: Request): Promise<string | null> {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return null;
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isOwner: true } });
  return me?.isOwner ? payload.sub : null;
}

// GET /api/admin/grant-requests — the pending queue, newest first.
export async function GET(req: Request) {
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ error: "owner_only" }, { status: 403 });

  const reqs = await prisma.adminGrantRequest.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      requester: { select: { id: true, displayName: true } },
      target: { select: { id: true, displayName: true, avatarUrl: true } },
    },
  });

  return NextResponse.json({
    requests: reqs.map((r) => ({
      id: r.id,
      requester: { id: r.requester.id, name: r.requester.displayName },
      target: { id: r.target.id, name: r.target.displayName, avatarUrl: r.target.avatarUrl },
      months: r.months,
      until: r.until?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

const schema = z.object({
  id: z.string().min(1).max(40),
  approve: z.boolean(),
});

// POST /api/admin/grant-requests — the owner's verdict. Approving performs the gift.
export async function POST(req: Request) {
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ error: "owner_only" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const r = await prisma.adminGrantRequest.findUnique({ where: { id: parsed.data.id } });
  if (!r || r.status !== "pending") return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!parsed.data.approve) {
    await prisma.adminGrantRequest.update({ where: { id: r.id }, data: { status: "denied" } });
    return NextResponse.json({ ok: true, status: "denied" });
  }

  // approved — perform the gift exactly like a direct owner grant
  const target = await prisma.user.findUnique({ where: { id: r.targetId }, select: { id: true, premiumUntil: true, locale: true } });
  if (!target) return NextResponse.json({ error: "target_gone" }, { status: 404 });

  let until: Date;
  if (r.until) {
    until = r.until;
  } else {
    const base = target.premiumUntil && target.premiumUntil > new Date() ? target.premiumUntil : new Date();
    until = new Date(base.getTime() + (r.months ?? 1) * 30 * 24 * 60 * 60 * 1000);
  }

  await prisma.user.update({ where: { id: r.targetId }, data: { isPremium: true, premiumUntil: until } });
  await prisma.subscription.create({
    data: { userId: r.targetId, gifterId: r.requesterId, plan: "premium", amount: 0, currency: "USD", expiresAt: until },
  });
  await prisma.adminGrantRequest.update({ where: { id: r.id }, data: { status: "approved" } });

  const ar = (target.locale || "ar") === "ar";
  notify(r.targetId, "gift_premium", {
    actorId: r.requesterId,
    text: ar ? "هدية من الإدارة 🎁" : "A gift from the administration 🎁",
  }).catch(() => {});

  return NextResponse.json({ ok: true, status: "approved" });
}
