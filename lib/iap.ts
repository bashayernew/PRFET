import { apiPost, getAccessToken } from "@/lib/api";
import { ALL_SUB_PRODUCT_IDS } from "@/lib/iap-products";

/**
 * In-app purchases for the native apps, via RevenueCat.
 *
 * Everything here is a no-op on the web — the same code ships to browsers, where FastSpring
 * handles checkout instead (see `lib/billing.ts`). Plugins are imported dynamically with
 * variable specifiers so the web bundle never pulls in native modules.
 *
 * The client's job is only to present Apple's purchase sheet. Granting premium happens on
 * the server, from RevenueCat's webhook — `syncEntitlements()` just asks the server to look
 * again so the UI updates immediately instead of after webhook latency.
 */

type PurchasesPlugin = {
  configure(opts: { apiKey: string; appUserID?: string | null }): Promise<void>;
  logIn(opts: { appUserID: string }): Promise<unknown>;
  logOut(): Promise<unknown>;
  getOfferings(): Promise<{ current?: RcOffering | null; all?: Record<string, RcOffering> }>;
  purchaseStoreProduct(opts: { product: RcProduct }): Promise<unknown>;
  purchasePackage(opts: { aPackage: RcPackage }): Promise<unknown>;
  getProducts(opts: { productIdentifiers: string[] }): Promise<{ products: RcProduct[] }>;
  restorePurchases(): Promise<unknown>;
};

export type RcProduct = {
  identifier: string;
  title?: string;
  description?: string;
  priceString?: string;
  price?: number;
  currencyCode?: string;
};
export type RcPackage = { identifier: string; product: RcProduct };
export type RcOffering = { identifier: string; availablePackages: RcPackage[] };

let configured = false;

/**
 * Tell the server why purchases are unavailable.
 *
 * The paywall hides itself when it can't sell anything, which is right for members and
 * terrible for debugging: the reason lives in a WebView console on a phone that may be in
 * another country. This reuses the /api/call/diag reporter — it stores nothing, it just
 * prints to `docker compose logs app` so the cause is visible from the server.
 */
async function report(stage: string, detail: string): Promise<void> {
  try {
    await apiPost("/api/call/diag", { stage: `iap:${stage}`, detail }, getAccessToken() || undefined);
  } catch {
    // Diagnostics must never break the screen they are diagnosing.
  }
}

/**
 * True only inside the Capacitor native shell.
 *
 * ⚠️ This used to do `await import(capName)` with a VARIABLE specifier and
 * `webpackIgnore: true`. That combination tells the bundler to leave the import alone, so
 * at runtime the browser tried to resolve the bare specifier "@capacitor/core" as a URL,
 * which it cannot do. The import threw, the catch returned false, and isNative() was
 * therefore **always false — including inside the app**.
 *
 * The visible symptom was that the subscribe screen never showed purchase buttons, no
 * matter how correctly Play and RevenueCat were configured. It looked like a payments
 * problem and was a module-resolution problem.
 *
 * `window.Capacitor` is injected by the native shell and needs no import at all. This is
 * the same check lib/native-push.ts uses — and push notifications have always worked,
 * which is what gave the bug away.
 */
