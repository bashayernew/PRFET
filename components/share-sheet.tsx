"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { X, Search, Send, Link2, Share2, Check, CirclePlus, Repeat2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiGet, apiPost, getAccessToken } from "@/lib/api";
import { postLink, repostPost, type FeedPost } from "@/lib/posts";

type Person = { id: string; displayName: string; avatarUrl: string | null };

/** Share a post: with people you follow, to your story, to your own feed, or via the phone. */
export default function ShareSheet({ post, onClose, onToast }: { post: FeedPost; onClose: () => void; onToast?: (m: string) => void }) {
  const { t, dir } = useI18n();
  const [people, setPeople] = useState<Person[]>([]);
  const [q, setQ] = useState("");
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const postId = post.id;
  const caption = post.caption;
  const link = postLink(postId);

  // Put their post on my story (24h) — only when the author allowed resharing.
  async function toStory() {
    if (!post.allowRepost) { onToast?.(t("post.repostOff")); onClose(); return; }
    if (busy) return;
    setBusy(true);
    const res = await apiPost("/api/stories", { kind: post.kind === "video" ? "video" : "image", mediaUrl: post.mediaUrl, caption: post.caption ?? undefined }, getAccessToken() || undefined);
    setBusy(false);
    onToast?.(res.ok ? t("post.toStoryDone") : t("common.error"));
    onClose();
  }

  // Repost it to my own feed.
  async function toFeed() {
    if (!post.allowRepost) { onToast?.(t("post.repostOff")); onClose(); return; }
    if (busy) return;
    setBusy(true);
    const res = await repostPost(postId, getAccessToken() || undefined);
    setBusy(false);
    onToast?.(res.ok ? (res.data?.already ? t("post.alreadyReposted") : t("post.reposted")) : t("common.error"));
    onClose();
  }

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    apiGet<{ targets: Person[] }>("/api/follows?full=1", token).then((res) => {
      if (res.ok && res.data?.targets) setPeople(res.data.targets);
    });
  }, []);

  const list = useMemo(
    () => (q ? people.filter((p) => p.displayName.toLowerCase().includes(q.toLowerCase())) : people),
    [people, q]
  );

  async function sendTo(p: Person) {
    if (sent[p.id]) return;
    const body = caption ? `${caption}\n${link}` : link;
    const res = await apiPost(`/api/conversations/${p.id}`, { body, kind: "text" }, getAccessToken() || undefined);
    if (res.ok) setSent((s) => ({ ...s, [p.id]: true }));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked */ }
  }

  async function native() {
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: "PRFET", text: caption ?? "", url: link }); } catch { /* cancelled */ }
    } else {
      copy();
    }
  }

  return (
    <div dir={dir} className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[76dvh] w-full max-w-[480px] flex-col rounded-t-3xl bg-white"
      >
        <div className="relative shrink-0 border-b border-slate-100 py-3.5 text-center">
          <span className="absolute start-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-slate-200" />
          <p className="text-[14.5px] font-extrabold text-ink">{t("post.shareTitle")}</p>
          <button onClick={onClose} aria-label={t("close")} className="absolute end-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-muted active:scale-95">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="shrink-0 px-4 pt-3">
          <div className="flex h-11 items-center gap-2 rounded-2xl bg-slate-100 px-3.5">
            <Search className="h-4 w-4 shrink-0 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("post.searchPeople")}
              className="w-full bg-transparent text-[14px] font-medium text-ink outline-none placeholder:text-muted"
            />
          </div>
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-4">
          {list.length === 0 ? (
            <p className="py-8 text-center text-[13px] font-medium text-muted">{t("post.noFollowing")}</p>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {list.map((p) => (
                <button key={p.id} onClick={() => sendTo(p)} className="flex flex-col items-center gap-1.5 active:scale-95">
                  <span className="relative grid h-16 w-16 place-items-center overflow-hidden rounded-full bg-slate-200 text-[18px] font-extrabold text-slate-500">
                    {p.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatarUrl} alt="" className="h-16 w-16 object-cover" />
                    ) : (
                      p.displayName.slice(0, 1)
                    )}
                    {sent[p.id] && (
                      <span className="absolute inset-0 grid place-items-center bg-brand-600/80 text-white">
                        <Check className="h-6 w-6" strokeWidth={3} />
                      </span>
                    )}
                  </span>
                  <span className="line-clamp-1 text-[11.5px] font-bold text-ink">{p.displayName}</span>
                  <span className="text-[10.5px] font-bold text-brand-600">{sent[p.id] ? t("post.sent") : t("post.send")}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
          <div className="flex items-center justify-around">
            <Round icon={<CirclePlus className="h-5 w-5" />} label={t("post.toStory")} onClick={toStory} />
            <Round icon={<Repeat2 className="h-5 w-5" />} label={t("post.toFeed")} onClick={toFeed} />
            <Round icon={copied ? <Check className="h-5 w-5" /> : <Link2 className="h-5 w-5" />} label={copied ? t("post.copied") : t("post.copyLink")} onClick={copy} />
            <Round icon={<Share2 className="h-5 w-5" />} label={t("post.moreShare")} onClick={native} />
            <Round
              icon={<Send className={`h-5 w-5 ${dir === "rtl" ? "-scale-x-100" : ""}`} />}
              label="WhatsApp"
              onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(link)}`, "_blank")}
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function Round({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 active:scale-95">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-ink">{icon}</span>
      <span className="text-[11px] font-bold text-muted">{label}</span>
    </button>
  );
}
