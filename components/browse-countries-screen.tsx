"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, Search, Check, Globe2 } from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { useOpenCountries } from "@/lib/use-open-countries";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, apiPatch, getAccessToken } from "@/lib/api";

/** Which countries do I want to see people from? One, several, or the whole world. */
export default function BrowseCountriesScreen() {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken();
    if (!token) return;
    apiGet<{ user: { browseCountries: string; country: string | null } }>("/api/auth/me", token).then((res) => {
      if (!res.ok || !res.data?.user) return;
      const saved = (res.data.user.browseCountries || "").split(",").map((c) => c.trim()).filter(Boolean);
      setPicked(saved);
    });
  }, [ready]);

  const { countries } = useOpenCountries();
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return countries;
    return countries.filter((c) => c.ar.includes(q) || c.en.toLowerCase().includes(s));
  }, [q, countries]);

  function toggle(code: string) {
    setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));
  }

  async function save() {
    setSaving(true);
    await apiPatch("/api/auth/me", { browseCountries: picked.join(",") }, getAccessToken() || undefined);
    setSaving(false);
    router.push("/home");
  }

  if (!ready) return null;

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      <div className="shrink-0 bg-gradient-to-b from-brand-700 to-brand-600 px-5 pb-5 pt-[calc(env(safe-area-inset-top)+16px)]">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/home")} aria-label={t("back")} className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white active:scale-95">
            <Back className="h-5 w-5" strokeWidth={2.4} />
          </button>
          <h1 className="flex items-center gap-2 text-[18px] font-extrabold text-white">
            <Globe2 className="h-5 w-5" /> {t("browse.title")}
          </h1>
        </div>
        <p className="mt-1.5 ps-[52px] text-[12.5px] font-medium text-white/75">{t("browse.subtitle")}</p>

        <div className="mt-4 flex h-11 items-center gap-2 rounded-2xl bg-white px-3.5">
          <Search className="h-4 w-4 shrink-0 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("country.search")}
            className="w-full bg-transparent text-[14px] font-medium text-ink outline-none placeholder:text-muted"
          />
        </div>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-4">
        {/* everywhere = no filter at all */}
        <button
          onClick={() => setPicked([])}
          className={`mb-3 flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-start ring-1 ${picked.length === 0 ? "bg-brand-50 ring-brand-300" : "bg-white ring-slate-100"}`}
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-white"><Globe2 className="h-[18px] w-[18px]" /></span>
          <span className="flex-1">
            <span className="block text-[14px] font-extrabold text-ink">{t("browse.everywhere")}</span>
            <span className="block text-[11.5px] font-medium text-muted">{t("browse.everywhereSub")}</span>
          </span>
          {picked.length === 0 && <Check className="h-5 w-5 text-brand-600" strokeWidth={3} />}
        </button>

        <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-100">
          {list.map((c, i) => {
            const on = picked.includes(c.code);
            return (
              <button
                key={c.code}
                onClick={() => toggle(c.code)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-start ${i === list.length - 1 ? "" : "border-b border-slate-100"} ${on ? "bg-brand-50/60" : "active:bg-slate-50"}`}
              >
                <span className="text-xl leading-none">{c.flag}</span>
                <span className={`flex-1 text-[14px] font-bold ${on ? "text-brand-700" : "text-ink"}`}>{c[locale]}</span>
                {on && <Check className="h-4.5 w-4.5 text-brand-600" strokeWidth={3} />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-100 bg-white px-5 pb-[calc(env(safe-area-inset-bottom)+14px)] pt-3">
        <button
          onClick={save}
          disabled={saving}
          className="h-12 w-full rounded-2xl bg-brand-600 text-[15px] font-extrabold text-white disabled:opacity-50 active:scale-[0.99]"
        >
          {picked.length === 0
            ? t("browse.saveAll")
            : `${t("browse.save")} ${ld(picked.length, locale)} ${picked.length === 1 ? t("browse.country") : t("ads.countries")}`}
        </button>
      </div>
    </div>
  );
}
