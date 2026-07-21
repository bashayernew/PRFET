"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, Search, Check } from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { useOpenCountries } from "@/lib/use-open-countries";

export default function CountryScreen() {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>("SA");
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  const Forward = dir === "rtl" ? ArrowLeft : ArrowRight;

  const { countries } = useOpenCountries();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter((c) => c.ar.includes(q) || c.en.toLowerCase().includes(q));
  }, [query, countries]);

  return (
    <div dir={dir} className="mx-auto flex min-h-[100dvh] max-w-[480px] flex-col bg-white px-6 pb-[calc(env(safe-area-inset-bottom)+18px)] pt-[calc(env(safe-area-inset-top)+18px)]">
      {/* top bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/")}
          aria-label={t("back")}
          className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-ink active:scale-95"
        >
          <Back className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <div className="flex flex-1 items-center gap-1.5">
          <span className="h-1.5 flex-1 rounded-full bg-brand-500" />
          <span className="h-1.5 flex-1 rounded-full bg-slate-200" />
          <span className="h-1.5 flex-1 rounded-full bg-slate-200" />
        </div>
        <span className="text-[12px] font-bold text-muted">{ld(1, locale)} / {ld(3, locale)}</span>
      </div>

      {/* heading */}
      <motion.h1
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mt-8 text-2xl font-extrabold text-ink"
      >
        {t("country.title")}
      </motion.h1>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">{t("country.subtitle")}</p>

      {/* search */}
      <div className="relative mt-5">
        <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("country.search")}
          className="h-12 w-full rounded-2xl border-2 border-slate-200 bg-slate-50 ps-12 pe-4 text-[15px] font-medium text-ink outline-none transition-colors placeholder:text-muted focus:border-brand-500 focus:bg-white"
        />
      </div>

      {/* list */}
      <div className="no-scrollbar mt-4 flex-1 overflow-y-auto">
        {!query && <p className="mb-2 mt-1 text-[12px] font-bold text-muted">{t("country.suggested")}</p>}
        <div className="flex flex-col gap-2 pb-2">
          {filtered.map((c) => {
            const active = selected === c.code;
            return (
              <button
                key={c.code}
                onClick={() => setSelected(c.code)}
                className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-start transition-all ${
                  active ? "border-brand-500 bg-brand-50" : "border-slate-100 bg-white hover:bg-slate-50"
                }`}
              >
                <span className="text-2xl leading-none">{c.flag}</span>
                <span className={`flex-1 text-[15px] font-bold ${active ? "text-brand-700" : "text-ink"}`}>
                  {c[locale]}
                </span>
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full border-2 transition-all ${
                    active ? "border-brand-500 bg-brand-500" : "border-slate-300 bg-white"
                  }`}
                >
                  {active && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="py-8 text-center text-[14px] text-muted">{t("country.noResults")}</p>
          )}
        </div>
      </div>

      {/* continue */}
      <motion.button
        whileTap={selected ? { scale: 0.97 } : undefined}
        disabled={!selected}
        onClick={() => {
          if (!selected) return;
          localStorage.setItem("herot.country", selected);
          router.push("/register");
        }}
        className={`group mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold transition-all ${
          selected
            ? "bg-gradient-to-l from-brand-700 to-brand-500 text-white shadow-[0_16px_30px_-10px_rgba(40,46,158,0.6)]"
            : "cursor-not-allowed bg-slate-100 text-slate-400"
        }`}
      >
        {t("continue")}
        <Forward className="h-5 w-5" strokeWidth={2.4} />
      </motion.button>
    </div>
  );
}
