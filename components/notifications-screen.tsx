"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, PartyPopper, Megaphone, Bell, CheckCheck, UserPlus, MessageCircle, Video, Heart, Repeat2, PhoneMissed, Briefcase, Crown, ShieldAlert, ShieldCheck } from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, apiPost, getAccessToken } from "@/lib/api";
import { vipStyle } from "@/lib/vip";

type Actor = { id: string; displayName: string; avatarUrl: string | null; isPremium?: boolean; textColor?: string | null };
type Notif = { id: string; kind: string; data: string | null; actor: Actor | null; href: string; read: boolean; createdAt: string };

const META: Record<string, { icon: typeof Bell; titleKey: string; bodyKey: string; tint: string }> = {
  welcome: { icon: PartyPopper, titleKey: "notif.welcomeTitle", bodyKey: "notif.welcomeBody", tint: "bg-accent-500" },
  ad_review: { icon: Megaphone, titleKey: "notif.adTitle", bodyKey: "notif.adBody", tint: "bg-brand-600" },
  new_follower: { icon: UserPlus, titleKey: "notif.followerTitle", bodyKey: "notif.followerBody", tint: "bg-emerald-500" },
  new_message: { icon: MessageCircle, titleKey: "notif.msgTitle", bodyKey: "notif.msgBody", tint: "bg-brand-500" },
  meeting_invite: { icon: Video, titleKey: "notif.meetTitle", bodyKey: "notif.meetBody", tint: "bg-violet-500" },
  post_like: { icon: Heart, titleKey: "notif.likeTitle", bodyKey: "notif.likeBody", tint: "bg-rose-500" },
  post_comment: { icon: MessageCircle, titleKey: "notif.commentTitle", bodyKey: "notif.commentBody", tint: "bg-sky-500" },
  post_repost: { icon: Repeat2, titleKey: "notif.repostTitle", bodyKey: "notif.repostBody", tint: "bg-emerald-500" },
  missed_call: { icon: PhoneMissed, titleKey: "notif.missedTitle", bodyKey: "notif.missedBody", tint: "bg-red-500" },
  job_application: { icon: Briefcase, titleKey: "notif.jobTitle", bodyKey: "notif.jobBody", tint: "bg-brand-600" },
  gift_premium: { icon: Crown, titleKey: "notif.giftTitle", bodyKey: "notif.giftBody", tint: "bg-amber-500" },
  job_expired: { icon: Briefcase, titleKey: "notif.jobExpTitle", bodyKey: "notif.jobExpBody", tint: "bg-orange-500" },
  seeker_expired: { icon: Briefcase, titleKey: "notif.seekExpTitle", bodyKey: "notif.seekExpBody", tint: "bg-orange-500" },
  ad_ending: { icon: Megaphone, titleKey: "notif.adEndTitle", bodyKey: "notif.adEndBody", tint: "bg-amber-500" },
  job_ending: { icon: Briefcase, titleKey: "notif.jobEndTitle", bodyKey: "notif.jobEndBody", tint: "bg-amber-500" },
  seeker_ending: { icon: Briefcase, titleKey: "notif.seekEndTitle", bodyKey: "notif.seekEndBody", tint: "bg-amber-500" },
  sub_renewing: { icon: Crown, titleKey: "notif.subRenewingTitle", bodyKey: "notif.subRenewingBody", tint: "bg-amber-500" },
  sub_ending: { icon: Crown, titleKey: "notif.subEndingTitle", bodyKey: "notif.subEndingBody", tint: "bg-orange-500" },
  sub_renewed: { icon: Crown, titleKey: "notif.subRenewedTitle", bodyKey: "notif.subRenewedBody", tint: "bg-emerald-500" },
  sub_ended: { icon: Crown, titleKey: "notif.subEndedTitle", bodyKey: "notif.subEndedBody", tint: "bg-slate-500" },
  sponsor_appointed: { icon: Crown, titleKey: "notif.sponsorTitle", bodyKey: "notif.sponsorBody", tint: "bg-amber-500" },
  branch_linked: { icon: Bell, titleKey: "notif.branchTitle", bodyKey: "notif.branchBody", tint: "bg-brand-600" },
  admin_appointed: { icon: ShieldCheck, titleKey: "notif.adminTitle", bodyKey: "notif.adminBody", tint: "bg-red-500" },
  suspended: { icon: ShieldAlert, titleKey: "notif.suspTitle", bodyKey: "notif.suspBody", tint: "bg-red-500" },
  unsuspended: { icon: ShieldCheck, titleKey: "notif.unsuspTitle", bodyKey: "notif.unsuspBody", tint: "bg-emerald-500" },
};

