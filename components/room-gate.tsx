"use client";

// Shown when someone opens a room link but isn't in the room yet.
// Three ways in: type the code, ask the host, or go follow the host.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Hand, ArrowLeft, ArrowRight, Crown, Clock } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiPost, getAccessToken } from "@/lib/api";

export default function RoomGate({
  id,
  title,
  privacy = "public",
  hostId,
  hostName,
  hostAvatar,
  myJoinStatus,
  kicked,
  onEntered,
}: {
  id: string;
  title: string;
  privacy?: string;
  hostId: string;
  hostName: string;
  hostAvatar: string | null;
  myJoinStatus: string | null;
  kicked?: boolean;
  onEntered: () => void;
}) {
  const router = useRouter();
  const { t, dir } = useI18n();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [err, setErr] = useState<string | null>(null);
  const [asked, setAsked] = useState(myJoinStatus === "pending");
  const [busy, setBusy] = useState(false);

  async function askHost() {
    setBusy(true);
    const res = await apiPost<{ ok: boolean }>(`/api/meetings/${id}/join-request`, {}, getAccessToken() || undefined);
    setBusy(false);
    if (res.ok) setAsked(true);
  }

  // Public rooms need no code — just walk in.
  async function joinDirect() {
    if (busy) return;
    setBusy(true);
    const res = await apiPost<{ ok: boolean }>(`/api/meetings/${id}/join`, {}, getAccessToken() || undefined);
    setBusy(false);
    if (res.ok) { onEntered(); return; }
    setErr(res.status === 409 ? t("meet.full") : t("meet.badCode"));
  }

  if (kicked) {
    return (
      <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col items-center justify-center gap-3 bg-[#1b1440] px-8 text-center text-white">
        <p className="text-[15px] font-extrabold">{t("meet.youWereKicked")}</p>
        <button onClick={() => router.push("/meetings")} className="rounded-2xl bg-white/10 px-5 py-2.5 text-[13px] font-bold">{t("back")}</button>
      </div>
    );
  }

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-[#1b1440] text-white">
      <div className="flex items-center gap-3 px-5 pb-3 pt-[calc(env(safe-area-inset-top)+14px)]">
        <button onClick={() => router.push("/meetings")} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 active:scale-95">
          <Back className="h-5 w-5" />
        </button>
        <p className="truncate text-[16px] font-extrabold">{title || t("meet.roomTitle")}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5">
        {/* host card — tap to open their profile */}
        <button onClick={() => router.push(`/business/${hostId}`)} className="mb-6 flex w-full items-center gap-3 rounded-3xl bg-white/5 p-4 text-start active:scale-[0.99]">
          <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full bg-[#2c2058] text-[20px] font-extrabold">
            {hostAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={hostAvatar} alt="" className="h-full w-full object-cover" />
            ) : (
              (hostName || "•").charAt(0).toUpperCase()
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 truncate text-[15px] font-extrabold">
              <Crown className="h-3.5 w-3.5 text-amber-400" /> {hostName}
            </p>
            <p className="text-[11.5px] font-medium text-slate-400">{t("meet.host")}</p>
          </div>
        </button>

        {/* Public — open, just walk in */}
        {privacy === "public" ? (
          <>
            <button
              onClick={joinDirect}
              disabled={busy}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-[15px] font-extrabold text-white active:scale-[0.99] disabled:opacity-50"
            >
              {t("meet.join")}
            </button>
            {err && <p className="mb-2 text-center text-[12.5px] font-bold text-red-400">{err}</p>}
          </>
        ) : (
          /* Friends & private — the host must approve you (no code) */
          asked ? (
            <div className="mb-3 flex items-center gap-2 rounded-2xl bg-amber-400/15 px-4 py-3.5 text-[13px] font-bold text-amber-300">
              <Clock className="h-4 w-4 shrink-0" /> {t("meet.joinPending")}
            </div>
          ) : (
            <button
              onClick={askHost}
              disabled={busy}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 py-3.5 text-[14px] font-bold text-white active:scale-[0.99]"
            >
              <Hand className="h-4 w-4" /> {t("meet.askHost")}
            </button>
          )
        )}

        {/* follow / visit the host */}
        <button
          onClick={() => router.push(`/business/${hostId}`)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white/10 py-3.5 text-[14px] font-bold text-white active:scale-[0.99]"
        >
          <UserPlus className="h-4 w-4" /> {t("meet.visitHost")}
        </button>

        <p className="mt-4 text-center text-[11.5px] leading-relaxed text-slate-500">{t("meet.gateHint")}</p>
      </div>
    </div>
  );
}
