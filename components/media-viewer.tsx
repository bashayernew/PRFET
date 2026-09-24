"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Heart, MessageCircle, Repeat2, Send, Bookmark, Volume2, VolumeX, Trash2 } from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { apiDelete, getAccessToken } from "@/lib/api";
import { repostPost, saveMedia, toggleLike, type FeedPost } from "@/lib/posts";
import { vipStyle } from "@/lib/vip";

export type ViewerItem = FeedPost;

/**
 * Full-screen media viewer. Shows images and videos one per screen and lets the user
 * scroll/swipe vertically between them (scroll-snap). Videos autoplay while on screen
 * and pause when scrolled away. Opened from the feed, the home strip and the profile grid.
 *
 * Each slide carries the same actions as the feed card — like, comment, repost, share,
 * save — on a right-hand rail, so people don't have to close the viewer to interact.
 * `onComments` / `onShare` are optional: screens that don't host those sheets simply
 * don't show the buttons.
 */
export default function MediaViewer({
  items,
  startIndex,
  onClose,
  onComments,
  onShare,
  onToast,
  onLikeChange,
  onDeleted,
}: {
  items: ViewerItem[];
  startIndex: number;
  onClose: () => void;
  onComments?: (p: FeedPost) => void;
  onShare?: (p: FeedPost) => void;
  onToast?: (msg: string) => void;
  onLikeChange?: (id: string, liked: boolean, likes: number) => void;
  onDeleted?: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Parents pass `onClose` as an inline arrow, so its identity changes on every parent
  // re-render. Keeping it in a ref (out of the dependency array) is what stops the
  // "jumps back to the first video" bug: liking a post updates the parent's list, the
  // parent re-renders, and the effect below would otherwise re-run and scroll back to
  // `startIndex`.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Jump to the tapped item on open, and lock the page behind the overlay.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      const slide = el.children[startIndex] as HTMLElement | undefined;
      if (slide) el.scrollTop = slide.offsetTop;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
    // Deliberately only `startIndex`: re-running this on any other change would fight
    // the user's scroll position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startIndex]);

  // Play the video that's on screen, pause the rest.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const vids = Array.from(el.querySelectorAll("video"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target as HTMLVideoElement;
          if (e.isIntersecting) v.play().catch(() => {});
          else v.pause();
        }
      },
      { root: el, threshold: 0.6 }
    );
    vids.forEach((v) => io.observe(v));
    return () => io.disconnect();
    // Keyed on the COUNT, not the array: a like updates the list in place and would
    // otherwise tear down and rebuild the observer, interrupting playback.
  }, [items.length]);

  return (
    <div data-no-pull-refresh className="fixed inset-0 z-[60] bg-black">
      <button
        onClick={onClose}
        aria-label="close"
        className="absolute end-4 top-[calc(env(safe-area-inset-top)+14px)] z-20 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur active:scale-95"
      >
        <X className="h-5 w-5" />
      </button>

      <div
        ref={scrollRef}
        className="h-full w-full snap-y snap-mandatory overflow-y-scroll overscroll-contain"
      >
        {items.map((it) => (
          <Slide
            key={it.id}
            post={it}
            onComments={onComments}
            onShare={onShare}
            onToast={onToast}
            onLikeChange={onLikeChange}
            onDeleted={onDeleted}
            onClose={onClose}
          />
        ))}
      </div>
    </div>
  );
}

