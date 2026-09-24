"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { X, Send, Trash2, MessageCircleOff, Heart, CornerUpLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiDelete, apiGet, apiPost, getAccessToken } from "@/lib/api";
import { timeAgo, toggleCommentLike, type PostComment } from "@/lib/posts";
import { vipStyle } from "@/lib/vip";

/** Bottom sheet with everyone's comments on a post. */
export default function CommentsSheet({
  postId,
  allowComment,
  onClose,
  onCount,
}: {
  postId: string;
  allowComment: boolean;
  onClose: () => void;
  onCount: (n: number) => void;
}) {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const [items, setItems] = useState<PostComment[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  /** The comment being replied to, or null to post at the top level. */
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const token = getAccessToken() || undefined;
    apiGet<{ comments: PostComment[] }>(`/api/posts/${postId}/comments`, token).then((res) => {
      if (res.ok && res.data?.comments) setItems(res.data.comments);
    });
  }, [postId]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const res = await apiPost<{ comment: PostComment }>(
      `/api/posts/${postId}/comments`,
      { body, ...(replyTo ? { parentId: replyTo.id } : {}) },
      getAccessToken() || undefined
    );
    setSending(false);
    if (res.ok && res.data?.comment) {
      const next = [...items, res.data.comment];
      setItems(next);
      onCount(next.length);
      setText("");
      setReplyTo(null);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  /** Optimistic: the heart fills on tap, and only rolls back if the server disagrees. */
  async function like(c: PostComment) {
    const wasLiked = !!c.liked;
    setItems((cur) => cur.map((x) => (x.id === c.id
      ? { ...x, liked: !wasLiked, likes: Math.max(0, (x.likes ?? 0) + (wasLiked ? -1 : 1)) }
      : x)));
    const res = await toggleCommentLike(c.id, getAccessToken() || undefined);
    if (res.ok && res.data) {
      const { liked, likes } = res.data;
      setItems((cur) => cur.map((x) => (x.id === c.id ? { ...x, liked, likes } : x)));
    } else {
      setItems((cur) => cur.map((x) => (x.id === c.id ? { ...x, liked: wasLiked, likes: c.likes ?? 0 } : x)));
    }
  }

  function startReply(c: PostComment) {
    setReplyTo(c);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function remove(id: string) {
    await apiDelete(`/api/posts/${postId}/comments?commentId=${id}`, getAccessToken() || undefined);
    // The database cascades replies with their parent; mirror that here so the list doesn't
    // show orphans pointing at a comment that no longer exists.
    const doomed = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of items) {
        if (c.parentId && doomed.has(c.parentId) && !doomed.has(c.id)) { doomed.add(c.id); grew = true; }
      }
    }
    const next = items.filter((c) => !doomed.has(c.id));
    setItems(next);
    onCount(next.length);
  }

  /**
   * Flat list -> tree, preserving the oldest-first order at every level.
   *
   * A reply whose parent is missing (deleted in another session, say) is promoted to the
   * top level rather than silently dropped — losing someone's words is worse than showing
   * them slightly out of place.
   */
  const byParent = new Map<string | null, PostComment[]>();
  const ids = new Set(items.map((c) => c.id));
  for (const c of items) {
    const key = c.parentId && ids.has(c.parentId) ? c.parentId : null;
    const list = byParent.get(key) ?? [];
    list.push(c);
    byParent.set(key, list);
  }

  // z-[70]: must sit ABOVE the fullscreen media viewer (z-[60]). At z-50 this sheet opened
  // BEHIND the viewer's opaque backdrop, so tapping comment on a fullscreen video looked
  // like it did nothing at all.
  return (
    <div data-no-pull-refresh dir={dir} className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50" onClick={onClose}>
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[72dvh] w-full max-w-[480px] flex-col rounded-t-3xl bg-white"
      >
        <div className="relative shrink-0 border-b border-slate-100 py-3.5 text-center">
          <span className="absolute start-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-slate-200" />
          <p className="text-[14.5px] font-extrabold text-ink">{t("post.comments")}</p>
          <button onClick={onClose} aria-label={t("close")} className="absolute end-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-muted active:scale-95">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-3">
          {items.length === 0 && (
            <p className="mt-10 text-center text-[13px] font-medium text-muted">{t("post.noComments")}</p>
          )}
          {/* Render the tree. `depth` only drives the indent, which stops growing after a
              few levels — on a 375px screen, deeper indentation would squeeze the text into
              a column too narrow to read while the conversation itself can nest freely. */}
          {(function renderLevel(parentId: string | null, depth: number): React.ReactNode {
            const level = byParent.get(parentId) ?? [];
            return level.map((c) => (
              <div key={c.id} style={{ marginInlineStart: Math.min(depth, 4) * 18 }}>
                <div className="flex items-start gap-2.5 py-2.5">
                  <button onClick={() => router.push(`/business/${c.user.id}`)} className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-200 text-[12px] font-extrabold text-slate-500">
                    {c.user.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.user.avatarUrl} alt="" className="h-9 w-9 object-cover" />
                    ) : (
                      c.user.displayName.slice(0, 1)
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-snug text-ink">
                      <button onClick={() => router.push(`/business/${c.user.id}`)} className="font-extrabold" style={vipStyle(c.user)}>{c.user.displayName}</button>{" "}
                      <span className="font-medium" style={vipStyle(c.user)}>{c.body}</span>
                    </p>
                    <div className="mt-1 flex items-center gap-4">
                      <span className="text-[11px] font-bold text-muted">{timeAgo(c.createdAt, locale)}</span>
                      {allowComment && (
                        <button onClick={() => startReply(c)} className="flex items-center gap-1 text-[11px] font-bold text-muted active:scale-95">
                          <CornerUpLeft className="h-3.5 w-3.5" /> {t("post.reply")}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 flex shrink-0 flex-col items-center gap-0.5">
                    <button onClick={() => like(c)} aria-label={t("post.likeComment")} className="active:scale-90">
                      <Heart className={`h-4 w-4 ${c.liked ? "fill-red-500 text-red-500" : "text-slate-300"}`} />
                    </button>
                    {!!c.likes && <span className="text-[10px] font-bold text-muted">{c.likes}</span>}
                    {c.mine && (
                      <button onClick={() => remove(c.id)} aria-label={t("post.deleteComment")} className="mt-1 text-slate-300 active:scale-90">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                {renderLevel(c.id, depth + 1)}
              </div>
            ));
          })(null, 0)}
          <div ref={endRef} />
        </div>

        {allowComment ? (
          <div className="shrink-0 border-t border-slate-100 p-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
            {/* Without this it's impossible to tell a reply from a new comment until after
                you've sent it to the wrong place. */}
            {replyTo && (
              <div className="mb-2 flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-1.5">
                <CornerUpLeft className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-bold text-muted">
                  {t("post.replyingTo")} {replyTo.user.displayName}
                </span>
                <button onClick={() => setReplyTo(null)} aria-label={t("close")} className="shrink-0 text-muted active:scale-90">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                placeholder={replyTo ? t("post.replyPlaceholder") : t("post.addComment")}
                className="h-11 flex-1 rounded-2xl bg-slate-100 px-4 text-[14px] font-medium text-ink outline-none placeholder:text-muted"
              />
              <button
                onClick={send}
                disabled={!text.trim() || sending}
                aria-label={t("chat.send")}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-600 text-white disabled:opacity-40 active:scale-95"
              >
                <Send className={`h-5 w-5 ${dir === "rtl" ? "-scale-x-100" : ""}`} />
              </button>
            </div>
          </div>
        ) : (
          <div className="shrink-0 border-t border-slate-100 p-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
            <p className="flex items-center justify-center gap-2 text-[13px] font-bold text-muted">
              <MessageCircleOff className="h-4 w-4" /> {t("post.commentsOff")}
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
