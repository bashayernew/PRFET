"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Search, Star, MapPin, Bluetooth, Radar, X } from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { catIcon } from "@/lib/cat-icons";
import BottomNav from "@/components/bottom-nav";
import { useRequireAuth } from "@/lib/use-auth";
import { useLocationSync } from "@/lib/use-location-sync";
import { apiGet, apiPost, apiPatch, apiDelete, getAccessToken } from "@/lib/api";
import { vipStyle } from "@/lib/vip";
import { distDisplay } from "@/lib/geo";

// The range is 1 metre → 100 km. The slider thinks in METRES so "right next to me" is reachable.
const MAX_M = 100000;

type DirUser = {
  id: string;
  displayName: string;
  category: string | null;
  rating: number | null;
  online: boolean;
  avatarUrl: string | null;
  dist: string | null;
  isPremium?: boolean;
  textColor?: string | null;
  /** Hosting a live room right now — drives the LIVE badge. The API has always sent this
   *  (app/api/users/route.ts), but it was missing here, so the badge only worked by accident:
   *  next.config.ts sets typescript.ignoreBuildErrors, which shipped the error silently. */
  live?: boolean;
};

export default function DiscoverScreen() {
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();
  useLocationSync(ready);

  const [query, setQuery] = useState("");
  const [maxM, setMaxM] = useState(MAX_M);
  const [users, setUsers] = useState<DirUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false); // has the user pressed Search yet?
  /** Shown while the OS is locating, and after a failure — the button used to do both silently. */
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  // false = we don't know where this phone is, so no distance can be shown
  const [hasOrigin, setHasOrigin] = useState(true);

  // --- Bluetooth (BLE) discovery ---------------------------------------------------------
  // The scanning/advertising runs in the NATIVE app, which injects `window.PrfetNative`
  // ({ bleStart, bleStop }) and calls `window.__prfetBleFound([{id,distance}])` as it finds
  // nearby people. In the plain web browser there's no radio, so we show an "in the app" note.
  type BlePerson = { id: string; displayName: string; avatarUrl: string | null; category: string | null; accountType: string; isPremium?: boolean; textColor?: string | null; distance: number | null };
  const [bleOn, setBleOn] = useState(false);
  const [blePeople, setBlePeople] = useState<BlePerson[]>([]);
  const [bleUnsupported, setBleUnsupported] = useState(false);

  // My own over-the-air Bluetooth code — fetched once, then broadcast so nearby phones find me.
  const bleCodeRef = useRef<string>("");
  useEffect(() => {
    if (!ready) return;
    apiGet<{ code: string }>("/api/search/ble-self", getAccessToken() || undefined)
      .then((r) => { if (r.ok && r.data?.code) bleCodeRef.current = r.data.code; })
      .catch(() => {});
  }, [ready]);

  // Make sure we're ready to be found before broadcasting: (1) mark myself discoverable so
  // the server actually returns me to others, and (2) make sure my broadcast code is loaded
  // (broadcasting an empty code = nobody can identify me). Returns the code to advertise.
  async function ensureBleReady(): Promise<string> {
    const token = getAccessToken() || undefined;
    apiPatch("/api/auth/me", { bleDiscoverable: true }, token).catch(() => {});
    if (!bleCodeRef.current) {
      const r = await apiGet<{ code: string }>("/api/search/ble-self", token);
      if (r.ok && r.data?.code) bleCodeRef.current = r.data.code;
    }
    return bleCodeRef.current;
  }

  async function toggleBle() {
    const native = (window as unknown as { PrfetNative?: { bleStart?: (code?: string) => void; bleStop?: () => void } }).PrfetNative;
    if (!native?.bleStart) { setBleUnsupported(true); return; }
    const w = window as unknown as { __prfetBleFound?: (arr: { id: string; distance?: number }[]) => void };
    if (bleOn) { native.bleStop?.(); w.__prfetBleFound = undefined; setBleOn(false); return; }
    setBleUnsupported(false);
    w.__prfetBleFound = async (arr) => {
      const res = await apiPost<{ people: BlePerson[] }>("/api/search/ble-discovered", { found: arr }, getAccessToken() || undefined);
      if (res.ok && res.data?.people) setBlePeople(res.data.people);
    };
    setBlePeople([]);
    setBleOn(true);
    const code = await ensureBleReady();
    native.bleStart(code);
  }

  // Never leave the radio running when the page unmounts.
  useEffect(() => () => {
    const native = (window as unknown as { PrfetNative?: { bleStop?: () => void } }).PrfetNative;
    native?.bleStop?.();
    (window as unknown as { __prfetBleFound?: unknown }).__prfetBleFound = undefined;
  }, []);

  // --- AI Bluetooth Radar (premium) ------------------------------------------------------
  // Unlike the manual scan, radar keeps running and PERSISTS everyone it catches into a report
  // that survives even after they leave. It shares the one radio with the manual scan, meters
  // its runtime against the monthly "radar minutes" cap, and is subscriber-gated.
  type RadarPerson = BlePerson & { firstSeen: string; lastSeen: string };
  const [radarOn, setRadarOn] = useState(false);
  const [radarPeople, setRadarPeople] = useState<RadarPerson[]>([]);
  const [radarGate, setRadarGate] = useState<null | "premium" | "limit">(null);
  const radarTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // While a Bluetooth scan or radar is running, keep the phone screen ON so the device
  // doesn't sleep and suspend scanning — even if the user isn't touching or scrolling.
  // Releases automatically the moment both are switched off. Re-acquires when the screen
  // comes back (browsers drop the lock when hidden). (Declared here, AFTER bleOn/radarOn,
  // so the dependency array never references them before initialization.)
  useEffect(() => {
    if (!bleOn && !radarOn) return;
    let sentinel: { release?: () => Promise<void> } | null = null;
    const acquire = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release?: () => Promise<void> }> } };
        if (nav.wakeLock && document.visibilityState === "visible") sentinel = await nav.wakeLock.request("screen");
      } catch { /* unsupported — harmless */ }
    };
    const onVis = () => { if (document.visibilityState === "visible") acquire(); };
    acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      try { sentinel?.release?.(); } catch { /* already released */ }
    };
  }, [bleOn, radarOn]);

  function stopRadar() {
    const native = (window as unknown as { PrfetNative?: { bleStop?: () => void } }).PrfetNative;
    native?.bleStop?.();
    (window as unknown as { __prfetBleFound?: unknown }).__prfetBleFound = undefined;
    if (radarTimer.current) { clearInterval(radarTimer.current); radarTimer.current = null; }
    setRadarOn(false);
  }

  async function toggleRadar() {
    if (radarOn) { stopRadar(); return; }
    const native = (window as unknown as { PrfetNative?: { bleStart?: (code?: string) => void; bleStop?: () => void } }).PrfetNative;
    if (!native?.bleStart) { setBleUnsupported(true); return; }
    if (bleOn) { native.bleStop?.(); setBleOn(false); } // share the one radio
    setRadarGate(null);
    const token = getAccessToken() || undefined;
    const w = window as unknown as { __prfetBleFound?: (arr: { id: string; distance?: number }[]) => void };
    w.__prfetBleFound = async (arr) => {
      const res = await apiPost<{ people: RadarPerson[]; error?: string }>("/api/search/radar", { found: arr }, token);
      if (res.status === 403) { setRadarGate("premium"); stopRadar(); return; }
      if (res.ok && res.data?.people) setRadarPeople(res.data.people);
    };
    setRadarOn(true);
    const code = await ensureBleReady();
    native.bleStart(code);
    // Heartbeat: charge the monthly radar-minutes cap for the time it runs.
    radarTimer.current = setInterval(async () => {
      const res = await apiPost<{ error?: string }>("/api/search/ble-tick", { seconds: 15 }, token);
      if (res.status === 403) { setRadarGate(res.data?.error === "radar_limit" ? "limit" : "premium"); stopRadar(); }
    }, 15000);
  }

  async function clearRadar() {
    await apiDelete("/api/search/radar", getAccessToken() || undefined);
    setRadarPeople([]);
  }

  // Load any saved report on open (subscribers only; others just get nothing).
  useEffect(() => {
    if (!ready) return;
    apiGet<{ people: RadarPerson[] }>("/api/search/radar", getAccessToken() || undefined).then((r) => {
      if (r.ok && r.data?.people) setRadarPeople(r.data.people);
    });
    return () => { if (radarTimer.current) clearInterval(radarTimer.current); };
  }, [ready]);

  // Search runs on demand — by name, by distance, or both. The server does the filtering,
  // measuring from where this phone actually is.
  async function runSearch(m = maxM) {
    const q = query.trim();
    setLoading(true);
    setSearched(true);
    const token = getAccessToken() || undefined;
    const res = await apiGet<{ users: DirUser[]; hasOrigin: boolean }>(
      `/api/users?scope=all&maxKm=${m / 1000}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
      token
    );
    setUsers(res.ok && res.data?.users ? res.data.users : []);
    setHasOrigin(res.ok ? !!res.data?.hasOrigin : false);
    setLoading(false);
  }

  // Ask for the phone's location, store it, and search again with real distances.
  /**
   * Ask the OS for a position, then store it so distances can be shown.
   *
   * Every branch here used to fail silently — no geolocation API, permission denied, GPS
   * unavailable — so tapping "Enable" looked like a dead button. And with no `timeout`,
   * Android's getCurrentPosition can hang indefinitely without ever calling EITHER callback,
   * which is the same dead button with no way to tell the difference.
   *
   * Now: a visible busy state, a hard timeout, and a specific message per failure — because
   * "turn on Location in Settings" and "we couldn't get a fix, try outdoors" are different
   * problems and the user can only act on the right one.
   */
  function enableLocation() {
    if (locating) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocError(t("discover.locUnsupported"));
      return;
    }
    setLocError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setLocating(false);
        await apiPost("/api/location", { lat: pos.coords.latitude, lng: pos.coords.longitude }, getAccessToken() || undefined);
        sessionStorage.setItem("herot.geo", "1");
        runSearch();
      },
      (err) => {
        setLocating(false);
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        setLocError(
          err?.code === 1 ? t("discover.locDenied")
            : err?.code === 3 ? t("discover.locTimeout")
            : t("discover.locUnavailable")
        );
      },
      // Without a timeout this call can never return on Android. A coarse fix is plenty for
      // "how far away is this person", and accepting a 5-minute-old position makes it instant
      // when the phone already knows where it is.
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  // Privacy by default: nobody's name shows until the user actually searches.

  const results = users;

  if (!ready) return null;

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      {/* header — compact: title + search on one row, distance + button on the next */}
      <div className="shrink-0 bg-gradient-to-b from-brand-700 to-brand-600 px-4 pb-3.5 pt-[calc(env(safe-area-inset-top)+10px)]">
        <div className="flex items-center gap-2.5">
          <p className="shrink-0 text-[16px] font-extrabold text-white">{t("discover.title")}</p>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
              placeholder={t("discover.searchPh")}
              className="h-10 w-full rounded-xl border-0 bg-white ps-9 pe-3 text-[13.5px] font-medium text-ink outline-none placeholder:font-normal placeholder:text-muted"
            />
          </div>
        </div>

        <div className="mt-2.5 flex items-center gap-2.5">
          {/* distance slider, inline */}
          <div className="flex flex-1 items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
            <MapPin className="h-4 w-4 shrink-0 text-brand-200" />
            <input
              type="range"
              min={1}
              max={MAX_M}
              value={maxM}
              onChange={(e) => setMaxM(Number(e.target.value))}
              className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-white/25 accent-white"
            />
            <span className="shrink-0 text-[12px] font-extrabold text-white">
              {maxM < 1000
                ? `${ld(maxM, locale)} ${t("home.m")}`
                : `${ld(maxM >= 10000 ? Math.round(maxM / 1000) : (maxM / 1000).toFixed(1), locale)} ${t("home.km")}`}
            </span>
          </div>

          <button
            onClick={() => runSearch()}
            aria-label={t("discover.search")}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-brand-500 px-4 text-[13.5px] font-bold text-white ring-1 ring-white/20 active:scale-95"
          >
            <Search className="h-4 w-4" /> {t("discover.search")}
          </button>

          {/* Bluetooth search toggle — finds people right next to you (native app) */}
          <button
            onClick={toggleBle}
            aria-label={t("ble.search")}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ring-white/20 active:scale-95 ${bleOn ? "bg-white text-brand-700" : "bg-white/10 text-white"}`}
          >
            <Bluetooth className="h-4.5 w-4.5" />
          </button>

          {/* AI Radar toggle — keeps scanning + builds a report (premium) */}
          <button
            onClick={toggleRadar}
            aria-label={t("radar.title")}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ring-white/20 active:scale-95 ${radarOn ? "bg-white text-brand-700" : "bg-white/10 text-white"}`}
          >
            <Radar className={`h-4.5 w-4.5 ${radarOn ? "animate-pulse" : ""}`} />
          </button>
        </div>
      </div>

      {/* results */}
      <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-4 pt-4">
        {bleUnsupported && (
          <div className="mb-3 flex items-center gap-2 rounded-2xl bg-brand-50 px-3.5 py-3 ring-1 ring-brand-100">
            <Bluetooth className="h-4 w-4 shrink-0 text-brand-600" />
            <span className="flex-1 text-[12.5px] font-bold leading-snug text-brand-700">{t("ble.appOnly")}</span>
          </div>
        )}
        {bleOn && (
          <div className="mb-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" />
              <h2 className="text-[15px] font-extrabold text-ink">{t("ble.nearbyNow")}</h2>
              <span className="text-[12.5px] font-bold text-muted">{ld(blePeople.length, locale)}</span>
            </div>
            {blePeople.length === 0 ? (
              <p className="py-6 text-center text-[13px] font-medium text-muted">{t("ble.scanning")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {blePeople.map((p) => (
                  <Link key={p.id} href={`/business/${p.id}`} className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-100 active:scale-[0.99]">
                    <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-50 text-[15px] font-extrabold text-brand-600">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="h-full w-full object-cover" /> : (p.displayName || "•").charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-extrabold text-ink" style={vipStyle({ isPremium: p.isPremium, textColor: p.textColor })}>{p.displayName}</span>
                      {p.category && <span className="block truncate text-[11.5px] font-medium text-muted">{t(p.category)}</span>}
                    </span>
                    {p.distance != null && <span className="shrink-0 text-[11.5px] font-bold text-brand-600">≈ {ld(Math.round(p.distance), locale)} {t("home.m")}</span>}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
        {/* AI Radar gate / report */}
        {radarGate && (
          <div className="mb-3 flex items-center gap-2 rounded-2xl bg-amber-50 px-3.5 py-3 ring-1 ring-amber-200">
            <Radar className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="flex-1 text-[12.5px] font-bold leading-snug text-amber-700">
              {t(radarGate === "limit" ? "radar.limit" : "radar.premiumOnly")}
            </span>
            <Link href="/subscribe" className="shrink-0 rounded-xl bg-amber-500 px-2.5 py-1 text-[11.5px] font-bold text-white">{t("radar.unlock")}</Link>
          </div>
        )}
        {(radarOn || radarPeople.length > 0) && (
          <div className="mb-5">
            <div className="mb-2 flex items-center gap-2">
              <Radar className={`h-4 w-4 text-brand-600 ${radarOn ? "animate-pulse" : ""}`} />
              <h2 className="text-[15px] font-extrabold text-ink">{t("radar.report")}</h2>
              <span className="text-[12.5px] font-bold text-muted">{ld(radarPeople.length, locale)}</span>
              <span className="flex-1" />
              {radarPeople.length > 0 && (
                <button onClick={clearRadar} aria-label={t("radar.clear")} className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-muted active:scale-95">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {radarOn && <p className="mb-2 text-[11.5px] font-medium text-muted">{t("radar.scanning")}</p>}
            {radarPeople.length === 0 ? (
              !radarOn && <p className="py-6 text-center text-[13px] font-medium text-muted">{t("radar.empty")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {radarPeople.map((p) => {
                  const gone = Date.now() - new Date(p.lastSeen).getTime() > 60000; // >1 min = probably left
                  return (
                    <Link key={p.id} href={`/business/${p.id}`} className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-100 active:scale-[0.99]">
                      <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-50 text-[15px] font-extrabold text-brand-600">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="h-full w-full object-cover" /> : (p.displayName || "•").charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-extrabold text-ink" style={vipStyle({ isPremium: p.isPremium, textColor: p.textColor })}>{p.displayName}</span>
                        {p.category && <span className="block truncate text-[11.5px] font-medium text-muted">{t(p.category)}</span>}
                      </span>
                      {gone
                        ? <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold text-muted">{t("radar.left")}</span>
                        : p.distance != null && <span className="shrink-0 text-[11.5px] font-bold text-brand-600">≈ {ld(Math.round(p.distance), locale)} {t("home.m")}</span>}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {!hasOrigin && (
          <button
            onClick={enableLocation}
            disabled={locating}
            className="mb-3 flex w-full items-center gap-2 rounded-2xl bg-amber-50 px-3.5 py-3 text-start ring-1 ring-amber-200 active:scale-[0.99] disabled:opacity-70"
          >
            <MapPin className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="flex-1 text-[12.5px] font-bold leading-snug text-amber-800">
              {locError ?? t("discover.locationOff")}
            </span>
            <span className="shrink-0 rounded-xl bg-amber-500 px-2.5 py-1 text-[11.5px] font-bold text-white">
              {locating ? t("discover.locating") : t("discover.enableLocation")}
            </span>
          </button>
        )}
        {searched && !loading && (
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[15px] font-extrabold text-ink">{t("discover.nearby")}</h2>
            <span className="text-[12.5px] font-bold text-muted">{ld(results.length, locale)} {t("discover.results")}</span>
          </div>
        )}

        {!searched ? (
          /* nothing is listed until a search runs — names stay hidden */
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-3xl bg-brand-50">
              <Search className="h-8 w-8 text-brand-300" />
            </div>
            <p className="text-[15px] font-extrabold text-ink">{t("discover.pressSearch")}</p>
            <p className="max-w-[260px] text-[13px] text-muted">{t("discover.pressSearchHint")}</p>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600" />
            <p className="text-[13px] font-medium text-muted">{t("common.loading")}</p>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-3xl bg-brand-50">
              <Search className="h-8 w-8 text-brand-300" />
            </div>
            <p className="text-[15px] font-extrabold text-ink">{t("discover.empty")}</p>
            <p className="max-w-[240px] text-[13px] text-muted">{t("discover.emptyHint")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {results.map((u, i) => {
              const Icon = catIcon(u.category || "cat.other");
              return (
                <motion.div key={u.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.04, duration: 0.35 }}>
                  <Link href={`/business/${u.id}`} className="flex items-center gap-3 rounded-3xl bg-white p-3.5 shadow-sm ring-1 ring-slate-100 active:scale-[0.99]">
                    <span className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-brand-50">
                      {u.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.avatarUrl} alt="" className="h-14 w-14 object-cover" />
                      ) : (
                        <Icon className="h-7 w-7 text-brand-600" strokeWidth={2} />
                      )}
                      <span className={`absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-white ${u.online ? "bg-emerald-500" : "bg-slate-300"}`} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-extrabold text-ink" style={vipStyle(u)}>{u.displayName}</p>
                      {u.category && <p className="text-[12px] font-medium text-muted">{t(u.category)}</p>}
                      <div className="mt-1 flex items-center gap-2.5">
                        {u.live && (
                          <span className="flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-[10.5px] font-extrabold text-white">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> LIVE
                          </span>
                        )}
                        <span className={`flex items-center gap-1 text-[11.5px] font-bold ${u.online ? "text-emerald-600" : "text-muted"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${u.online ? "bg-emerald-500" : "bg-slate-300"}`} />
                          {u.online ? t("home.online") : t("home.offline")}
                        </span>
                        {u.dist != null ? (
                          <span className="flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-extrabold text-brand-700">
                            <MapPin className="h-3 w-3" /> {ld(distDisplay(u.dist).value, locale)} {t(distDisplay(u.dist).unit)}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-muted">
                            <MapPin className="h-3 w-3" /> {t("discover.distUnknown")}
                          </span>
                        )}
                      </div>
                    </div>
                    {u.rating != null && (
                      <span className="flex items-center gap-0.5 rounded-lg bg-gold-400/15 px-1.5 py-0.5">
                        <Star className="h-3 w-3 fill-gold-400 text-gold-400" />
                        <span className="text-[11px] font-bold text-ink">{u.rating}</span>
                      </span>
                    )}
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      <BottomNav active="home" />
    </div>
  );
}
