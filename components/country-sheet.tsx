"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Search, Check, Globe2 } from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { useOpenCountries } from "@/lib/use-open-countries";

/**
 * The country picker as a pop-up: searchable, multi-select, every country in the world.
 * Passing `single` turns it into a one-choice picker (sign-up, nationality…).
 */
export default function CountrySheet({
  open, value, onClose, onSave, single, title, subtitle,
}: {
  open: boolean;
  value: string[];
  onClose: () => void;
  onSave: (codes: string[]) => void;
  single?: boolean;
  title?: string;
  subtitle?: string;
}) {
  const { t, dir, locale } = useI18n();
  const { countries } = useOpenCountries();
  const [picked, setPicked] = useState<string[]>(value);
  const [q, setQ] = useState("");

  useEffect(() => { if (open) { setPicked(value); setQ(""); } }, [open, value]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return countries;
    return countries.filter((c) => c.ar.includes(q.trim()) || c.en.toLowerCase().includes(s) || c.code.toLowerCase() === s);
  }, [q, countries]);

  function toggle(code: string) {
    if (single) { onSave([code]); onClose(); return; }
    setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50"
        >
          <motion.div
            dir={dir}
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
            className="flex h-[82dvh] w-full max-w-[480px] flex-col rounded-t-3xl bg-white"
          >
            {/* head */}
            <div className="shrink-0 border-b border-slate-100 px-4 pb-3 pt-3">
              <span className="mx-auto mb-2.5 block h-1 w-10 rounded-full bg-slate-200" />
              <div className="flex items-center gap-2">
                <p className="flex flex-1 items-center gap-1.5 text-[15px] font-extrabold text-ink">
                  <Globe2 className="h-4 w-4 text-brand-600" /> {title ?? t("browse.title")}
                </p>
                <button onClick={onClose} aria-label={t("close")} className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-muted active:scale-95">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {(subtitle ?? (single ? "" : t("browse.subtitle"))) && (
                <p className="mt-1 text-[12px] font-medium leading-snug text-muted">{subtitle ?? t("browse.subtitle")}</p>
              )}

              <div className="mt-3 flex h-11 items-center gap-2 rounded-2xl bg-slate-100 px-3.5">
                <Search className="h-4 w-4 shrink-0 text-muted" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("country.search")}
                  className="w-full bg-transparent text-[14px] font-medium text-ink outline-none placeholder:text-muted"
                />
              </div>
            </div>

            {/* list */}
            <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-3">
              {!single && (
                <button
                  onClick={() => setPicked([])}
                  className={`mb-2 flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-start ring-1 ${picked.length === 0 ? "bg-brand-50 ring-brand-300" : "bg-white ring-slate-100"}`}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-600 text-white"><Globe2 className="h-4 w-4" /></span>
                  <span className="flex-1 text-[13.5px] font-extrabold text-ink">{t("browse.everywhere")}</span>
                  {picked.length === 0 && <Check className="h-4 w-4 text-brand-600" strokeWidth={3} />}
                </button>
              )}

              {list.length === 0 ? (
                <p className="py-10 text-center text-[13px] font-bold text-muted">{t("discover.empty")}</p>
              ) : (
                <div className="overflow-hidden rounded-2xl ring-1 ring-slate-100">
                  {list.map((c, i) => {
                    const on = picked.includes(c.code);
                    return (
                      <button
                        key={c.code}
                        onClick={() => toggle(c.code)}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-start ${i === list.length - 1 ? "" : "border-b border-slate-100"} ${on ? "bg-brand-50/70" : "bg-white active:bg-slate-50"}`}
                      >
                        <span className="text-xl leading-none">{c.flag}</span>
                        <span className={`flex-1 text-[14px] font-bold ${on ? "text-brand-700" : "text-ink"}`}>{c[locale]}</span>
                        {on && <Check className="h-4 w-4 text-brand-600" strokeWidth={3} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* save */}
            {!single && (
              <div className="shrink-0 border-t border-slate-100 p-4 pb-[calc(env(safe-area-inset-bottom)+14px)]">
                <button
                  onClick={() => { onSave(picked); onClose(); }}
                  className="h-12 w-full rounded-2xl bg-brand-600 text-[15px] font-extrabold text-white active:scale-[0.99]"
                >
                  {picked.length === 0
                    ? t("browse.saveAll")
                    : `${t("browse.save")} ${ld(picked.length, locale)} ${picked.length === 1 ? t("browse.country") : t("ads.countries")}`}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
