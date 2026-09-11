import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { premiumLapsed } from "@/lib/premium";

export const runtime = "nodejs";

/**
 * AI Bluetooth Radar report.
 *
 * The native app scans BLE in the background and streams the ids it caught. We persist each
 * one (with first/last-seen timestamps) so the "report" survives even after the person walks
 * away, then return the enriched, privacy-filtered list. Premium-only.
 */

const postSchema = z.object({
  found: z.array(z.object({ id: z.string().min(1).max(40), distance: z.number().min(0).max(100000).optional() })).max(200),
});

async function requirePremium(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPremium: true, premiumUntil: true, autoRenew: true, isAdmin: true },
  });
  if (!user) return false;
  return user.isAdmin || (user.isPremium && !premiumLapsed(user as never));
}

/** Enriched, privacy-filtered radar report for one member. */
async function report(meId: string) {
  const hits = await prisma.radarHit.findMany({ where: { userId: meId }, orderBy: { lastSeen: "desc" }, take: 500 });
  if (hits.length === 0) return [];
  const codes = hits.map((h) => h.foundId); // foundId holds the over-the-air BLE code
  const users = await prisma.user.findMany({
    where: { bleCode: { in: codes }, bleDiscoverable: true, visibility: "public" },
    select: {
      id: true, bleCode: true, displayName: true, avatarUrl: true, category: true, accountType: true,
      isPremium: true, premiumUntil: true, autoRenew: true, isAdmin: true, textColor: true,
    },
  }).catch(() => []);
  const others = users.filter((u) => u.id !== meId);
  if (others.length === 0) return [];
  const otherIds = others.map((u) => u.id);
  const blockedRows = await prisma.block.findMany({
    where: { OR: [{ userId: meId, targetId: { in: otherIds } }, { userId: { in: otherIds }, targetId: meId }] },
    select: { userId: true, targetId: true },
  }).catch(() => []);
  const blocked = new Set<string>();
  for (const b of blockedRows) blocked.add(b.userId === meId ? b.targetId : b.userId);
  const hitByCode = new Map(hits.map((h) => [h.foundId, h]));
  return others
    .filter((u) => !blocked.has(u.id))
    .map((u) => {
      const h = u.bleCode ? hitByCode.get(u.bleCode) : undefined;
      const effPremium = u.isPremium && !premiumLapsed(u as never);
      return {
        id: u.id,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        category: u.category,
        accountType: u.accountType,
        isPremium: effPremium,
        textColor: effPremium ? u.textColor : null,
        distance: h?.distance ?? null,
        firstSeen: (h?.firstSeen ?? new Date()).toISOString(),
        lastSeen: (h?.lastSeen ?? new Date()).toISOString(),
      };
    })
    .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
}

// POST /api/search/radar — persist a batch of BLE hits, return the running report.
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const me = payload.sub;
  if (!(await requirePremium(me))) return NextResponse.json({ error: "premium_only" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const now = new Date();
  for (const f of parsed.data.found) {
    if (f.id === me) continue;
    await prisma.radarHit.upsert({
      where: { userId_foundId: { userId: me, foundId: f.id } },
      create: { userId: me, foundId: f.id, distance: f.distance ?? null, firstSeen: now, lastSeen: now },
      update: { lastSeen: now, distance: f.distance ?? null },
    }).catch(() => {});
  }
  return NextResponse.json({ people: await report(me) });
}

// GET /api/search/radar — the member's current radar report (persists across the session).
export async function GET(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await requirePremium(payload.sub))) return NextResponse.json({ error: "premium_only", people: [] }, { status: 403 });
  return NextResponse.json({ people: await report(payload.sub) });
}

// DELETE /api/search/radar — clear my radar report.
export async function DELETE(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await prisma.radarHit.deleteMany({ where: { userId: payload.sub } });
  return NextResponse.json({ ok: true });
}
