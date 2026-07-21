"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { X, Send, Trash2, MessageCircleOff } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiDelete, apiGet, apiPost, getAccessToken } from "@/lib/api";
import { timeAgo, type PostComment } from "@/lib/posts";
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
  const endRef = useRef<HTMLDivElement>(null);

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
    const res = await apiPost<{ comment: PostComment }>(`/api/posts/${postId}/comments`, { body }, getAccessToken() || undefined);
    setSending(false);
    if (res.ok && res.data?.comment) {
      const next = [...items, res.data.comment];
      setItems(next);
      onCount(next.length);
      setText("");
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  async function remove(id: string) {
    await apiDelete(`/api/posts/${postId}/comments?commentId=${id}`, getAccessToken() || undefined);
    const next = items.filter((c) => c.id !== id);
    setItems(next);
    onCount(next.length);
  }

  return (
    <div dir={dir} className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
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
          {items.map((c) => (
            <div key={c.id} className="flex items-start gap-2.5 py-2.5">
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
                <p className="mt-0.5 text-[11px] font-bold text-muted">{timeAgo(c.createdAt, locale)}</p>
              </div>
              {c.mine && (
                <button onClick={() => remove(c.id)} aria-label={t("post.deleteComment")} className="mt-1 text-slate-300 active:scale-90">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {allowComment ? (
          <div className="shrink-0 border-t border-slate-100 p-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
            <div className="flex items-center gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                placeholder={t("post.addComment")}
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
