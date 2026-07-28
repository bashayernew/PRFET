"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { User, Store, Mail, MapPin, Eye, EyeOff, Ruler, ImageDown, LogOut, ArrowLeft, ArrowRight, MessageCircle, Crown, Palette, Link2, Check, Lock } from "lucide-react";
import { useI18n, type Locale } from "@/lib/i18n";
import { apiGet, apiPatch, apiPost, apiDelete, logout, getAccessToken } from "@/lib/api";
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

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json())
      .then((d) => {
        const s = d?.settings ?? {};
        setTiers((prev) => ({
          1: typeof s.priceSubscription === "number" ? s.priceSubscription : prev[1],
          3: typeof s.priceSub3m === "number" ? s.priceSub3m : prev[3],
          6: typeof s.priceSub6m === "number" ? s.priceSub6m : prev[6],
          12: typeof s.priceSub12m === "number" ? s.priceSub12m : prev[12],
        }));
      })
      .catch(() => {});
  }, []);

  /** Buy a package from settings — it stacks on whatever time is left. */
  async function buyMonths(months: 1 | 3 | 6 | 12) {
    if (busySub) return;
    if (!confirm(t("settings.extendConfirm").replace("{price}", `$${tiers[months]}`))) return;
    setBusySub(true);
    const res = await apiPost<{ user: Me }>("/api/subscribe", { months }, getAccessToken() || undefined);
    setBusySub(false);
    if (res.ok && res.data?.user) { setMe(res.data.user); flash(t("settings.extended")); }
    else flash(t("common.error"));
  }

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
          <Toggle icon={<ImageDown className="h-4 w-4" />} label={t("register.media")} hint={t("register.mediaHint")} value={!!me?.allowSaveMedia} onChange={(v) => patch({ allowSaveMedia: v })} />
          <Toggle icon={<MessageCircle className="h-4 w-4" />} label={t("dm.closed")} hint={t("dm.closedHint")} value={!!me?.dmClosed} onChange={(v) => patch({ dmClosed: v })} />
          {/* parental lock: the "most viewed" doorway disappears from the home page */}
          <Toggle icon={<EyeOff className="h-4 w-4" />} label={t("settings.hideTop")} hint={t("settings.hideTopHint")} value={!!me?.hideTop} onChange={(v) => patch({ hideTop: v })} last={!isBusiness} />
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
              <div className="border-b border-slate-100 py-3">
                <p className="mb-2 text-[11.5px] font-medium leading-snug text-muted">{t("settings.extendHint")}</p>
                <div className="grid grid-cols-4 gap-2">
                  {([1, 3, 6, 12] as const).map((m) => (
                    <button key={m} onClick={() => buyMonths(m)} disabled={busySub}
                      className="flex flex-col items-center rounded-2xl border-2 border-slate-200 bg-white px-1 py-2.5 hover:border-brand-400 disabled:opacity-40">
                      <span className="text-[12px] font-extrabold text-ink">{t(`premium.m${m}`)}</span>
                      <span dir="ltr" className="mt-0.5 text-[12.5px] font-extrabold text-brand-700">${tiers[m]}</span>
                    </button>
                  ))}
                </div>
              </div>
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
            <div className="py-3">
              <p className="mb-1 flex items-center gap-1.5 text-[12.5px] font-bold text-ink"><Link2 className="h-4 w-4 text-brand-600" /> {t("profile.socials")}</p>
              <p className="mb-2.5 text-[11.5px] text-muted">{t("profile.socialsHint")}</p>
              <div className="flex flex-col gap-2">
                <SocialInput value={me?.social1 || ""} onSave={(v) => patch({ social1: v || null })} />
                <SocialInput value={me?.social2 || ""} onSave={(v) => patch({ social2: v || null })} />
                <SocialInput value={me?.social3 || ""} onSave={(v) => patch({ social3: v || null })} />
              </div>
            </div>
          </Section>
        ) : null /* non-premium users get the upgrade row in the Subscription section above */}

        <button onClick={async () => { if (confirm(t("profile.logoutConfirm"))) { await logout(); router.replace("/"); } }}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-red-200 bg-red-50 py-3.5 text-[15px] font-bold text-red-600 active:scale-[0.99]">
          <LogOut className="h-5 w-5" /> {t("profile.logout")}
        </button>
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
