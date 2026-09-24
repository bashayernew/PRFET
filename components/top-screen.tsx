"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, Eye, Star, Crown } from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { BUSINESSES } from "@/lib/data";
import { catIcon } from "@/lib/cat-icons";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet } from "@/lib/api";
import { useRefreshable } from "@/lib/refresh";

const RANK_TINT = ["bg-gold-400 text-white", "bg-slate-300 text-white", "bg-amber-700 text-white"];

type Row = { id: string; name: string; category: string; online: boolean; views: number; rating: string };
type DirUser = { id: string; displayName: string; category: string | null; online: boolean; profileViews: number; rating: number | null };

export default function TopScreen() {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  const [rows, setRows] = useState<Row[]>([]);

  const sample = useCallback((): Row[] =>
    [...BUSINESSES]
      .sort((a, b) => b.followers - a.followers)
      .map((b) => ({ id: b.id, name: locale === "ar" ? b.ar : b.en, category: b.catKey, online: b.online, views: b.followers, rating: b.rating })),
    [locale]);

  const load = useCallback(async () => {
    const res = await apiGet<{ users: DirUser[] }>("/api/users?sort=views");
    if (res.ok && res.data?.users && res.data.users.length) {
      setRows(res.data.users.map((u) => ({
        id: u.id, name: u.displayName, category: u.category ?? "cat.other",
        online: u.online, views: u.profileViews, rating: u.rating != null ? String(u.rating) : "—",
      })));
    } else {
      setRows(sample());
    }
  }, [sample]);

  useEffect(() => { if (ready) load(); }, [ready, load]);
  useRefreshable(load); // pull down to reload the rankings

  if (!ready) return null;

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      {/* header */}
      <div className="bg-gradient-to-b from-brand-700 to-brand-600 px-5 pb-7 pt-[calc(env(safe-area-inset-top)+14px)]">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/home")} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
            <Back className="h-5 w-5" strokeWidth={2.4} />
          </button>
          <div className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-gold-400" />
            <h1 className="text-[18px] font-extrabold text-white">{t("top.title")}</h1>
          </div>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-brand-100">{t("top.subtitle")}</p>
      </div>

      {/* list */}
      <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-3">
          {rows.map((r, idx) => {
            const Icon = catIcon(r.category);
            const top = idx < 3;
            return (
              <motion.div key={r.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(idx, 8) * 0.05 }}>
                <Link href={`/business/${r.id}`} className={`flex items-center gap-3 rounded-3xl bg-white p-3.5 shadow-sm ring-1 active:scale-[0.99] ${top ? "ring-brand-100" : "ring-slate-100"}`}>
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[14px] font-extrabold ${top ? RANK_TINT[idx] : "bg-brand-50 text-brand-600"}`}>
                    {ld(idx + 1, locale)}
                  </span>
                  <span className="relative grid shrink-0 place-items-center rounded-2xl bg-brand-50" style={{ height: 52, width: 52 }}>
                    <Icon className="h-7 w-7 text-brand-600" strokeWidth={2} />
                    <span className={`absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-white ${r.online ? "bg-emerald-500" : "bg-slate-300"}`} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-extrabold text-ink">{r.name}</p>
                    <p className="text-[12px] font-medium text-muted">{t(r.category)}</p>
                    <div className="mt-1 flex items-center gap-1 text-[11.5px] font-bold text-brand-600">
                      <Eye className="h-3.5 w-3.5" />
                      {ld(r.views, locale)} {t("top.views")}
                    </div>
                  </div>
                  <span className="flex items-center gap-0.5 rounded-lg bg-gold-400/15 px-1.5 py-0.5">
                    <Star className="h-3 w-3 fill-gold-400 text-gold-400" />
                    <span className="text-[11px] font-bold text-ink">{r.rating}</span>
                  </span>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
