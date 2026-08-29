"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { User, Store, Mail, MapPin, Eye, Ruler, ImageDown, LogOut, ArrowLeft, ArrowRight, MessageCircle, Crown, Palette, Link2, Check, Lock, Trash2, Bluetooth, Wallet } from "lucide-react";
import { useI18n, type Locale } from "@/lib/i18n";
import { apiGet, apiPatch, apiDelete, logout, getAccessToken } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";
import { Section, EditRow, Segmented, Toggle, SocialInput } from "@/components/profile-ui";
import { NAME_COLORS, OWNER_RED } from "@/lib/vip";

type Me = {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  realName: string | null;
  accountType: string;
  country: string | null;
  nationality: string | null;
  locale: string;
  dateOfBirth: string | null;
  address: string | null;
  visibility: string;
  showDistance: boolean;
  bleDiscoverable?: boolean;
  allowSaveMedia: boolean;
  dmClosed: boolean;
  hideTop: boolean;
  showAddress: boolean;
  isPremium: boolean;
  premiumUntil: string | null;
  autoRenew: boolean;
  isAdmin?: boolean;
  textColor: string | null;
  shareLocation: boolean;
  locationLat: number | null;
  locationLng: number | null;
  social1: string | null;
  social2: string | null;
  social3: string | null;
};

type Cap = { unlimited: boolean; cap: number; used: number; remaining: number };
type UsageData = { isPremium: boolean; tier: string; messages: Cap; images: Cap; videos: Cap; voiceMin: Cap; storageGb: Cap };

