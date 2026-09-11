import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { premiumLapsed } from "@/lib/premium";

/**
 * POST /api/search/ble-discovered
 *
 * The NATIVE app scans over Bluetooth LE, reads each nearby device's broadcast (which carries
 * that member's user id) and its RSSI→distance, then sends the list here. We return the public
 * profile of everyone in the list who has turned ON "Discoverable via Bluetooth" — so a phone
 * can show "who's around me". The web app can't scan BLE (browser limitation); this endpoint is
 * the bridge the native layer calls.
 *
 * Body: { found: [{ id: string, distance?: number }] }   // distance in metres, optional
 */
const schema = z.object({
  found: z.array(z.object({ id: z.string().min(1).max(40), distance: z.number().min(0).max(100000).optional() })).max(200),
});

export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // The `id` in each found item is now the over-the-air BLE code, not a user id.
  const distByCode = new Map<string, number | undefined>();
  for (const f of parsed.data.found) distByCode.set(f.id, f.distance);
  const codes = [...distByCode.keys()];
  if (codes.length === 0) return NextResponse.json({ people: [] });

  // Resolve codes → users who opted in to Bluetooth discovery.
  const users = await prisma.user.findMany({
    where: { bleCode: { in: codes }, bleDiscoverable: true, visibility: "public" },
    select: {
      id: true, bleCode: true, displayName: true, avatarUrl: true, category: true, accountType: true,
      isPremium: true, premiumUntil: true, autoRenew: true, isAdmin: true, textColor: true,
    },
  }).catch(() => []);
  const others = users.filter((u) => u.id !== payload.sub);
  if (others.length === 0) return NextResponse.json({ people: [] });

  // Drop anyone in a block relationship with the viewer (either direction).
  const otherIds = others.map((u) => u.id);
  const blockedRows = await prisma.block.findMany({
    where: { OR: [{ userId: payload.sub, targetId: { in: otherIds } }, { userId: { in: otherIds }, targetId: payload.sub }] },
    select: { userId: true, targetId: true },
  }).catch(() => []);
  const blocked = new Set<string>();
  for (const b of blockedRows) { blocked.add(b.userId === payload.sub ? b.targetId : b.userId); }

  const people = others
    .filter((u) => !blocked.has(u.id))
    .map((u) => {
      const effPremium = u.isPremium && !premiumLapsed(u);
      return {
        id: u.id,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        category: u.category,
        accountType: u.accountType,
        isPremium: effPremium,
        textColor: effPremium ? u.textColor : null,
        distance: (u.bleCode ? distByCode.get(u.bleCode) : undefined) ?? null,
      };
    })
    .sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9));

  return NextResponse.json({ people });
}
