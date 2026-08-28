import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken, publicUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { grantPlan } from "@/lib/billing";
import { fetchRcEntitlement } from "@/lib/revenuecat";
import { expireIfLapsed } from "@/lib/premium";

export const runtime = "nodejs";

/**
 * POST /api/iap/sync — reconcile this member's premium against RevenueCat, now.
 *
 * Webhooks are the source of truth, but they can lag a few seconds, and someone who has just
 * paid should not be looking at a locked screen. The app calls this straight after a purchase
 * or a "Restore Purchases" tap.
 *
 * Note what this does NOT do: it takes no purchase data from the request body. The client
 * says only "check me"; the answer comes from RevenueCat's own API, keyed on the caller's
 * authenticated user id. There is nothing here a malicious client can forge.
 */
export async function POST(req: Request) {
  const rl = rateLimit(req, "iap-sync", 12, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const entitlement = await fetchRcEntitlement(payload.sub);
  if (entitlement) {
    await grantPlan(payload.sub, entitlement.tier, entitlement.expiresMs);
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // If nothing is active any more, let the normal lapse path downgrade them.
  const fresh = await expireIfLapsed(user);

  return NextResponse.json({
    ok: true,
    synced: !!entitlement,
    user: publicUser(fresh),
  });
}
