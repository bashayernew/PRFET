import { NextResponse } from "next/server";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { balance, toDollars } from "@/lib/credits";
import { CREDIT_PACKS } from "@/lib/iap-products";

export const runtime = "nodejs";

/**
 * GET /api/credits — this member's wallet balance, plus the packs on offer.
 *
 * Read-only. There is deliberately no POST: credits are added in exactly one place, the
 * RevenueCat webhook, after Apple has taken the money. Nothing a client sends can top up
 * a balance.
 */
export async function GET(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const cents = await balance(payload.sub);

  return NextResponse.json({
    balanceCents: cents,
    balance: toDollars(cents),
    packs: Object.entries(CREDIT_PACKS)
      .map(([productId, value]) => ({ productId, valueCents: value, value: toDollars(value) }))
      .sort((a, b) => a.valueCents - b.valueCents),
  });
}