/** One full-screen post: the media, the action rail, and the caption. */
function Slide({
  post, onComments, onShare, onToast, onLikeChange, onDeleted, onClose,
}: {
  post: FeedPost;
  onComments?: (p: FeedPost) => void;
  onShare?: (p: FeedPost) => void;
  onToast?: (msg: string) => void;
  onLikeChange?: (id: string, liked: boolean, likes: number) => void;
  onDeleted?: (id: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [liked, setLiked] = useState(post.likedByMe);
  const [likes, setLikes] = useState(post.likes);
  const [reposts, setReposts] = useState(post.reposts);
  const [muted, setMuted] = useState(true);

  async function like() {
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    const res = await toggleLike(post.id, getAccessToken() || undefined);
    if (res.ok && res.data) {
      setLiked(res.data.liked);
      setLikes(res.data.likes);
      onLikeChange?.(post.id, res.data.liked, res.data.likes);
    }
  }

  async function repost() {
    if (!post.allowRepost) { onToast?.(t("post.repostOff")); return; }
    const res = await repostPost(post.id, getAccessToken() || undefined);
    if (res.ok) {
      if (res.data?.already) onToast?.(t("post.alreadyReposted"));
      else { setReposts((n) => n + 1); onToast?.(t("post.reposted")); }
    }
  }

  async function save() {
    if (!post.allowSave) { onToast?.(t("post.saveOff")); return; }
    const ok = await saveMedia(post.mediaUrl);
    onToast?.(ok ? t("post.saved") : t("post.saveFailed"));
  }

  // Leaving the viewer first stops the overlay covering the profile page.
  function openProfile() {
    onClose();
    router.push(`/business/${post.user.id}`);
  }

  /** Delete my own post — the only place to do it from the profile grid. */
  async function remove() {
    if (!confirm(t("post.deleteConfirm"))) return;
    await apiDelete(`/api/posts/${post.id}`, getAccessToken() || undefined);
    onDeleted?.(post.id);
    onClose();
  }

  return (
    <div className="relative flex h-full w-full snap-start items-center justify-center">
      {post.kind === "video" ? (
        <>
          <video
            src={post.mediaUrl}
            loop
            muted={muted}
            playsInline
            preload="metadata"
            onDoubleClick={like}
            className="max-h-full max-w-full"
          />
          <button
            onClick={() => setMuted((m) => !m)}
            aria-label={t("post.sound")}
            className="absolute start-4 top-[calc(env(safe-area-inset-top)+14px)] z-10 grid h-10 w-10 place-items-center rounded-full bg-black/40 text-white backdrop-blur active:scale-95"
          >
            {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.mediaUrl}
          alt={post.caption || ""}
          onDoubleClick={like}
          className="max-h-full max-w-full object-contain"
        />
      )}

      {/* action rail */}
      <div className="absolute end-3 bottom-[calc(env(safe-area-inset-bottom)+26px)] z-10 flex flex-col items-center gap-4">
        <button onClick={openProfile} aria-label={post.user.displayName}
          className="grid h-11 w-11 place-items-center overflow-hidden rounded-full bg-white/20 text-[13px] font-extrabold text-white ring-2 ring-white/70 active:scale-90">
          {post.user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.user.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            post.user.displayName.charAt(0)
          )}
        </button>

        <RailButton onClick={like} count={likes} locale={locale} label={t("post.like")}
          icon={<Heart className={`h-7 w-7 ${liked ? "fill-red-500 text-red-500" : "text-white"}`} strokeWidth={2} />} />

        {onComments && (
          <RailButton onClick={() => onComments(post)} count={post.comments} locale={locale} label={t("post.comments")}
            icon={<MessageCircle className="h-7 w-7 text-white" strokeWidth={2} />} />
        )}

        <RailButton onClick={repost} count={reposts} locale={locale} label={t("post.repost")}
          icon={<Repeat2 className={`h-7 w-7 ${post.allowRepost ? "text-white" : "text-white/40"}`} strokeWidth={2} />} />

        {onShare && (
          <RailButton onClick={() => onShare(post)} locale={locale} label={t("post.share")}
            icon={<Send className="h-[26px] w-[26px] -rotate-12 text-white" strokeWidth={2} />} />
        )}

        <RailButton onClick={save} locale={locale} label={t("post.save")}
          icon={<Bookmark className={`h-7 w-7 ${post.allowSave ? "text-white" : "text-white/40"}`} strokeWidth={2} />} />

        {post.mine && (
          <RailButton onClick={remove} locale={locale} label={t("post.delete")}
            icon={<Trash2 className="h-6 w-6 text-red-400" strokeWidth={2} />} />
        )}
      </div>

      {/* author + caption */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] bg-gradient-to-t from-black/70 to-transparent pb-[calc(env(safe-area-inset-bottom)+22px)] pt-16 ps-4 pe-20">
        <button onClick={openProfile} className="pointer-events-auto text-[14.5px] font-extrabold text-white" style={vipStyle(post.user)}>
          {post.user.displayName}
        </button>
        {post.caption && (
          <p className="mt-1 line-clamp-3 text-[13px] font-medium leading-relaxed text-white/90">{post.caption}</p>
        )}
      </div>
    </div>
  );
}

function RailButton({
  icon, count, locale, label, onClick,
}: {
  icon: React.ReactNode;
  count?: number;
  locale: "ar" | "en";
  label: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} aria-label={label} className="flex flex-col items-center gap-1 active:scale-90">
      <span className="drop-shadow-lg">{icon}</span>
      {count !== undefined && count > 0 && (
        <span className="text-[11.5px] font-extrabold text-white drop-shadow">{ld(count, locale)}</span>
      )}
    </button>
  );
}