export default function SettingsScreen() {
  const router = useRouter();
  const { t, dir, locale, setLocale } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [me, setMe] = useState<Me | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busySub, setBusySub] = useState(false);
  // live package prices from the dashboard
  const [tiers, setTiers] = useState<Record<number, number>>({ 1: 4.99, 3: 13.99, 6: 26.99, 12: 53.99 });
  const [vaultOn, setVaultOn] = useState(true);
  const [usage, setUsage] = useState<UsageData | null>(null);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json())
      .then((d) => {
        const s = d?.settings ?? {};
        setVaultOn(s.vaultEnabled !== false);
        setTiers((prev) => ({
          1: typeof s.priceSubscription === "number" ? s.priceSubscription : prev[1],
          3: typeof s.priceSub3m === "number" ? s.priceSub3m : prev[3],
          6: typeof s.priceSub6m === "number" ? s.priceSub6m : prev[6],
          12: typeof s.priceSub12m === "number" ? s.priceSub12m : prev[12],
        }));
      })
      .catch(() => {});
  }, []);

  /** Cancel = stop auto-renewal; whatever's paid for keeps running to its end date. */
  async function cancelSub() {
    if (busySub) return;
    if (!confirm(t("settings.cancelConfirm"))) return;
    setBusySub(true);
    const res = await apiDelete<{ user: Me }>("/api/subscribe", getAccessToken() || undefined);
    setBusySub(false);
    if (res.ok && res.data?.user) { setMe(res.data.user); flash(t("settings.cancelled")); }
    else flash(t("common.error"));
  }

  /** Changed your mind — renewal switches back on. */
  async function resumeSub() {
    if (busySub) return;
    setBusySub(true);
    const res = await apiPatch<{ user: Me }>("/api/subscribe", {}, getAccessToken() || undefined);
    setBusySub(false);
    if (res.ok && res.data?.user) { setMe(res.data.user); flash(t("settings.resumed")); }
    else flash(t("common.error"));
  }

  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken();
    if (!token) return;
    apiGet<{ user: Me }>("/api/auth/me", token).then((res) => {
      if (res.ok && res.data?.user) setMe(res.data.user);
    });
    apiGet<UsageData>("/api/ai/usage", token).then((res) => {
      if (res.ok && res.data) setUsage(res.data);
    });
  }, [ready]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  async function patch(partial: Partial<Me>) {
    const token = getAccessToken();
    if (!token) return;
    const prev = me;
    setMe((m) => (m ? { ...m, ...partial } : m));
    const res = await apiPatch<{ user: Me }>("/api/auth/me", partial, token);
    if (res.ok && res.data?.user) {
      setMe(res.data.user);
      flash(t("profile.saved"));
    } else {
      setMe(prev);
      flash(res.status === 409 ? t("register.identifierTaken") : t("common.error"));
    }
  }

  function changeLanguage(l: Locale) {
    if (l === locale) return;
    setLocale(l);
    patch({ locale: l });
  }

  /** Set a password (if none was chosen at signup) or change the existing one. */
  async function savePassword(pw: string) {
    if (pw.trim().length < 8) { flash(t("register.passwordHint")); return; }
    const token = getAccessToken();
    if (!token) return;
    const res = await apiPatch<{ user: Me }>("/api/auth/me", { password: pw.trim() } as unknown as Partial<Me>, token);
    if (res.ok) flash(t("profile.saved")); else flash(t("common.error"));
  }

  /** Same behaviour as on the profile: turning it on grabs the phone's location once. */
  if (!ready) return null;
  const isBusiness = me?.accountType === "business";
  const nameColor = me?.isPremium && me?.textColor ? me.textColor : undefined;

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      {/* header */}
      <div className="flex items-center gap-3 bg-gradient-to-b from-brand-700 to-brand-600 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+14px)]">
        <button onClick={() => router.push("/profile")} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
          <Back className="h-5 w-5" />
        </button>
        <p className="text-[15px] font-extrabold text-white">{t("profile.settings")}</p>
      </div>

      {/* body */}
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-4">
        <Section title={t("profile.account")}>
          <EditRow
            icon={isBusiness ? <Store className="h-[18px] w-[18px]" /> : <User className="h-[18px] w-[18px]" />}
            label={t("profile.name")}
            value={me?.displayName || ""}
            colorStyle={nameColor ? { color: nameColor } : undefined}
            onSave={(v) => { if (v.trim().length >= 4) { localStorage.setItem("herot.name", v); patch({ displayName: v }); } }}
          />
          <EditRow icon={<Mail className="h-[18px] w-[18px]" />} label={t("register.email")} value={me?.email || ""} type="email" ltr onSave={(v) => { if (v) patch({ email: v }); }} />
          <EditRow icon={<Lock className="h-[18px] w-[18px]" />} label={t("register.password")} value="" type="password" ltr onSave={savePassword} last={!isBusiness} />
          {isBusiness && (
            <EditRow icon={<MapPin className="h-[18px] w-[18px]" />} label={t("register.address")} value={me?.address || ""} last onSave={(v) => patch({ address: v || null })} />
          )}
        </Section>

        <Section title={t("profile.language")}>
          <div className="px-1 py-1">
            <Segmented options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} value={locale} onChange={(v) => changeLanguage(v as Locale)} />
          </div>
        </Section>

        <Section title={t("register.privacy")}>
          {!isBusiness && (
            <div className="px-1 pb-1 pt-1">
              <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-bold text-ink">
                <Eye className="h-4 w-4 text-brand-600" /> {t("register.visibility")}
              </p>
              <Segmented options={[{ value: "public", label: t("register.public") }, { value: "friends", label: t("register.friends") }]} value={me?.visibility || "public"} onChange={(v) => patch({ visibility: v })} />
            </div>
          )}
          {/* precise-location control lives on the profile + home page, not here (per client) */}
          <Toggle icon={<Ruler className="h-4 w-4" />} label={t("register.distance")} hint={t("register.distanceHint")} value={!!me?.showDistance} onChange={(v) => patch({ showDistance: v })} />
          <Toggle icon={<Bluetooth className="h-4 w-4" />} label={t("ble.discoverable")} hint={t("ble.discoverableHint")} value={!!me?.bleDiscoverable} onChange={(v) => patch({ bleDiscoverable: v })} />
          <Toggle icon={<ImageDown className="h-4 w-4" />} label={t("register.media")} hint={t("register.mediaHint")} value={!!me?.allowSaveMedia} onChange={(v) => patch({ allowSaveMedia: v })} />
          <Toggle icon={<MessageCircle className="h-4 w-4" />} label={t("dm.closed")} hint={t("dm.closedHint")} value={!!me?.dmClosed} onChange={(v) => patch({ dmClosed: v })} last={!isBusiness} />
          {isBusiness && (
            <Toggle icon={<MapPin className="h-4 w-4" />} label={t("register.showAddress")} hint={t("register.showAddressHint")} value={!!me?.showAddress} onChange={(v) => patch({ showAddress: v })} last />
          )}
        </Section>

        {/* subscription — see the plan, change it, or leave it */}
        <Section title={t("settings.subscription")}>
          {me?.isPremium ? (
            <>
              <div className="flex items-center gap-3 border-b border-slate-100 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-500"><Crown className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-extrabold text-ink">{t("settings.premiumActive")}</p>
                  {me?.premiumUntil && (
                    <p className={`text-[11.5px] font-medium ${me?.autoRenew ? "text-muted" : "text-orange-600"}`}>
                      {t(me?.autoRenew ? "settings.autoRenewOn" : "settings.autoRenewOff")}{" "}
                      {new Date(me.premiumUntil).toLocaleDateString(locale === "ar" ? "ar" : "en-GB")}
                    </p>
                  )}
                </div>
              </div>
              <button onClick={() => router.push("/subscribe")} className="flex w-full items-center gap-3 border-b border-slate-100 py-3 text-start">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><Crown className="h-4 w-4" /></span>
                <span className="flex-1 text-[13px] font-bold text-ink">{t("settings.managePlan")}</span>
                <span className="text-muted">{dir === "rtl" ? "‹" : "›"}</span>
              </button>
              {me?.autoRenew ? (
                <button onClick={cancelSub} disabled={busySub}
                  className="flex w-full items-center justify-center gap-2 py-3 text-[13px] font-bold text-red-600 disabled:opacity-40">
                  {t("settings.cancelSub")}
                </button>
              ) : (
                <button onClick={resumeSub} disabled={busySub}
                  className="flex w-full items-center justify-center gap-2 py-3 text-[13px] font-bold text-emerald-600 disabled:opacity-40">
                  {t("settings.resumeSub")}
                </button>
              )}
            </>
          ) : (
            <button onClick={() => router.push("/subscribe")} className="flex w-full items-center gap-3 py-3 text-start">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-500"><Crown className="h-4 w-4" /></span>
              <span className="flex-1 text-[13px] font-bold text-ink">{t("premium.upgrade")}</span>
              <span dir="ltr" className="shrink-0 rounded-xl bg-amber-50 px-2.5 py-1 text-[12px] font-extrabold text-amber-600">${tiers[1]}</span>
            </button>
          )}
        </Section>

        {/* premium extras — the same controls the profile pencil reveals */}
        {me?.isPremium ? (
          <Section title={t("profile.premium")}>
            {usage && (
              <div className="border-b border-slate-100 py-3">
                <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-bold text-ink"><Crown className="h-4 w-4 text-amber-500" /> {t("settings.usageTitle")}</p>
                <div className="flex flex-col gap-1.5">
                  {([
                    { label: t("ask.uMessages"), c: usage.messages },
                    { label: t("ask.uImages"), c: usage.images },
                    { label: t("ask.uVideos"), c: usage.videos },
                    { label: t("ask.uVoice"), c: usage.voiceMin, unit: t("ask.uMin") },
                    { label: t("settings.usageStorage"), c: usage.storageGb, unit: "GB" },
                  ] as { label: string; c: Cap; unit?: string }[]).map((r, idx) => (
                    <div key={idx} className="flex items-center justify-between text-[12.5px]">
                      <span className="font-bold text-muted">{r.label}</span>
                      <span className="font-extrabold text-ink">
                        {r.c.unlimited ? t("settings.usageUnlimited") : `${r.c.used}${r.unit ? ` ${r.unit}` : ""} / ${r.c.cap}${r.unit ? ` ${r.unit}` : ""}`}
                      </span>
                    </div>
                  ))}
                </div>
                <button onClick={() => router.push("/subscribe")} className="mt-2.5 text-[12px] font-bold text-brand-600">{t("settings.usageManage")}</button>
              </div>
            )}
            {/* what your plan gives you — the AI features, colours, and the rest */}
            <div className="border-b border-slate-100 py-3">
              <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-bold text-ink"><Crown className="h-4 w-4 text-amber-500" /> {t("settings.includedTitle")}</p>
              <div className="flex flex-col gap-1.5">
                {["premium.gReview", "premium.gFeelings", "premium.gAdHelp", "premium.gCharacter", "premium.gColor", "premium.gLocation", "premium.gSocials", "premium.gVault"].map((k) => (
                  <div key={k} className="flex items-start gap-2 text-[12.5px]">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" strokeWidth={3} />
                    <span className="font-medium text-muted">{t(k)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-b border-slate-100 py-3">
              <p className="mb-1 flex items-center gap-1.5 text-[12.5px] font-bold text-ink"><Palette className="h-4 w-4 text-brand-600" /> {t("profile.textColor")}</p>
              <p className="mb-2.5 text-[11.5px] font-medium leading-snug text-muted">{t("profile.colorHint")}</p>
              <div className="flex flex-wrap gap-2.5">
                {(me?.isAdmin ? [...NAME_COLORS, OWNER_RED] : NAME_COLORS).map((c) => (
                  <button key={c} onClick={() => patch({ textColor: c })} style={{ backgroundColor: c }} aria-label={c}
                    className={`grid h-8 w-8 place-items-center rounded-full transition-all ${me?.textColor === c ? "ring-2 ring-offset-2 ring-brand-500" : ""}`}>
                    {me?.textColor === c && <Check className="h-4 w-4 text-white" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>
            <div className="border-b border-slate-100 py-3">
              <p className="mb-1 flex items-center gap-1.5 text-[12.5px] font-bold text-ink"><Link2 className="h-4 w-4 text-brand-600" /> {t("profile.socials")}</p>
              <p className="mb-2.5 text-[11.5px] text-muted">{t("profile.socialsHint")}</p>
              <div className="flex flex-col gap-2">
                <SocialInput value={me?.social1 || ""} onSave={(v) => patch({ social1: v || null })} />
                <SocialInput value={me?.social2 || ""} onSave={(v) => patch({ social2: v || null })} />
                <SocialInput value={me?.social3 || ""} onSave={(v) => patch({ social3: v || null })} />
              </div>
            </div>
            {vaultOn && (
              <button onClick={() => router.push("/vault")} className="flex w-full items-center gap-3 py-3 text-start">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-50 text-brand-600"><Lock className="h-4 w-4" /></span>
                <span className="flex-1">
                  <span className="block text-[13px] font-bold text-ink">{t("vault.title")}</span>
                  <span className="block text-[11.5px] font-medium text-muted">{t("vault.subtitle")}</span>
                </span>
                <span className="text-muted">{dir === "rtl" ? "‹" : "›"}</span>
              </button>
            )}
          </Section>
        ) : null /* non-premium users get the upgrade row in the Subscription section above */}

        {/* Wallet — available to everyone (top up, then spend on subscriptions/ads/gifts) */}
        <button onClick={() => router.push("/wallet")} className="mt-2 flex w-full items-center gap-3 rounded-2xl bg-white p-4 ring-1 ring-slate-100 active:scale-[0.99]">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-50 text-brand-600"><Wallet className="h-4 w-4" /></span>
          <span className="flex-1 text-start">
            <span className="block text-[13px] font-bold text-ink">{t("wallet.title")}</span>
            <span className="block text-[11.5px] font-medium text-muted">{t("wallet.subtitle")}</span>
          </span>
          <span className="text-muted">{dir === "rtl" ? "‹" : "›"}</span>
        </button>

        <button onClick={async () => { if (confirm(t("profile.logoutConfirm"))) { await logout(); router.replace("/"); } }}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-red-200 bg-red-50 py-3.5 text-[15px] font-bold text-red-600 active:scale-[0.99]">
          <LogOut className="h-5 w-5" /> {t("profile.logout")}
        </button>

        {/* Permanent account deletion — required by Google Play / App Store. Double-confirmed. */}
        <button
          onClick={async () => {
            if (!confirm(t("account.deleteConfirm1"))) return;
            if (!confirm(t("account.deleteConfirm2"))) return;
            const res = await apiDelete("/api/account", getAccessToken() || undefined);
            if (res.ok) { await logout(); router.replace("/"); }
            else { setToast(t("common.error")); setTimeout(() => setToast(null), 2000); }
          }}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[13.5px] font-bold text-red-500 active:scale-[0.99]">
          <Trash2 className="h-4 w-4" /> {t("account.delete")}
        </button>
        <p className="mt-1 text-center text-[11.5px] leading-snug text-muted">{t("account.deleteHint")}</p>

        <p className="mt-4 text-center text-[12px] text-muted">{t("profile.member")}</p>
      </div>

      {toast && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[13px] font-bold text-white shadow-lg">
          {toast}
        </motion.div>
      )}
    </div>
  );
}
