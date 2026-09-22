"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { X, Heart, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { getBusiness } from "@/lib/data";
import { catIcon } from "@/lib/cat-icons";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, apiPost, getAccessToken } from "@/lib/api";

type Story = { id: string; kind: "image" | "video"; mediaUrl: string; caption: string | null };

export default function StoryScreen({ id }: { id: string }) {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();
  const b = getBusiness(id);
  const [peer, setPeer] = useState<{ displayName: string; category: string | null; avatarUrl: string | null } | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const viewedRef = useRef<Set<string>>(new Set());
  const [myId, setMyId] = useState("");
  /** Like state per story id, so moving between stories keeps each one's heart correct. */
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ user: { displayName: string; category: string | null; avatarUrl: string | null } }>(`/api/users/${id}`, getAccessToken() || undefined).then((res) => {
      if (res.ok && res.data?.user) setPeer(res.data.user);
    });
    apiGet<{ user: { id: string } }>("/api/auth/me", getAccessToken() || undefined).then((r) => {
      if (r.ok && r.data?.user?.id) setMyId(r.data.user.id);
    });
    apiGet<{ stories: Story[] }>(`/api/stories?userId=${id}`).then((res) => {
      if (res.ok && res.data?.stories) setStories(res.data.stories);
      setLoaded(true);
    });
  }, [id]);

  const close = () => router.push("/home");

  /** Optimistic heart; the server's answer wins if they disagree. */
  async function likeStory(storyId: string) {
    const was = !!liked[storyId];
    setLiked((m) => ({ ...m, [storyId]: !was }));
    const res = await apiPost<{ liked: boolean }>(`/api/stories/${storyId}/like`, {}, getAccessToken() || undefined);
    if (res.ok && res.data) setLiked((m) => ({ ...m, [storyId]: res.data!.liked }));
    else setLiked((m) => ({ ...m, [storyId]: was }));
  }

  /**
   * Replying to a story sends a PRIVATE message to its owner, the way Instagram and
   * WhatsApp do — a story lasts a day, and a public thread under something about to vanish
   * helps nobody. It reuses the existing DM system, so the owner can just reply in chat.
   *
   * The story's caption rides along as context; without it the owner receives a bare
   * sentence with no idea which story prompted it.
   */
  async function sendStoryReply() {
    const body = replyText.trim();
    if (!body || replySending) return;
    setReplySending(true);
    const ctx = cur?.caption?.trim();
    const full = ctx ? `↩︎ "${ctx.slice(0, 80)}"\n${body}` : body;
    const res = await apiPost(`/api/conversations/${id}`, { body: full, kind: "text" }, getAccessToken() || undefined);
    setReplySending(false);
    if (res.ok) {
      setReplyText("");
      setToast(t("story.replySent"));
      setTimeout(() => setToast(null), 2000);
    } else {
      setToast(t("common.error"));
      setTimeout(() => setToast(null), 2200);
    }
  }

  // mark current story viewed
  useEffect(() => {
    const cur = stories[idx];
    if (!cur || viewedRef.current.has(cur.id)) return;
    viewedRef.current.add(cur.id);
    const token = getAccessToken();
    if (token) apiPost(`/api/stories/${cur.id}/view`, {}, token);
  }, [idx, stories]);

  if (!ready) return null;
  if (!b && !peer && loaded && stories.length === 0) {
    close();
    return null;
  }

  const Icon = catIcon(peer?.category ?? b?.catKey ?? "cat.other");
  const name = peer?.displayName ?? (b ? (locale === "ar" ? b.ar : b.en) : "");
  const avatarUrl = peer?.avatarUrl ?? b?.avatarUrl ?? null;
  const hasMedia = stories.length > 0;
  const cur = stories[idx];
  /** Your own story: no reply bar, since there's nobody to message. */
  const isMine = myId === id;

  // Jump to the next / previous person with an active story (order saved by the home screen).
  const jumpUser = (step: 1 | -1) => {
    try {
      const order: string[] = JSON.parse(sessionStorage.getItem("herot.storyOrder") || "[]");
      const i = order.indexOf(id);
      const target = i >= 0 ? order[i + step] : undefined;
      if (target) {
        setIdx(0);
        router.replace(`/story/${target}`);
        return;
      }
    } catch { /* no saved order */ }
    close();
  };

  const advance = () => {
    if (idx + 1 < stories.length) setIdx((i) => i + 1);
    else jumpUser(1);
  };
  const goBack = () => {
    if (idx > 0) setIdx((i) => i - 1);
    else jumpUser(-1);
  };
  // Tap the far side of the screen to go back, anywhere else to advance (flipped for RTL).
  const handleTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const backTap = dir === "rtl" ? frac > 0.72 : frac < 0.28;
    if (backTap) goBack();
    else advance();
  };

  return (
    <div
      dir={dir}
      onClick={handleTap}
      className="relative mx-auto flex h-[100dvh] max-w-[480px] flex-col overflow-hidden bg-gradient-to-br from-brand-600 via-brand-800 to-brand-900"
    >
      <div className="pointer-events-none absolute -right-16 top-24 h-60 w-60 rounded-full bg-white/10 blur-3xl" />
      <div className="pointer-events-none absolute -left-20 bottom-20 h-56 w-56 rounded-full bg-accent-500/20 blur-3xl" />

      {/* media */}
      {hasMedia && cur && (
        <div className="absolute inset-0 z-0 bg-black">
          {cur.kind === "video" ? (
            <video key={cur.id} src={cur.mediaUrl} className="h-full w-full object-contain" autoPlay muted playsInline onEnded={advance} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={cur.id} src={cur.mediaUrl} alt="" className="h-full w-full object-contain" />
          )}
        </div>
      )}

      {/* progress bars */}
      <div className="absolute inset-x-0 top-0 z-10 flex gap-1 px-3 pt-[calc(env(safe-area-inset-top)+10px)]">
        {(hasMedia ? stories : [null]).map((s, i) => (
          <div key={s?.id ?? i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
            {i === idx ? (
              <motion.div
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ duration: cur?.kind === "video" ? 15 : 5, ease: "linear" }}
                onAnimationComplete={advance}
                className="h-full bg-white"
              />
            ) : (
              <div className={`h-full ${i < idx ? "w-full bg-white" : "w-0"}`} />
            )}
          </div>
        ))}
      </div>

      {/* top bar */}
      <div className="relative z-10 flex items-center gap-3 px-4 pt-[calc(env(safe-area-inset-top)+22px)]">
        <button
          onClick={(e) => { e.stopPropagation(); router.push(`/business/${id}`); }}
          aria-label={name}
          className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-white/15 text-white active:scale-95"
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-10 w-10 object-cover" />
          ) : (
            <Icon className="h-5 w-5" strokeWidth={2} />
          )}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); router.push(`/business/${id}`); }}
          className="flex-1 truncate text-start text-[15px] font-extrabold text-white"
        >
          {name}
        </button>
        <button onClick={(e) => { e.stopPropagation(); close(); }} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* body */}
      {hasMedia ? (
        <div className="relative z-10 mt-auto bg-gradient-to-t from-black/70 to-transparent px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-16">
          {cur?.caption && <p className="mb-3 text-[15px] font-medium text-white">{cur.caption}</p>}
          {/* stopPropagation throughout: the screen itself advances the story on tap, so
              without it typing a reply would skip to the next one. */}
          {cur && !isMine && (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendStoryReply(); }}
                placeholder={t("story.reply")}
                className="h-11 flex-1 rounded-full border border-white/30 bg-white/10 px-4 text-[14px] font-medium text-white outline-none placeholder:text-white/60"
              />
              <button
                onClick={() => likeStory(cur.id)}
                aria-label={t("story.like")}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/15 active:scale-90"
              >
                <Heart className={`h-5 w-5 ${liked[cur.id] ? "fill-red-500 text-red-500" : "text-white"}`} />
              </button>
              <button
                onClick={sendStoryReply}
                disabled={!replyText.trim() || replySending}
                aria-label={t("chat.send")}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-600 text-white disabled:opacity-40 active:scale-90"
              >
                <Send className={`h-5 w-5 ${dir === "rtl" ? "-scale-x-100" : ""}`} />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <span className="grid h-28 w-28 place-items-center rounded-[40px] bg-white/10 ring-1 ring-white/20">
            <Icon className="h-14 w-14 text-white" strokeWidth={1.5} />
          </span>
          <p className="text-[22px] font-extrabold text-white">{name}</p>
          <p className="text-[13px] font-medium text-brand-100">{loaded ? t("story.none") : ""}</p>
        </div>
      )}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-28 z-20 flex justify-center px-6">
          <div className="rounded-full bg-black/80 px-4 py-2.5 text-[12.5px] font-bold text-white">{toast}</div>
        </div>
      )}
    </div>
  );
}