/** "BESHOO أعجب بمنشورك" — the actual sentence, with the actual person in it. */
function sentence(n: Notif, t: (k: string) => string) {
  const who = n.actor?.displayName ?? "";
  const text = n.data ?? "";
  const fill = (key: string) => t(key).replace("{name}", who).replace("{text}", text);
  switch (n.kind) {
    case "new_message": return text ? fill("notif.msgBy") : fill("notif.msgByPlain");
    case "new_follower": return fill("notif.followerBy");
    case "post_like": return fill("notif.likeBy");
    case "post_comment": return fill("notif.commentBy");
    case "post_repost": return fill("notif.repostBy");
    case "meeting_invite": return fill("notif.meetBy");
    case "ad_review": return text ? `${t("notif.adBody")} — “${text}”` : t("notif.adBody");
    case "missed_call": return fill("notif.missedBy");
    case "job_application": return fill("notif.jobBy");
    case "gift_premium": return fill("notif.giftBy");
    case "welcome": return t("notif.welcomeBody");
    case "job_expired": return text ? `${t("notif.jobExpBody")} — «${text}»` : t("notif.jobExpBody");
    case "seeker_expired": return t("notif.seekExpBody");
    case "ad_ending": return text ? `${t("notif.adEndBody")} — «${text}»` : t("notif.adEndBody");
    case "job_ending": return text ? `${t("notif.jobEndBody")} — «${text}»` : t("notif.jobEndBody");
    case "seeker_ending": return t("notif.seekEndBody");
    case "sub_renewing": return t("notif.subRenewingBody");
    case "sub_ending": return t("notif.subEndingBody");
    case "sub_renewed": return t("notif.subRenewedBody");
    case "sub_ended": return t("notif.subEndedBody");
    case "sponsor_appointed": return text || t("notif.sponsorBody");
    case "branch_linked": return text || t("notif.branchBody");
    case "admin_appointed": return text || t("notif.adminBody");
    case "suspended": return text || t("notif.suspBody");
    case "unsuspended": return t("notif.unsuspBody");
    default: return text;
  }
}

function fmt(iso: string, locale: "ar" | "en") {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    const hh = d.getHours().toString().padStart(2, "0");
    const mm = d.getMinutes().toString().padStart(2, "0");
    return ld(`${hh}:${mm}`, locale);
  }
  return ld(`${d.getDate()}/${d.getMonth() + 1}`, locale);
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);

  const markRead = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    await apiPost("/api/notifications", {}, token);
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
  }, []);

  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken();
    if (!token) return;
    apiGet<{ notifications: Notif[] }>("/api/notifications", token).then((res) => {
      if (res.ok && res.data?.notifications) {
        setItems(res.data.notifications);
        if (res.data.notifications.some((n) => !n.read)) markRead();
      }
      setLoading(false);
    });
  }, [ready, markRead]);

  if (!ready) return null;

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      {/* header */}
      <div className="flex items-center gap-3 border-b border-slate-100 bg-white px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)]">
        <button onClick={() => router.push("/home")} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full text-ink active:scale-95">
          <Back className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <h1 className="flex-1 text-[17px] font-extrabold text-ink">{t("notif.title")}</h1>
        {items.some((i) => !i.read) && (
          <button onClick={markRead} className="flex items-center gap-1 text-[12px] font-bold text-brand-600">
            <CheckCheck className="h-4 w-4" /> {t("notif.markRead")}
          </button>
        )}
      </div>

      {/* list */}
      <div className="no-scrollbar flex-1 overflow-y-auto">
        {!loading && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-8 py-24 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-3xl bg-brand-50">
              <Bell className="h-8 w-8 text-brand-300" />
            </div>
            <p className="text-[15px] font-extrabold text-ink">{t("notif.empty")}</p>
            <p className="max-w-[260px] text-[13px] text-muted">{t("notif.emptyHint")}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {items.map((n, idx) => {
              const m = META[n.kind] ?? { icon: Bell, titleKey: "notif.title", bodyKey: "notif.emptyHint", tint: "bg-slate-400" };
              const Icon = m.icon;
              const clickable = !!n.href;
              return (
                <motion.div
                  key={n.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  onClick={() => { if (n.href) router.push(n.href); }}
                  className={`flex items-start gap-3 px-5 py-4 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-slate-100 ${n.read ? "" : "bg-brand-50/40"} ${clickable ? "cursor-pointer active:bg-slate-50" : ""}`}
                >
                  {/* the person, with the kind of event as a little badge */}
                  <span className="relative shrink-0">
                    {n.actor ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); router.push(`/business/${n.actor!.id}`); }}
                        className="grid h-11 w-11 place-items-center overflow-hidden rounded-full bg-slate-200 text-[15px] font-extrabold text-slate-500"
                      >
                        {n.actor.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={n.actor.avatarUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          (n.actor.displayName || "•").charAt(0).toUpperCase()
                        )}
                      </button>
                    ) : (
                      <span className={`grid h-11 w-11 place-items-center rounded-2xl ${m.tint} text-white`}>
                        <Icon className="h-5 w-5" strokeWidth={2} />
                      </span>
                    )}
                    {n.actor && (
                      <span className={`absolute -bottom-0.5 -end-0.5 grid h-5 w-5 place-items-center rounded-full ring-2 ring-white ${m.tint} text-white`}>
                        <Icon className="h-3 w-3" strokeWidth={2.5} />
                      </span>
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13.5px] font-medium leading-snug text-ink" style={vipStyle(n.actor)}>{sentence(n, t)}</p>
                      <span className="shrink-0 text-[11px] font-bold text-muted">{fmt(n.createdAt, locale)}</span>
                    </div>
                  </div>
                  {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
