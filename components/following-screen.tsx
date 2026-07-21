"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, Users } from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { catIcon } from "@/lib/cat-icons";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, getAccessToken } from "@/lib/api";
import { vipStyle } from "@/lib/vip";

type Row = { id: string; name: string; category: string | null; online: boolean; avatarUrl: string | null; followers: number; following: number; isPremium?: boolean; textColor?: string | null };
type Target = { id: string; displayName: string; category: string | null; online: boolean; avatarUrl: string | null; followers: number; following: number; isPremium?: boolean; textColor?: string | null };

export default function FollowingScreen() {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = getAccessToken();
    if (!token) { setLoading(false); return; }
    const res = await apiGet<{ targets: Target[] }>("/api/follows?full=1", token);
    const targets = res.ok && res.data?.targets ? res.data.targets : [];
    setRows(targets.map((u) => ({
      id: u.id, name: u.displayName, category: u.category, online: u.online,
      avatarUrl: u.avatarUrl, followers: u.followers, following: u.following,
      isPremium: u.isPremium, textColor: u.textColor,
    })));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  if (!ready) return null;

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      {/* header */}
      <div className="bg-gradient-to-b from-brand-700 to-brand-600 px-5 pb-7 pt-[calc(env(safe-area-inset-top)+14px)]">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/home")} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
            <Back className="h-5 w-5" strokeWidth={2.4} />
          </button>
          <h1 className="text-[18px] font-extrabold text-white">{t("following.title")}</h1>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-brand-100">{t("following.subtitle")}</p>
      </div>

      {/* list */}
      <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-4">
        {!loading && rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-8 py-24 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-3xl bg-brand-50">
              <Users className="h-8 w-8 text-brand-300" />
            </div>
            <p className="text-[15px] font-extrabold text-ink">{t("following.empty")}</p>
            <p className="max-w-[260px] text-[13px] text-muted">{t("following.emptyHint")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((r, idx) => {
              const Icon = catIcon(r.category ?? "cat.other");
              return (
                <motion.div key={r.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
                  <Link href={`/business/${r.id}`} className="flex items-center gap-3 rounded-3xl bg-white p-3.5 shadow-sm ring-1 ring-slate-100 active:scale-[0.99]">
                    <span className="relative grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-brand-50" style={{ height: 52, width: 52 }}>
                      {r.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Icon className="h-7 w-7 text-brand-600" strokeWidth={2} />
                      )}
                      <span className={`absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-white ${r.online ? "bg-emerald-500" : "bg-slate-300"}`} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-extrabold text-ink" style={vipStyle(r)}>{r.name}</p>
                      {r.category && <p className="text-[12px] font-medium text-muted">{t(r.category)}</p>}
                      <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted">
                        <span><b className="font-extrabold text-ink">{ld(r.followers, locale)}</b> {t("following.followers")}</span>
                        <span className="text-slate-300">·</span>
                        <span><b className="font-extrabold text-ink">{ld(r.following, locale)}</b> {t("following.followingCount")}</span>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
