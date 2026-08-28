import { NextResponse } from "next/server";
import { applyRcEvent, verifyWebhookAuth, type RcEvent } from "@/lib/revenuecat";

export const runtime = "nodejs";

/**
 * POST /api/webhooks/revenuecat — RevenueCat's server-to-server notifications.
 *
 * This is the App Store / Play Store equivalent of the FastSpring webhook, and the ONLY
 * path by which a native purchase becomes premium. The client is never trusted.
 *
 * Setup, once:
 *  1. RevenueCat dashboard → Project → Integrations → Webhooks
 *  2. URL:  https://prfet.com/api/webhooks/revenuecat
 *  3. Authorization header: paste a long random string, and put the SAME string in
 *     REVENUECAT_WEBHOOK_AUTH on the server. Without it every request is rejected.
 *
 * RevenueCat retries failed deliveries, so we answer 200 for anything we understood and
 * only 5xx when something genuinely broke and a retry might help.
 */
export async function POST(req: Request) {
  if (!verifyWebhookAuth(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { event?: RcEvent };
  try {
    body = (await req.json()) as { event?: RcEvent };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const ev = body?.event;
  if (!ev || typeof ev !== "object") {
    // Nothing actionable, but not RevenueCat's fault — don't make it retry forever.
    return NextResponse.json({ ok: true, note: "no event" });
  }

  try {
    const result = await applyRcEvent(ev);
    if (process.env.NODE_ENV !== "production") console.log("[revenuecat]", result);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[revenuecat] failed to apply event", ev?.type, err);
    // 500 so RevenueCat retries — a dropped purchase is worse than a duplicate grant,
    // and grantPlan is idempotent (it sets state, it does not accumulate).
    return NextResponse.json({ error: "apply_failed" }, { status: 500 });
  }
}