export async function isNative(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

async function plugin(): Promise<PurchasesPlugin | null> {
  if (!(await isNative())) return null;
  try {
    // A STATIC specifier, so the bundler code-splits it into a real chunk that exists at
    // runtime. Reached only after the isNative() check above, so the web bundle never
    // executes it. Same pattern as lib/native-push.ts.
    const mod = (await import("@revenuecat/purchases-capacitor")) as unknown as {
      Purchases?: PurchasesPlugin;
      default?: PurchasesPlugin;
    };
    return mod.Purchases ?? mod.default ?? null;
  } catch (e) {
    // Never silent: without this the paywall just disappears and there is nothing to debug.
    console.warn("[iap] RevenueCat plugin unavailable:", e);
    return null;
  }
}

/**
 * Start RevenueCat and tie it to this member.
 *
 * `appUserID` is our own user id — that is what makes the webhook able to say which account
 * a purchase belongs to. Call this on login and after the session is restored. Calling it
 * again with a different user switches accounts cleanly.
 */
export async function initPurchases(userId: string | null | undefined): Promise<boolean> {
  const p = await plugin();
  if (!p) {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    const why = !cap ? "window.Capacitor missing (not the native shell)"
      : !cap.isNativePlatform?.() ? "isNativePlatform() false"
      : "plugin import failed (SDK not in this build)";
    console.warn("[iap] no plugin:", why);
    report("no-plugin", why);
    return false;
  }

  // iOS and Android use different public keys; both are safe to ship in the client.
  const android = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
  const apiKey =
    (android
      ? process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY
      : process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY) || "";
  if (!apiKey || apiKey.startsWith("<")) {
    // "<paste key>" was the literal value on the server for months. Catch the placeholder
    // as well as an empty value, and say so — a missing key silently hides the paywall.
    console.warn(`[iap] no RevenueCat key for ${android ? "android" : "ios"} — paywall stays hidden`);
    return false;
  }

  try {
    if (!configured) {
      await p.configure({ apiKey, appUserID: userId || null });
      configured = true;
    } else if (userId) {
      await p.logIn({ appUserID: userId });
    }
    return true;
  } catch (e) {
    console.warn("[iap] configure failed:", e);
    return false;
  }
}

/** Detach the device from this member on sign-out, so the next login is not attributed to them. */
export async function endPurchasesSession(): Promise<void> {
  const p = await plugin();
  if (!p || !configured) return;
  await p.logOut().catch(() => {});
}

/**
 * The products to show on the paywall, with Apple's localised prices.
 *
 * Prefer the configured Offering (so you can change the paywall from RevenueCat's dashboard
 * without shipping an app update); fall back to fetching the ids directly.
 */
export async function listProducts(): Promise<RcProduct[]> {
  const p = await plugin();
  if (!p) return [];
  try {
    const offerings = await p.getOfferings();
    const packages = offerings?.current?.availablePackages ?? [];
    if (packages.length) return packages.map((pkg) => pkg.product);
  } catch {
    /* fall through */
  }
  try {
    const { products } = await p.getProducts({ productIdentifiers: ALL_SUB_PRODUCT_IDS });
    return products ?? [];
  } catch {
    return [];
  }
}

/**
 * Buy a product. Apple shows its own sheet; we get back either success or a cancellation.
 *
 * On success we ask the server to re-check with RevenueCat rather than telling it what was
 * bought — the client's claim is worth nothing, and the server ignores it by design.
 */
export async function buy(productId: string, token: string): Promise<{ ok: boolean; cancelled?: boolean; error?: string }> {
  const p = await plugin();
  if (!p) return { ok: false, error: "not_native" };

  try {
    const offerings = await p.getOfferings().catch(() => null);
    const pkg = offerings?.current?.availablePackages?.find((x) => x.product?.identifier === productId);

    if (pkg) {
      await p.purchasePackage({ aPackage: pkg });
    } else {
      const { products } = await p.getProducts({ productIdentifiers: [productId] });
      const product = products?.[0];
      if (!product) return { ok: false, error: "product_unavailable" };
      await p.purchaseStoreProduct({ product });
    }

    await syncEntitlements(token);
    return { ok: true };
  } catch (err) {
    // The user backing out of Apple's sheet is not an error worth showing them.
    const e = err as { code?: string | number; message?: string; userCancelled?: boolean };
    const msg = String(e?.message || "");
    if (e?.userCancelled || /cancel/i.test(msg)) return { ok: false, cancelled: true };
    return { ok: false, error: msg || "purchase_failed" };
  }
}

/**
 * "Restore Purchases". Apple REQUIRES this to be reachable in any app selling
 * non-consumables or subscriptions — an app without it gets rejected under Guideline 3.1.1.
 */
export async function restore(token: string): Promise<boolean> {
  const p = await plugin();
  if (!p) return false;
  try {
    await p.restorePurchases();
    await syncEntitlements(token);
    return true;
  } catch {
    return false;
  }
}

/** Ask our server to re-read this member's entitlements from RevenueCat and apply them. */
export async function syncEntitlements(token: string): Promise<boolean> {
  try {
    await apiPost("/api/iap/sync", {}, token);
    return true;
  } catch {
    return false;
  }
}
