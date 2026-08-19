"use client";

import { useEffect, useState } from "react";

/**
 * FastSpring Store Builder Library (SBL) — the popup checkout for the WEB browser.
 *
 * Set NEXT_PUBLIC_FASTSPRING_STOREFRONT to your popup storefront (from the FastSpring
 * dashboard, e.g. "yourstore.onfastspring.com/popup-yourstore"). When it's set, the Subscribe
 * and add-on buttons open the FastSpring popup with the member's id attached as a `uid` tag,
 * so our /api/webhooks/fastspring endpoint credits the right account after payment. When it's
 * NOT set, the app keeps its current (contact-admin / self-serve) behaviour.
 */
const STOREFRONT = process.env.NEXT_PUBLIC_FASTSPRING_STOREFRONT || "";
export const fastspringEnabled = !!STOREFRONT;

// Product paths — default to the actual PRFET FastSpring products, so no env vars are needed
// for them. (Override via env only if you rename a product in FastSpring.)
export const FS_PATHS = {
  golden: process.env.NEXT_PUBLIC_FS_GOLDEN || "prfet-app-gold-monthly-subscription",
  vip: process.env.NEXT_PUBLIC_FS_VIP || "prfet-vip-subscription",
  voice: process.env.NEXT_PUBLIC_FS_ADDON_VOICE || "prfet-voice-communication-add-on",
  media: process.env.NEXT_PUBLIC_FS_ADDON_MEDIA || "prfet-media-chat-add-on",
  storage: process.env.NEXT_PUBLIC_FS_ADDON_STORAGE || "prfet-cloud-storage-subscription",
};

type FsBuilder = { push: (o: unknown) => void; checkout: () => void };
type FsWindow = Window & { fastspring?: { builder?: FsBuilder }; __fsOnComplete?: () => void; __fsWebhookReceived?: () => void };

let injected = false;

/** Loads the SBL script once and returns a `checkout(path, uid)` that opens the popup. */
export function useFastSpring(onComplete?: () => void) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!STOREFRONT || typeof window === "undefined") return;
    const w = window as FsWindow;
    w.__fsOnComplete = onComplete;
    if (injected) { if (w.fastspring?.builder) setReady(true); return; }
    injected = true;
    w.__fsWebhookReceived = () => { w.__fsOnComplete?.(); };
    const s = document.createElement("script");
    s.id = "fsc-api";
    s.type = "text/javascript";
    s.src = "https://sbl.onfastspring.com/sbl/1.0.7/fastspring-builder.min.js";
    s.setAttribute("data-storefront", STOREFRONT);
    s.setAttribute("data-popup-webhook-received", "__fsWebhookReceived");
    s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, [onComplete]);

  function checkout(path: string, uid: string) {
    const w = window as FsWindow;
    const b = w.fastspring?.builder;
    if (!b) return false;
    // reset clears any previous cart; the uid tag is how the webhook maps the sale to the user.
    b.push({ reset: true, products: [{ path, quantity: 1 }], tags: { uid }, checkout: true });
    return true;
  }

  return { ready, checkout };
}
