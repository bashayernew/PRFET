"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, Plus, Users, Clock, Radio, Mic, Lock } from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, getAccessToken } from "@/lib/api";

type Room = {
  id: string; title: string; host: string; seats: number; taken: number; pricePerHour: number;
  hostId?: string; followersOnly?: boolean; mine?: boolean;
};

export default function MeetingsScreen() {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  const [rooms, setRooms] = useState<Room[]>([]);

  useEffect(() => {
    if (!ready) return;
    apiGet<{ meetings: Room[] }>("/api/meetings", getAccessToken() || undefined).then((res) => {
      if (res.ok && res.data?.meetings) setRooms(res.data.meetings);
    });
  }, [ready]);

  // Everyone opens the room page; the gate there handles code / request-to-join.
  function enter(r: Room) {
    router.push(`/meetings/${r.id}`);
  }

  if (!ready) return null;

  return (
    <div dir={dir} className="mx-auto flex min-h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      {/* header */}
      <div className="bg-gradient-to-b from-brand-700 to-brand-600 px-5 pb-6 pt-[calc(env(safe-area-inset-top)+16px)]">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/home")} aria-label={t("back")} className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white active:scale-95">
            <Back className="h-5 w-5" strokeWidth={2.4} />
          </button>
          <h1 className="text-[18px] font-extrabold text-white">{t("meet.title")}</h1>
        </div>
        <p className="mt-2 text-[12.5px] font-medium text-brand-100">{t("meet.subtitle")}</p>
      </div>

      {/* create button */}
      <div className="px-5 pt-4">
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={() => router.push("/meetings/new")}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-[15px] font-bold text-white shadow-[0_14px_26px_-12px_rgba(40,46,158,0.7)]"
        >
          <Plus className="h-5 w-5" /> {t("meet.create")}
        </motion.button>
      </div>

      {/* live rooms */}
      <div className="flex-1 overflow-y-auto px-5 pb-6 pt-5">
        <h2 className="mb-2 flex items-center gap-1.5 text-[15px] font-extrabold text-ink">
          <Radio className="h-4 w-4 text-red-500" /> {t("meet.live")}
        </h2>
        <div className="flex flex-col gap-3">
          {rooms.length === 0 && (
            <p className="rounded-2xl bg-white py-8 text-center text-[13px] font-bold text-muted ring-1 ring-slate-100">{t("meet.noRooms")}</p>
          )}
          {rooms.map((r) => (
            <button
              key={r.id}
              onClick={() => enter(r)}
              className="flex items-center gap-3 rounded-3xl bg-white p-4 text-start shadow-sm ring-1 ring-slate-100 active:scale-[0.99]"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-50 text-violet-600">
                <Mic className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-extrabold text-ink">{r.title}</p>
                <p className="text-[12px] font-medium text-muted">{t("meet.host")}: {r.host}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-ink/70">
                    <Users className="h-3 w-3" /> {ld(r.taken, locale)}/{ld(r.seats, locale)}
                  </span>
                  <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                    ${ld(r.pricePerHour, locale)}/{t("meet.hour")}
                  </span>
                  {!r.mine && (
                    <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                      <Lock className="h-3 w-3" /> {t("meet.codeNeeded")}
                    </span>
                  )}
                </div>
              </div>
              <span className="flex items-center gap-1 rounded-full bg-red-500 px-2.5 py-1 text-[10px] font-extrabold text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white" /> {t("meet.liveTag")}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-5 flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-[11.5px] font-medium text-amber-700">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" /> {t("meet.billNote")}
        </div>
      </div>
    </div>
  );
}
