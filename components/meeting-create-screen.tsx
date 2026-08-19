"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, Clock, Mic, MessageSquare, Video, Check, UserPlus, ShieldAlert } from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, apiPost, getAccessToken } from "@/lib/api";

type Target = { id: string; displayName: string; avatarUrl: string | null; category: string | null };

const MAX_SEATS = 20;   // up to 20 people can be on mic at once
const ROOM_MINUTES = 45; // every room runs 45 minutes, part of the subscription

export default function MeetingCreateScreen() {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [title, setTitle] = useState("");
  const [allowAudio, setAllowAudio] = useState(true);
  const [allowText, setAllowText] = useState(true);
  const [allowVideo, setAllowVideo] = useState(false);
  const [followees, setFollowees] = useState<Target[]>([]);
  const [invited, setInvited] = useState<string[]>([]);
  // public: everyone sees it · announced: friends see the title · hidden: invisible
  const [privacy, setPrivacy] = useState<"public" | "announced" | "hidden">("public");
  const [allowRecording, setAllowRecording] = useState(false);

  // people you follow — candidates to invite
  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken();
    if (!token) return;
    apiGet<{ targets: Target[] }>("/api/follows?full=1", token).then((res) => {
      if (res.ok && res.data?.targets) setFollowees(res.data.targets);
    });
  }, [ready]);

  function toggleInvite(uid: string) {
    setInvited((list) => (list.includes(uid) ? list.filter((i) => i !== uid) : [...list, uid]));
  }

  if (!ready) return null;

  const valid = title.trim().length >= 2;

  async function create() {
    if (!valid) return;
    const token = getAccessToken() || undefined;
    const res = await apiPost<{ id: string }>("/api/meetings", {
      title: title.trim(),
      durationMin: ROOM_MINUTES,
      pricePerHour: 0,
      maxSeats: MAX_SEATS,
      allowAudio, allowText, allowVideo,
      inviteIds: invited.length ? invited : undefined,
      privacy,
      allowRecording,
    }, token);
    const slug = title.trim().slice(0, 24).replace(/\s+/g, "-") || "room";
    router.push(res.ok && res.data?.id ? `/meetings/${res.data.id}` : `/meetings/${slug}-${Date.now()}`);
  }

  return (
    <div dir={dir} className="mx-auto flex min-h-[100dvh] max-w-[480px] flex-col bg-white">
      {/* header */}
      <div className="flex items-center gap-3 px-5 pb-3 pt-[calc(env(safe-area-inset-top)+16px)]">
        <button onClick={() => router.push("/meetings")} aria-label={t("back")} className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-ink active:scale-95">
          <Back className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <h1 className="text-[18px] font-extrabold text-ink">{t("meet.create")}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4 pt-2">
        {/* name */}
        <label className="mb-1.5 block text-[13px] font-bold text-ink">{t("meet.name")}</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("meet.namePlaceholder")}
          className="mb-5 h-12 w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-4 text-[15px] font-medium text-ink outline-none focus:border-brand-500 focus:bg-white"
        />

        {/* duration — fixed 45 minutes, included in the subscription */}
        <div className="mb-3 flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
          <span className="flex items-center gap-1.5 text-[13px] font-bold text-ink"><Clock className="h-4 w-4 text-brand-600" /> {t("meet.duration")}</span>
          <span className="text-[13px] font-extrabold text-brand-600">{ld(ROOM_MINUTES, locale)} {t("meet.minUnit")}</span>
        </div>

        {/* max attendees — only for friends/private rooms; public rooms are unlimited */}
        {privacy !== "public" && (
          <>
            <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
              <span className="flex items-center gap-1.5 text-[13px] font-bold text-ink"><Mic className="h-4 w-4 text-brand-600" /> {t("meet.micSeats")}</span>
              <span className="text-[13px] font-extrabold text-brand-600">{ld(MAX_SEATS, locale)}</span>
            </div>
            <p className="mb-5 mt-1.5 text-[11.5px] font-medium leading-snug text-muted">{t("meet.micSeatsNote")}</p>
          </>
        )}

        {/* privacy — visibility only; entry is approved by the host */}
        <p className="mb-2 text-[13px] font-bold text-ink">{t("meet.privacy")}</p>
        <div className="flex gap-1.5 rounded-2xl bg-slate-100 p-1.5">
          {([
            { v: "public" as const, label: t("meet.privacyPublic") },
            { v: "announced" as const, label: t("meet.privacyAnnounced") },
            { v: "hidden" as const, label: t("meet.privacyHidden") },
          ]).map((o) => (
            <button key={o.v} onClick={() => setPrivacy(o.v)}
              className={`flex-1 rounded-xl py-2 text-[12px] font-bold transition-colors ${privacy === o.v ? "bg-brand-600 text-white" : "text-muted"}`}>
              {o.label}
            </button>
          ))}
        </div>
        <p className="mb-4 mt-1.5 text-[11.5px] font-medium leading-snug text-muted">
          {privacy === "public" ? t("meet.privacyPublicHint") : privacy === "announced" ? t("meet.privacyAnnouncedHint") : t("meet.privacyHiddenHint")}
        </p>
        <div className="mb-5 overflow-hidden rounded-2xl ring-1 ring-slate-100">
          <AccessRow icon={<ShieldAlert className="h-5 w-5" />} label={t("meet.allowRecording")} on={allowRecording} onClick={() => setAllowRecording((v) => !v)} last />
        </div>

        {/* access defaults */}
        <p className="mb-2 text-[13px] font-bold text-ink">{t("meet.access")}</p>
        <div className="mb-5 overflow-hidden rounded-2xl ring-1 ring-slate-100">
          <AccessRow icon={<Mic className="h-5 w-5" />} label={t("meet.accessAudio")} on={allowAudio} onClick={() => setAllowAudio((v) => !v)} />
          <AccessRow icon={<MessageSquare className="h-5 w-5" />} label={t("meet.accessText")} on={allowText} onClick={() => setAllowText((v) => !v)} />
          <AccessRow icon={<Video className="h-5 w-5" />} label={t("meet.accessVideo")} on={allowVideo} onClick={() => setAllowVideo((v) => !v)} last />
        </div>

        {/* invite people you follow — they get a notification with the room link */}
        {followees.length > 0 && (
          <>
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-ink">
              <UserPlus className="h-4 w-4 text-brand-600" /> {t("meet.invitePeople")}
              {invited.length > 0 && <span className="text-brand-600">({ld(invited.length, locale)})</span>}
            </p>
            <div className="no-scrollbar -mx-5 mb-5 flex gap-3 overflow-x-auto px-5">
              {followees.map((f) => {
                const on = invited.includes(f.id);
                return (
                  <button key={f.id} onClick={() => toggleInvite(f.id)} className="flex w-16 shrink-0 flex-col items-center gap-1">
                    <span className={`relative grid h-14 w-14 place-items-center overflow-hidden rounded-full ${on ? "ring-2 ring-brand-600 ring-offset-2" : "ring-1 ring-slate-200"}`}>
                      {f.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="grid h-full w-full place-items-center bg-brand-50 text-[16px] font-extrabold text-brand-600">
                          {(f.displayName || "•").charAt(0).toUpperCase()}
                        </span>
                      )}
                      {on && (
                        <span className="absolute inset-0 grid place-items-center bg-brand-600/50 text-white">
                          <Check className="h-6 w-6" strokeWidth={3} />
                        </span>
                      )}
                    </span>
                    <span className="w-16 truncate text-center text-[10.5px] font-bold text-ink/80">{f.displayName}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* rooms are part of the Premium subscription — no per-room charge */}
      </div>

      {/* create */}
      <div className="shrink-0 border-t border-slate-100 bg-white px-5 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3">
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={create}
          disabled={!valid}
          className={`w-full rounded-2xl py-4 text-[15px] font-bold text-white transition-colors ${valid ? "bg-brand-600" : "bg-slate-300"}`}
        >
          {t("meet.startRoom")}
        </motion.button>
      </div>
    </div>
  );
}

function AccessRow({ icon, label, on, onClick, last }: { icon: React.ReactNode; label: string; on: boolean; onClick: () => void; last?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-3 bg-white px-4 py-3.5 text-start ${last ? "" : "border-b border-slate-100"}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>
      <span className="flex-1 text-[14px] font-bold text-ink">{label}</span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-brand-600" : "bg-slate-200"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "start-[22px]" : "start-0.5"}`} />
      </span>
    </button>
  );
}
