"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, MessageCircle, Repeat2, Send, Bookmark, Trash2, Volume2, VolumeX, BadgeCheck } from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { apiDelete, getAccessToken } from "@/lib/api";
import { repostPost, saveMedia, timeAgo, toggleLike, type FeedPost } from "@/lib/posts";
import { vipStyle } from "@/lib/vip";

/**
 * One post in the scrollable feed — Instagram-style card:
 * author row, media, like / comment / repost / share, caption.
 */
export default function PostCard({
  post,
  onComments,
  onShare,
  onDeleted,
  onToast,
}: {
  post: FeedPost;
  onComments: (p: FeedPost) => void;
  onShare: (p: FeedPost) => void;
  onDeleted: (id: string) => void;
  onToast: (msg: string) => void;
}) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [liked, setLiked] = useState(post.likedByMe);
  const [likes, setLikes] = useState(post.likes);
  const [reposts, setReposts] = useState(post.reposts);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Play a reel only while it is on screen.
  useEffect(() => {
    const el = boxRef.current;
    const v = videoRef.current;
    if (!el || !v) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); },
      { threshold: 0.6 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [post.id]);

  async function like() {
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    const res = await toggleLike(post.id, getAccessToken() || undefined);
    if (res.ok && res.data) { setLiked(res.data.liked); setLikes(res.data.likes); }
  }

  async function repost() {
    if (!post.allowRepost) { onToast(t("post.repostOff")); return; }
    const res = await repostPost(post.id, getAccessToken() || undefined);
    if (res.ok) {
      if (res.data?.already) onToast(t("post.alreadyReposted"));
      else { setReposts((n) => n + 1); onToast(t("post.reposted")); }
    }
  }

  async function save() {
    if (!post.allowSave) { onToast(t("post.saveOff")); return; }
    const ok = await saveMedia(post.mediaUrl);
    onToast(ok ? t("post.saved") : t("post.saveFailed"));
  }

  async function remove() {
    if (!confirm(t("post.deleteConfirm"))) return;
    await apiDelete(`/api/posts/${post.id}`, getAccessToken() || undefined);
    onDeleted(post.id);
  }

  const openProfile = () => router.push(`/business/${post.user.id}`);
  const vip = vipStyle(post.user);

  return (
    <article className="border-b border-slate-100 bg-white pb-3">
      {/* author */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <button onClick={openProfile} className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-200 text-[13px] font-extrabold text-slate-500 ring-2 ring-brand-500/70">
          {post.user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.user.avatarUrl} alt="" className="h-10 w-10 object-cover" />
          ) : (
            post.user.displayName.slice(0, 1)
          )}
        </button>
        <button onClick={openProfile} className="min-w-0 flex-1 text-start">
          <span className="block truncate text-[14px] font-extrabold text-ink" style={vip}>{post.user.displayName}</span>
          <span className="block truncate text-[11px] font-bold text-muted">
            {post.repostOf ? (
              <span className="inline-flex items-center gap-1">
                <Repeat2 className="h-3 w-3" /> {t("post.repostedFrom")} {post.repostOf.user.displayName}
              </span>
            ) : (
              timeAgo(post.createdAt, locale)
            )}
          </span>
        </button>
        {post.mine ? (
          <button onClick={remove} aria-label={t("post.delete")} className="grid h-8 w-8 place-items-center rounded-full text-slate-300 active:scale-90">
            <Trash2 className="h-4 w-4" />
          </button>
        ) : (
          <BadgeCheck className="h-4 w-4 text-brand-500/0" />
        )}
      </div>

      {/* media */}
      <div ref={boxRef} className="relative bg-black">
        {post.kind === "video" ? (
          <>
            <video
              ref={videoRef}
              src={post.mediaUrl}
              loop
              muted={muted}
              playsInline
              onClick={() => setMuted((m) => !m)}
              className="max-h-[70dvh] w-full object-contain"
            />
            <button
              onClick={() => setMuted((m) => !m)}
              aria-label="sound"
              className="absolute bottom-3 end-3 grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white active:scale-95"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.mediaUrl} alt="" onDoubleClick={like} className="max-h-[70dvh] w-full object-contain" />
        )}
      </div>

      {/* actions */}
      <div className="flex items-center gap-5 px-4 pt-3">
        <Action onClick={like} icon={<Heart className={`h-[23px] w-[23px] ${liked ? "fill-red-500 text-red-500" : "text-ink"}`} strokeWidth={2} />} count={likes} locale={locale} />
        <Action onClick={() => onComments(post)} icon={<MessageCircle className="h-[23px] w-[23px] text-ink" strokeWidth={2} />} count={post.comments} locale={locale} />
        <Action
          onClick={repost}
          icon={<Repeat2 className={`h-[23px] w-[23px] ${post.allowRepost ? "text-ink" : "text-slate-300"}`} strokeWidth={2} />}
          count={reposts}
          locale={locale}
        />
        <Action onClick={() => onShare(post)} icon={<Send className="h-[22px] w-[22px] text-ink -rotate-12" strokeWidth={2} />} locale={locale} />
        <button onClick={save} aria-label={t("post.save")} className="ms-auto active:scale-90">
          <Bookmark className={`h-[22px] w-[22px] ${post.allowSave ? "text-ink" : "text-slate-300"}`} strokeWidth={2} />
        </button>
      </div>

      {/* caption */}
      {post.caption && (
        <p className="px-4 pt-2 text-[13.5px] leading-relaxed text-ink">
          <button onClick={openProfile} className="font-extrabold" style={vip}>{post.user.displayName}</button>{" "}
          <span className="font-medium" style={vip}>{post.caption}</span>
        </p>
      )}
      {post.comments > 0 && (
        <button onClick={() => onComments(post)} className="px-4 pt-1.5 text-[12.5px] font-bold text-muted">
          {t("post.viewAll")} {ld(post.comments, locale)} {t("post.commentsWord")}
        </button>
      )}
      {post.repostOf && <p className="px-4 pt-1 text-[11px] font-bold text-muted">{timeAgo(post.createdAt, locale)}</p>}
    </article>
  );
}

function Action({ icon, count, locale, onClick }: { icon: React.ReactNode; count?: number; locale: "ar" | "en"; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 active:scale-90">
      {icon}
      {count !== undefined && count > 0 && <span className="text-[12.5px] font-extrabold text-ink">{ld(count, locale)}</span>}
    </button>
  );
}
