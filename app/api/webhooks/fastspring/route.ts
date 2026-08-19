import { NextResponse } from "next/server";
import crypto from "crypto";
import { skuAction, resolveUser, grantPlan, cancelPlan } from "@/lib/billing";
import { aiGrantAddon } from "@/lib/ai-usage";

export const runtime = "nodejs";

/**
 * POST /api/webhooks/fastspring — FastSpring's server-to-server notifications.
 *
 * Set this URL as the webhook in your FastSpring dashboard and enable HMAC SHA256 with a
 * secret placed in FASTSPRING_HMAC_SECRET. We verify the signature, then apply each event:
 *  - order.completed / subscription.activated / subscription.charge.completed → grant plan / add-on
 *  - subscription.canceled / subscription.deactivated → stop auto-renew
 *
 * Tie a purchase to a member by passing `tags: { uid: <userId> }` at checkout (we also fall
 * back to the buyer's email). NEVER trust the client to grant premium — this is the only path.
 */

type FsEvent = { type?: string; data?: Record<string, unknown> };

function pick(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur && typeof cur === "object" && k in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[k];
    else return undefined;
  }
  return cur;
}

export async function POST(req: Request) {
  const raw = await req.text();

  // Verify the HMAC signature when a secret is configured.
  const secret = process.env.FASTSPRING_HMAC_SECRET || "";
  if (secret) {
    const sig = req.headers.get("x-fs-signature") || "";
    const expected = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("base64");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return NextResponse.json({ error: "bad_signature" }, { status: 401 });
    }
  }

  let body: { events?: FsEvent[] };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const events = Array.isArray(body?.events) ? body.events : [];

  for (const ev of events) {
    const type = ev?.type || "";
    const data = ev?.data || {};
    const tags = (pick(data, "tags") || pick(data, "subscription", "tags") || {}) as Record<string, unknown>;
    const email = (pick(data, "account", "contact", "email") || pick(data, "customer", "email")) as string | undefined;
    const userId = await resolveUser(tags, email);
    if (!userId) continue;

    if (type === "order.completed") {
      const items = (pick(data, "items") as Array<Record<string, unknown>>) || [];
      for (const it of items) {
        const sku = String(it.product ?? it.sku ?? "");
        const action = skuAction(sku);
        if (!action) continue;
        if (action.kind === "plan") await grantPlan(userId, action.tier);
        else await aiGrantAddon(userId, action.pack);
      }
    } else if (type === "subscription.activated" || type === "subscription.charge.completed") {
      const sku = String(pick(data, "product") ?? pick(data, "subscription", "product") ?? "");
      const action = skuAction(sku);
      const nextCharge = pick(data, "nextChargeDate") ?? pick(data, "subscription", "nextChargeDate");
      if (action?.kind === "plan") {
        await grantPlan(userId, action.tier, typeof nextCharge === "number" ? nextCharge : undefined);
      } else if (action?.kind === "addon") {
        // e.g. the Cloud Storage subscription: each activation/renewal credits the pack.
        await aiGrantAddon(userId, action.pack);
      }
    } else if (type === "subscription.canceled" || type === "subscription.deactivated") {
      // Only a Golden/VIP cancellation lapses premium — cancelling the storage pack must not.
      const sku = String(pick(data, "product") ?? pick(data, "subscription", "product") ?? "");
      const action = skuAction(sku);
      if (action?.kind === "plan") await cancelPlan(userId);
    }
  }

  return NextResponse.json({ ok: true });
}
