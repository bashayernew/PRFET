"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Megaphone,
  Plus,
  ArrowLeft,
  ArrowRight,
  Eye,
  Clock,
  UploadCloud,
  Check,
  MessageCircle,
  ChevronDown,
  Trash2,
} from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { COUNTRIES } from "@/lib/countries";
import BottomNav from "@/components/bottom-nav";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, apiPost, apiDelete, apiUpload, getAccessToken } from "@/lib/api";
import PaymentSheet from "@/components/payment-sheet";

const DURATIONS = [1, 2, 3, 7, 15, 30];
// COUNTRIES now sourced from lib/countries


type RealAd = {
  id: string;
  caption: string | null;
  country: string;
  mediaUrl: string | null;
  advertiser: string;
  userId: string;
};

type MyAd = {
  id: string;
  caption: string | null;
  country: string;
  durationDays: number;
  price: number;
  mediaUrl: string | null;
  status: string;
  views: number;
  advertiser: string;
};

export default function AdsScreen() {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [mode, setMode] = useState<"feed" | "create">("feed");
  const [countries, setCountries] = useState<string[]>([
    (typeof window !== "undefined" && localStorage.getItem("herot.country")) || "KW",
  ]);
  const [countryOpen, setCountryOpen] = useState(false);
  const [countryQ, setCountryQ] = useState("");
  const [duration, setDuration] = useState(3);
  const [durOpen, setDurOpen] = useState(false);
  const [sumOpen, setSumOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileObj, setFileObj] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<"image" | "video" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [myAds, setMyAds] = useState<MyAd[]>([]);
  const [realAds, setRealAds] = useState<RealAd[]>([]);
  // live ad pricing from the dashboard: base = 1 country + 1 day, then increments
  const [adBase, setAdBase] = useState(49.99);
  const [extraCountry, setExtraCountry] = useState(15);
  const [extraDay, setExtraDay] = useState(11);
  const [freeLeft, setFreeLeft] = useState(0); // free ad credits gifted by the admin
  const [payOpen, setPayOpen] = useState(false);
  const [adsOn, setAdsOn] = useState(true); // dashboard switch: posting new ads on/off (feed stays either way)

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json())
      .then((d) => {
        const s = d?.settings ?? {};
        if (typeof s.priceAdBase === "number") setAdBase(s.priceAdBase);
        if (typeof s.priceAdExtraCountry === "number") setExtraCountry(s.priceAdExtraCountry);
        if (typeof s.priceAdExtraDay === "number") setExtraDay(s.priceAdExtraDay);
        setAdsOn(s.adsEnabled !== false);
      })
      .catch(() => {});
    const tok = getAccessToken();
    if (tok) apiGet<{ user: { freeAdsLeft?: number } }>("/api/auth/me", tok).then((r) => { if (r.ok && r.data?.user) setFreeLeft(r.data.user.freeAdsLeft ?? 0); });
  }, []);

  const adTotal = (nCountries: number, days: number) =>
    adBase + (Math.max(1, nCountries) - 1) * extraCountry + (Math.max(1, days) - 1) * extraDay;
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    const res = await apiGet<{ ads: MyAd[] }>("/api/ads", token);
    if (res.ok && res.data?.ads) setMyAds(res.data.ads);
    // live ads from real users (shown to everyone in the feed)
    const served = await apiGet<{ ads: RealAd[] }>("/api/ads/serve?limit=100");
    if (served.ok && served.data?.ads) setRealAds(served.data.ads);
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  if (!ready) return null;

  const total = adTotal(countries.length, duration).toFixed(2);
  const countryOf = (code: string) => COUNTRIES.find((c) => c.code === code);

  async function publish() {
    const token = getAccessToken() || undefined;
    // the image is optional — but an ad with no image and no text is nothing at all
    if (!fileObj && !caption.trim()) { setToast(t("ads.needSomething")); setTimeout(() => setToast(null), 2200); return; }
    let mediaUrl: string | undefined;
    if (fileObj) {
      const up = await apiUpload<{ url: string }>("/api/upload", fileObj, token);
      if (!up.ok || !up.data?.url) { setToast(t("common.error")); setTimeout(() => setToast(null), 2200); return; }
      mediaUrl = up.data.url;
    }
    const res = await apiPost<{ id: string }>(
      "/api/ads",
      { countries, durationDays: duration, caption: caption.trim() || undefined, mediaName: fileName || undefined, mediaUrl },
      token
    );
    if (res.ok) {
      setToast(t("ads.published"));
      await load();
      setTimeout(() => {
        setToast(null);
        setMode("feed");
        setFileName(null);
        setFileObj(null);
        setCaption("");
      }, 1500);
    }
  }

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      {/* header */}
      <div className="bg-gradient-to-b from-brand-700 to-brand-600 px-5 pb-6 pt-[calc(env(safe-area-inset-top)+16px)]">
        {mode === "create" ? (
          <div className="flex items-center gap-3">
            <button onClick={() => setMode("feed")} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
              <Back className="h-5 w-5" strokeWidth={2.4} />
            </button>
            <p className="text-[18px] font-extrabold text-white">{t("ads.create")}</p>
          </div>
        ) : (
          <p className="text-[20px] font-extrabold text-white">{t("ads.title")}</p>
        )}
      </div>

      {mode === "feed" ? (
        <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-4 pt-5">
          {/* create CTA — always available; when the dashboard pauses paid ads, posting is just free */}
          <motion.button
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => setMode("create")}
            className="relative flex w-full items-center gap-3 overflow-hidden rounded-3xl bg-gradient-to-l from-brand-800 to-brand-600 p-4 text-start"
          >
            <div className="pointer-events-none absolute -left-6 -top-8 h-28 w-28 rounded-full bg-white/10" />
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15 text-white">
              <Megaphone className="h-6 w-6" />
            </span>
            <div className="flex-1">
              <p className="text-[15px] font-extrabold text-white">{t("ads.create")}</p>
              <p className="mt-0.5 text-[12px] leading-snug text-brand-100">{t("ads.createSub")}</p>
            </div>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-brand-700">
              <Plus className="h-5 w-5" strokeWidth={2.6} />
            </span>
          </motion.button>

          {/* your ads */}
          {myAds.length > 0 && (
            <>
              <h2 className="mb-2 mt-6 text-[15px] font-extrabold text-ink">{t("ads.yourAds")}</h2>
              <div className="flex flex-col gap-3">
                {myAds.map((ad) => {
                  const codes = ad.country.split(",");
                  const c = countryOf(codes[0]);
                  const pending = ad.status === "pending";
                  return (
                    <div
                      key={ad.id}
                      onClick={() => router.push(`/ad/${ad.id}`)}
                      role="button"
                      className="cursor-pointer overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100 active:scale-[0.99]"
                    >
                      <div className="relative grid h-28 place-items-center bg-gradient-to-br from-brand-600 to-accent-600">
                        {ad.mediaUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={ad.mediaUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                        ) : (
                          <Megaphone className="h-11 w-11 text-white/90" strokeWidth={1.6} />
                        )}
                        <span className="absolute start-3 top-3 rounded-md bg-black/25 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-white">
                          {t("ads.sponsored")}
                        </span>
                        <span className={`absolute end-3 top-3 rounded-md px-2 py-0.5 text-[10.5px] font-bold text-white ${pending ? "bg-amber-500" : "bg-emerald-500"}`}>
                          {pending ? t("ads.pending") : t("ads.active")}
                        </span>
                      </div>
                      <div className="p-3.5">
                        <p className="text-[14px] font-extrabold text-ink">{ad.caption || ad.advertiser}</p>
                        <div className="mt-1 flex items-center gap-2 text-[11.5px] font-medium text-muted">
                          <span>{codes.length > 1 ? `${ld(codes.length, locale)} ${t("ads.countries")}` : c ? `${c.flag} ${locale === "ar" ? c.ar : c.en}` : ad.country}</span>
                          <span>·</span>
                          <span>{ld(ad.durationDays, locale)} {ad.durationDays === 1 ? t("ads.day") : t("ads.days")}</span>
                          <span className="ms-auto flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> {ld(ad.views, locale)}</span>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!confirm(t("ads.deleteConfirm"))) return;
                              await apiDelete(`/api/ads/${ad.id}`, getAccessToken() || undefined);
                              load();
                            }}
                            className="text-red-500"
                            aria-label={t("ads.delete")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* feed */}
          <h2 className="mb-2 mt-6 text-[15px] font-extrabold text-ink">{t("ads.feed")}</h2>
          <div className="flex flex-col gap-4">
            {realAds.length === 0 && (
              <p className="rounded-2xl bg-white py-8 text-center text-[13px] font-bold text-muted ring-1 ring-slate-100">{t("ads.noneToday")}</p>
            )}
            {/* real ads from users — advertiser is one tap away.
                Exclude my own ads here; they already show in "Your ads" above (no duplicates). */}
            {realAds.filter((ad) => !myAds.some((m) => m.id === ad.id)).map((ad, i) => (
              <motion.div
                key={ad.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                onClick={() => router.push(`/ad/${ad.id}`)}
                role="button"
                className="cursor-pointer overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100 active:scale-[0.99]"
              >
                <div className="relative grid h-36 place-items-center bg-gradient-to-br from-brand-600 to-accent-600 px-6">
                  {ad.mediaUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ad.mediaUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <p className="line-clamp-3 text-center text-[17px] font-extrabold leading-snug text-white drop-shadow">{ad.caption}</p>
                  )}
                  <span className="absolute start-3 top-3 rounded-md bg-black/25 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-white">
                    {t("ads.sponsored")}
                  </span>
                </div>
                <div className="flex items-center gap-3 p-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-extrabold text-ink">{ad.caption || ad.advertiser}</p>
                    <p className="truncate text-[12px] font-medium text-muted">{ad.advertiser}</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); router.push(`/messages/${ad.userId}`); }}
                    className="flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2 text-[12.5px] font-bold text-white active:scale-95"
                  >
                    <MessageCircle className="h-4 w-4" /> {t("home.message")}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      ) : (
        <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-4 pt-5">
          {/* ad text */}
          <h3 className="mb-2 text-[13px] font-extrabold text-ink">{t("ads.text")}</h3>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={t("ads.textPh")}
            rows={2}
            className="mb-5 w-full rounded-2xl border-2 border-slate-200 bg-white px-3.5 py-2.5 text-[14px] font-medium text-ink outline-none transition-colors placeholder:font-normal placeholder:text-muted focus:border-brand-500"
          />

          {/* targeting + duration — rectangular dropdowns side by side */}
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <h3 className="mb-2 text-[13px] font-extrabold text-ink">{t("ads.country")}</h3>
              <button
                onClick={() => { setCountryOpen((o) => !o); setDurOpen(false); }}
                className="flex h-12 w-full items-center justify-between gap-1 rounded-2xl border-2 border-slate-200 bg-white px-3 text-[13px] font-bold text-ink"
              >
                <span className="truncate">
                  {countries.length === 1
                    ? (() => { const c = countryOf(countries[0]); return c ? `${c.flag} ${locale === "ar" ? c.ar : c.en}` : countries[0]; })()
                    : `${ld(countries.length, locale)} ${t("ads.countries")}`}
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${countryOpen ? "rotate-180" : ""}`} />
              </button>
            </div>
            <div>
              <h3 className="mb-2 text-[13px] font-extrabold text-ink">{t("ads.duration")}</h3>
              <button
                onClick={() => { setDurOpen((o) => !o); setCountryOpen(false); }}
                className="flex h-12 w-full items-center justify-between gap-1 rounded-2xl border-2 border-slate-200 bg-white px-3 text-[13px] font-bold text-ink"
              >
                <span className="truncate">{ld(duration, locale)} {duration === 1 ? t("ads.day") : t("ads.days")}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${durOpen ? "rotate-180" : ""}`} />
              </button>
            </div>
          </div>

          {/* searchable multi-select country list */}
          {countryOpen && (
            <div className="mb-5 rounded-2xl border-2 border-slate-200 bg-white p-3">
              <input
                value={countryQ}
                onChange={(e) => setCountryQ(e.target.value)}
                placeholder={t("country.search")}
                className="mb-2 h-10 w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-3 text-[13px] font-medium text-ink outline-none focus:border-brand-500 focus:bg-white"
              />
              <div className="no-scrollbar flex max-h-56 flex-col gap-1 overflow-y-auto">
                {(countryQ ? COUNTRIES.filter((c) => c.ar.includes(countryQ) || c.en.toLowerCase().includes(countryQ.toLowerCase())) : COUNTRIES).map((c) => {
                  const on = countries.includes(c.code);
                  return (
                    <button
                      key={c.code}
                      onClick={() => setCountries((list) => (on ? (list.length > 1 ? list.filter((x) => x !== c.code) : list) : [...list, c.code]))}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-start ${on ? "bg-brand-50" : "hover:bg-slate-50"}`}
                    >
                      <span className="text-lg leading-none">{c.flag}</span>
                      <span className={`flex-1 text-[13.5px] font-bold ${on ? "text-brand-700" : "text-ink"}`}>{locale === "ar" ? c.ar : c.en}</span>
                      {on && <Check className="h-4 w-4 text-brand-600" strokeWidth={3} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* duration options with live pricing */}
          {durOpen && (
            <div className="mb-5 rounded-2xl border-2 border-slate-200 bg-white p-2">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => { setDuration(d); setDurOpen(false); }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-start ${duration === d ? "bg-brand-50" : "hover:bg-slate-50"}`}
                >
                  <span className={`text-[13.5px] font-bold ${duration === d ? "text-brand-700" : "text-ink"}`}>{ld(d, locale)} {d === 1 ? t("ads.day") : t("ads.days")}</span>
                  <span dir="ltr" className="text-[12.5px] font-bold text-muted">${adTotal(countries.length, d).toFixed(2)}</span>
                </button>
              ))}
            </div>
          )}
          <div className="mb-2" />

          {/* upload */}
          <h3 className="mb-2 text-[13px] font-extrabold text-ink">{t("ads.upload")}</h3>
          <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            const accept = (file: File | null) => {
              setFileObj(file); setFileName(file?.name ?? null);
              if (previewUrl) URL.revokeObjectURL(previewUrl);
              setPreviewUrl(file ? URL.createObjectURL(file) : null);
              setPreviewKind(file ? (file.type.startsWith("video") ? "video" : "image") : null);
            };
            // Ad videos are capped at 1 minute.
            if (f && f.type.startsWith("video")) {
              const url = URL.createObjectURL(f);
              const v = document.createElement("video");
              v.preload = "metadata";
              v.onloadedmetadata = () => {
                URL.revokeObjectURL(url);
                if (v.duration > 61) {
                  setToast(t("ads.videoTooLong"));
                  setTimeout(() => setToast(null), 2200);
                  if (fileRef.current) fileRef.current.value = "";
                  accept(null);
                } else {
                  accept(f);
                }
              };
              v.onerror = () => { URL.revokeObjectURL(url); accept(f); };
              v.src = url;
            } else {
              accept(f);
            }
          }} />
          <button
            onClick={() => fileRef.current?.click()}
            className={`mb-5 flex w-full flex-col items-center rounded-3xl border-2 border-dashed border-slate-300 bg-white ${previewUrl ? "overflow-hidden p-0" : "gap-2 py-7"}`}
          >
            {previewUrl ? (
              <>
                {previewKind === "video" ? (
                  <video src={previewUrl} muted playsInline autoPlay loop className="max-h-56 w-full bg-black object-contain" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="" className="max-h-56 w-full bg-slate-100 object-contain" />
                )}
                <span className="flex w-full items-center justify-center gap-1.5 px-4 py-2.5 text-[12px] font-bold text-ink">
                  <Check className="h-3.5 w-3.5 text-emerald-500" /> <span className="truncate">{fileName}</span>
                  <span className="text-muted">· {t("profile.change")}</span>
                </span>
              </>
            ) : (
              <>
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600">
                  <UploadCloud className="h-6 w-6" />
                </span>
                <span className="px-4 text-center text-[13px] font-bold text-ink">{t("ads.upload")}</span>
                <span className="text-[11px] text-muted">{t("ads.uploadHint")}</span>
              </>
            )}
          </button>

          {/* summary */}
          <div className="rounded-3xl border border-slate-100 bg-white p-4">
            <p className="mb-3 text-[13px] font-extrabold text-ink">{t("ads.summary")}</p>
            {/* country row: single → name; multiple → count, tap to expand */}
            <button onClick={() => countries.length > 1 && setSumOpen((o) => !o)} className="flex w-full items-center gap-3 py-2 text-start">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><Megaphone className="h-4 w-4" /></span>
              <span className="flex-1 text-[12.5px] font-medium text-muted">{t("ads.country")}</span>
              <span className="text-[13px] font-bold text-ink">
                {countries.length === 1
                  ? (() => { const c = countryOf(countries[0]); return c ? `${c.flag} ${locale === "ar" ? c.ar : c.en}` : countries[0]; })()
                  : `${ld(countries.length, locale)} ${t("ads.countries")}`}
              </span>
              {countries.length > 1 && <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${sumOpen ? "rotate-180" : ""}`} />}
            </button>
            {sumOpen && countries.length > 1 && (
              <div className="mb-1 flex flex-wrap gap-1.5 ps-11">
                {countries.map((code) => {
                  const c = countryOf(code);
                  return <span key={code} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-ink/70">{c ? `${c.flag} ${locale === "ar" ? c.ar : c.en}` : code}</span>;
                })}
              </div>
            )}
            <SumRow icon={<Clock className="h-4 w-4" />} label={t("ads.duration")} value={`${ld(duration, locale)} ${duration === 1 ? t("ads.day") : t("ads.days")} · ${ld(countries.length, locale)} ${countries.length === 1 ? t("browse.country") : t("ads.countries")}`} />
            <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-[14px] font-extrabold text-ink">{t("ads.total")}</span>
              <span dir="ltr" className="text-[18px] font-extrabold text-brand-700">${total}</span>
            </div>
          </div>

          {/* pay */}
          <button
            onClick={() => { if (adsOn && Number(total) > 0 && freeLeft <= 0) setPayOpen(true); else publish(); }}
            disabled={!fileObj && !caption.trim()}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-brand-700 to-brand-500 py-4 text-[15px] font-bold text-white shadow-[0_16px_30px_-10px_rgba(40,46,158,0.6)] disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none active:scale-[0.99]"
          >
            {adsOn ? <>{t("ads.pay")} · <span dir="ltr">${total}</span></> : t("ads.publishFree")}
          </button>
          {!fileObj && !caption.trim() && <p className="mt-2 text-center text-[12px] font-bold text-muted">{t("ads.needSomething")}</p>}
          {payOpen && <PaymentSheet amount={Number(total)} onPaid={async () => { setPayOpen(false); await publish(); }} onClose={() => setPayOpen(false)} />}
        </div>
      )}

      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="pointer-events-none absolute bottom-24 left-1/2 z-10 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white shadow-lg"
        >
          {toast}
        </motion.div>
      )}

      <BottomNav active="create" />
    </div>
  );
}

function SumRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">{icon}</span>
      <span className="flex-1 text-[12.5px] font-medium text-muted">{label}</span>
      <span className="text-end text-[12.5px] font-bold text-ink">{value}</span>
    </div>
  );
}
