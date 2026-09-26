"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, Crown, Check, Palette, MapPin, Link2, Store, MessageSquareText, ImageIcon, HardDrive, MessageCircle, Phone, Sparkles, Lock } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useRequireAuth } from "@/lib/use-auth";
import { apiPost, apiGet, getAccessToken } from "@/lib/api";
import { useFastSpring, fastspringEnabled, FS_PATHS } from "@/components/fastspring-checkout";
import { isNative, initPurchases, buy, restore, listProducts } from "@/lib/iap";
import { SUB_PRODUCTS, ADDON_PRODUCTS } from "@/lib/iap-products";

// Fill {placeholders} in a translated string with live numbers from the dashboard settings.
const fill = (str: string, vars: Record<string, number | string>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), str);
const num = (x: unknown, d: number) => (typeof x === "number" ? x : d);

export default function SubscribeScreen() {
  const router = useRouter();
  const { t, dir } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  // Two monthly plans only — Golden (basic) and VIP — plus the add-on prices. No bundles.
  const [tier, setTier] = useState<"basic" | "vip">("basic");
  const [goldMonthly, setGoldMonthly] = useState(5.99);
  const [vipMonthly, setVipMonthly] = useState(10.99);
  const [addon, setAddon] = useState({ voice: 1.99, media: 1.99, storage: 1.99 });
  // Per-tier limits shown on the plan cards — pulled live from the dashboard settings.
  const [caps, setCaps] = useState({
    gImages: 35, gVideos: 9, gMessages: 4000, gCalls: 2000, gStorage: 25,
    vImages: 100, vVideos: 20, vMessages: 7500, vCalls: 480, vStorage: 50,
  });
  const [toast, setToast] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [uid, setUid] = useState("");
  /** Running inside the Capacitor shell — decides store checkout vs web checkout. */
  const [native, setNative] = useState(false);
  /** productId -> the store's own localised price string, e.g. "KWD 1.850". */
  const [storePrices, setStorePrices] = useState<Record<string, string>>({});
  const { checkout } = useFastSpring(() => { setToast(t("premium.paidThanks")); setTimeout(() => setToast(null), 3500); });

  useEffect(() => {
    apiGet<{ user: { id: string } }>("/api/auth/me", getAccessToken() || undefined).then((r) => {
      if (r.ok && r.data?.user) setUid(r.data.user.id);
    });
    // RevenueCat has to know which account is buying, or the webhook can't attribute the
    // purchase to anyone. isNative() is false on the web, where this whole path is skipped.
    /**
     * `native` gates the in-app store UI, so it must mean "purchases actually work here",
     * not merely "we are inside the app".
     *
     * isNative() only checks for @capacitor/core. The RevenueCat plugin is a separate
     * dependency and is currently NOT bundled in the Android build — Google requires Play
     * Billing Library 8, and no Capacitor 6 release of the plugin ships it (v11 is the
     * first, and needs Capacitor 7). It is also inert without a RevenueCat API key.
     *
     * Keying this off isNative() alone meant the app showed Buy buttons that could only
     * fail. initPurchases() returns false when the plugin is missing OR the key is unset,
     * which is exactly the condition for hiding them.
     */
    isNative().then(async (n) => {
      if (!n) { setNative(false); return; }
      const me = await apiGet<{ user: { id: string } }>("/api/auth/me", getAccessToken() || undefined);
      const ready = me.ok && me.data?.user?.id ? await initPurchases(me.data.user.id) : false;
      setNative(ready);
      if (!ready) return;
      /**
       * Inside the app, show the price the STORE will actually charge.
       *
       * The dashboard price and the Play/App Store price are separate systems and nothing
       * syncs them — change the dashboard and the app advertises one number while Google
       * bills another, which is both dishonest to the user and a store policy problem.
       * `priceString` is the authoritative figure, already localised (a Kuwaiti user sees
       * KWD, not converted dollars), so it can't drift out of date.
       */
      listProducts().then((items) => {
        if (!items.length) return;
        const map: Record<string, string> = {};
        for (const it of items) if (it.identifier && it.priceString) map[it.identifier] = it.priceString;
        setStorePrices(map);
      }).catch(() => { /* fall back to the dashboard figure */ });
    });
    fetch("/api/settings").then((r) => r.json())
      .then((d) => {
        const s = d?.settings ?? {};
        if (typeof s.priceSubscription === "number") setGoldMonthly(s.priceSubscription);
        if (typeof s.priceVip === "number") setVipMonthly(s.priceVip);
        setAddon({
          voice: typeof s.priceAddonVoice === "number" ? s.priceAddonVoice : 1.99,
          media: typeof s.priceAddonMedia === "number" ? s.priceAddonMedia : 1.99,
          storage: typeof s.priceAddonStorage === "number" ? s.priceAddonStorage : 1.99,
        });
        setCaps({
          gImages: num(s.aiImagesBasic, 35), gVideos: num(s.aiVideosBasic, 9),
          gMessages: num(s.aiMessagesBasic, 4000), gCalls: num(s.callMinutesBasic, 2000), gStorage: num(s.storageGbBasic, 25),
          vImages: num(s.aiImagesVip, 100), vVideos: num(s.aiVideosVip, 20),
          vMessages: num(s.aiMessagesVip, 7500), vCalls: num(s.callMinutesVip, 480), vStorage: num(s.storageGbVip, 50),
        });
      })
      .catch(() => {});
  }, []);

  const price = tier === "vip" ? vipMonthly : goldMonthly;
  /** What to put on screen: the store's figure in the app, the dashboard's on the web. */
  const shownPrice = storePrices[tier === "vip" ? SUB_PRODUCTS.vip1m : SUB_PRODUCTS.basic1m] ?? `$${price}`;

  /**
   * Add-ons are paid for from the CREDIT WALLET, on web and in the app alike.
   *
   * They used to be a direct store purchase in the native app, which meant a separate
   * store product per pack and a second card transaction even for members who already had
   * a balance. Ads and job posts already spend from the wallet — because their prices are
   * dynamic and the stores only allow fixed price points — so routing add-ons the same way
   * means one top-up covers everything.
   *
   * Subscriptions are the exception and still go through the store (see buyPlan): Google
   * requires Play Billing for auto-renewing subscriptions, and selling those another way
   * inside the app is what gets apps removed.
   */
  async function buyAddon(pack: "voice" | "media" | "storage") {
    if (!native && fastspringEnabled) { checkout(FS_PATHS[pack], uid); return; }
    if (buying) return;
    setBuying(true);
    const res = await apiPost<{ error?: string; price?: number; needCents?: number }>(
      "/api/ai/addon",
      { pack },
      getAccessToken() || undefined,
    );
    setBuying(false);

    // Not enough credit: say so plainly and point at the wallet, rather than a generic error.
    if (!res.ok && res.data?.error === "insufficient_credits") {
      setToast(t("premium.needCredits"));
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setToast(res.ok ? t("premium.addonDone") : t("common.error"));
    setTimeout(() => setToast(null), 2200);
  }

  /**
   * Subscribe to the selected plan.
   *
   * Inside the native app this goes through Play Billing (via RevenueCat) and NOT FastSpring.
   * That isn't a preference — Google requires digital goods sold inside an Android app to use
   * Play Billing, and routing subscriptions to an external card checkout is the kind of
   * violation apps get pulled from the store for. On the web, where Play policy doesn't
   * apply, FastSpring stays.
   *
   * Premium is never granted from here. `buy()` only presents the store sheet; entitlement
   * arrives server-side from the RevenueCat webhook, so a tampered client can't grant itself
   * anything.
   */
  async function buyPlan() {
    if (native) {
      if (buying) return;
      setBuying(true);
      const res = await buy(tier === "vip" ? SUB_PRODUCTS.vip1m : SUB_PRODUCTS.basic1m, getAccessToken() || "");
      setBuying(false);
      if (res.cancelled) return; // user backed out of the store sheet — not an error
      setToast(res.ok ? t("premium.paidThanks") : t("common.error"));
      setTimeout(() => setToast(null), 3500);
      return;
    }
    if (fastspringEnabled) { checkout(tier === "vip" ? FS_PATHS.vip : FS_PATHS.golden, uid); return; }
    router.push("/contact");
  }

  /** Re-attach a subscription bought on another device or after a reinstall. */
  async function restorePurchases() {
    if (buying) return;
    setBuying(true);
    const ok = await restore(getAccessToken() || "");
    setBuying(false);
    setToast(ok ? t("wallet.restored") : t("common.error"));
    setTimeout(() => setToast(null), 2600);
  }

  if (!ready) return null;

  const shell = "mx-auto flex min-h-[100dvh] max-w-[480px] flex-col bg-slate-50";

  return (
    <div dir={dir} className={shell}>
      {/* header */}
      <div className="bg-gradient-to-b from-brand-700 to-brand-600 px-5 pb-8 pt-[calc(env(safe-area-inset-top)+14px)]">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/profile")} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
            <Back className="h-5 w-5" strokeWidth={2.4} />
          </button>
          <h1 className="text-[18px] font-extrabold text-white">{t("premium.title")}</h1>
        </div>
      </div>

      <div className="no-scrollbar -mt-4 flex-1 overflow-y-auto px-5 pb-5">
        {/* tier toggle — Basic vs VIP */}
        <div className="mb-4 flex gap-2 rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-slate-100">
          <button onClick={() => setTier("basic")}
            className={`flex-1 rounded-xl py-2.5 text-[13.5px] font-extrabold transition-all ${tier === "basic" ? "bg-brand-600 text-white" : "text-muted"}`}>
            {t("premium.basic")}
          </button>
          <button onClick={() => setTier("vip")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[13.5px] font-extrabold transition-all ${tier === "vip" ? "bg-gradient-to-l from-amber-500 to-yellow-400 text-white" : "text-amber-600"}`}>
            <Crown className="h-4 w-4" /> {t("premium.vip")}
          </button>
        </div>

        {/* plan card — informational */}
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <div className="flex items-center gap-3">
            <span className={`grid h-12 w-12 place-items-center rounded-2xl ${tier === "vip" ? "bg-amber-100 text-amber-600" : "bg-amber-50 text-amber-500"}`}>
              <Crown className="h-7 w-7" />
            </span>
            <div className="flex-1">
              <p className="text-[16px] font-extrabold text-ink">{t(tier === "vip" ? "premium.vipName" : "premium.goldName")}</p>
              <p className="text-[12.5px] font-medium text-muted">{t("premium.tagline")}</p>
            </div>
            <div className="text-end">
              <p dir="ltr" className="text-[22px] font-extrabold text-brand-700">{shownPrice}</p>
              <p className="text-[10.5px] font-bold text-muted">{t("premium.perMonth")}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2.5 border-t border-slate-100 pt-4">
            <Perk icon={<ImageIcon className="h-4 w-4" />} label={fill(t(tier === "vip" ? "premium.vImages" : "premium.gImages"), { img: tier === "vip" ? caps.vImages : caps.gImages, vid: tier === "vip" ? caps.vVideos : caps.gVideos })} />
            <Perk icon={<HardDrive className="h-4 w-4" />} label={fill(t(tier === "vip" ? "premium.vStorage" : "premium.gStorage"), { gb: tier === "vip" ? caps.vStorage : caps.gStorage })} />
            <Perk icon={<MessageCircle className="h-4 w-4" />} label={fill(t(tier === "vip" ? "premium.vMessages" : "premium.gMessages"), { n: tier === "vip" ? caps.vMessages : caps.gMessages })} />
            <Perk icon={<Phone className="h-4 w-4" />} label={fill(t(tier === "vip" ? "premium.vCalls" : "premium.gCalls"), { min: tier === "vip" ? caps.vCalls : caps.gCalls })} />
            <Perk icon={<Sparkles className="h-4 w-4" />} label={t("premium.gCharacter")} />
            <Perk icon={<Sparkles className="h-4 w-4" />} label={t("premium.gReview")} />
            <Perk icon={<Sparkles className="h-4 w-4" />} label={t("premium.gFeelings")} />
            <Perk icon={<Sparkles className="h-4 w-4" />} label={t("premium.gAdHelp")} />
            <Perk icon={<Lock className="h-4 w-4" />} label={t("premium.gVault")} />
            <Perk icon={<Palette className="h-4 w-4" />} label={t("premium.gColor")} />
            <Perk icon={<MapPin className="h-4 w-4" />} label={t("premium.gLocation")} />
            <Perk icon={<Link2 className="h-4 w-4" />} label={t("premium.gSocials")} />
          </div>
        </div>

        {/* buyable add-on packs — top up on your plan */}
        <div className="mt-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <p className="mb-3 text-[14px] font-extrabold text-ink">{t("premium.addonsTitle")}</p>
          <div className="flex flex-col gap-2.5">
            <Addon icon={<Phone className="h-4 w-4" />} title={t("premium.addonVoice")} sub={t("premium.addonVoiceSub")} priceLabel={storePrices[ADDON_PRODUCTS.voice] ?? `$${addon.voice}`} per={t("premium.m1")} onBuy={() => buyAddon("voice")} disabled={buying} />
            <Addon icon={<ImageIcon className="h-4 w-4" />} title={t("premium.addonMedia")} sub={t("premium.addonMediaSub")} priceLabel={storePrices[ADDON_PRODUCTS.media] ?? `$${addon.media}`} per={t("premium.m1")} onBuy={() => buyAddon("media")} disabled={buying} />
            <Addon icon={<HardDrive className="h-4 w-4" />} title={t("premium.addonStorage")} sub={t("premium.addonStorageSub")} priceLabel={storePrices[ADDON_PRODUCTS.storage] ?? `$${addon.storage}`} per={t("premium.m3")} onBuy={() => buyAddon("storage")} disabled={buying} />
          </div>
          <p className="mt-3 text-[11px] font-medium leading-snug text-muted">{t("premium.addonsHint")}</p>
        </div>

        {/* how to subscribe — store billing (in the app) or an admin grant */}
        <div className="mt-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <div className="mb-2 flex items-center gap-2">
            <Store className="h-5 w-5 text-brand-600" />
            <p className="text-[14px] font-extrabold text-ink">{t("premium.payVia")}</p>
          </div>
          <p className="text-[12.5px] font-medium leading-relaxed text-muted">{t("premium.payViaHint")}</p>
          {/* In the app the button is always shown — Play Billing is always available there.
              On the web it depends on FastSpring being configured. */}
          {native || fastspringEnabled ? (
            <>
              <button
                onClick={buyPlan}
                disabled={buying}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-[14px] font-extrabold text-white disabled:opacity-60 active:scale-95"
              >
                <Crown className="h-4 w-4" /> {t("premium.subscribeCard").replace("{price}", shownPrice)}
              </button>
              {/* Stores require a visible way to restore a purchase — without it, anyone who
                  reinstalls or changes phone loses what they paid for, and review flags it. */}
              {native && (
                <button onClick={restorePurchases} disabled={buying} className="mt-2 w-full text-center text-[12px] font-bold text-brand-600 disabled:opacity-60">
                  {t("wallet.restore")}
                </button>
              )}
              <button onClick={() => router.push("/contact")} className="mt-2 w-full text-center text-[12px] font-bold text-muted">
                {t("premium.contactAdmin")}
              </button>
            </>
          ) : (
            <button
              onClick={() => router.push("/contact")}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-[14px] font-bold text-white active:scale-95"
            >
              <MessageSquareText className="h-4 w-4" /> {t("premium.contactAdmin")}
            </button>
          )}
        </div>
      </div>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-6">
          <div className="rounded-full bg-ink px-4 py-2.5 text-[13px] font-bold text-white shadow-lg">{toast}</div>
        </div>
      )}
    </div>
  );
}

function Perk({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">{icon}</span>
      <span className="flex-1 text-[13px] font-bold text-ink">{label}</span>
      <Check className="h-4 w-4 text-emerald-500" strokeWidth={3} />
    </div>
  );
}

/** `priceLabel` so the store's own string can be passed through when we have one. */
function Addon({ icon, title, sub, priceLabel, per, onBuy, disabled }: { icon: React.ReactNode; title: string; sub: string; priceLabel: string; per: string; onBuy: () => void; disabled?: boolean }) {
  return (
    <button onClick={onBuy} disabled={disabled}
      className="flex w-full items-center gap-3 rounded-2xl border-2 border-slate-100 p-3 text-start transition-colors hover:border-brand-300 active:scale-[0.99] disabled:opacity-50">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-extrabold text-ink">{title}</p>
        <p className="text-[11.5px] font-medium text-muted">{sub}</p>
      </div>
      <div className="text-end">
        <p dir="ltr" className="text-[15px] font-extrabold text-brand-700">{priceLabel}</p>
        <p className="text-[10px] font-bold text-muted">{per}</p>
      </div>
    </button>
  );
}
