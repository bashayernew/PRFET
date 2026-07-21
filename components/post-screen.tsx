"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, getAccessToken } from "@/lib/api";
import type { FeedPost } from "@/lib/posts";
import PostCard from "@/components/post-card";
import CommentsSheet from "@/components/comments-sheet";
import ShareSheet from "@/components/share-sheet";

/** One shared post, opened from a link. */
export default function PostScreen({ id }: { id: string }) {
  const router = useRouter();
  const { t, dir } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [post, setPost] = useState<FeedPost | null>(null);
  const [gone, setGone] = useState(false);
  const [comments, setComments] = useState(false);
  const [share, setShare] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }, []);

  useEffect(() => {
    if (!ready) return;
    apiGet<{ post: FeedPost }>(`/api/posts/${id}`, getAccessToken() || undefined).then((res) => {
      if (res.ok && res.data?.post) setPost(res.data.post);
      else setGone(true);
    });
  }, [ready, id]);

  if (!ready) return null;

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 bg-white px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)]">
        <button onClick={() => router.back()} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-ink active:scale-95">
          <Back className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <p className="text-[16px] font-extrabold text-ink">{t("post.title")}</p>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto">
        {post && (
          <PostCard
            post={post}
            onComments={() => setComments(true)}
            onShare={() => setShare(true)}
            onDeleted={() => router.push("/feed")}
            onToast={flash}
          />
        )}
        {gone && <p className="py-24 text-center text-[13.5px] font-bold text-muted">{t("post.gone")}</p>}
      </div>

      {post && comments && (
        <CommentsSheet
          postId={post.id}
          allowComment={post.allowComment}
          onClose={() => setComments(false)}
          onCount={(n) => setPost((p) => (p ? { ...p, comments: n } : p))}
        />
      )}
      {post && share && <ShareSheet post={post} onClose={() => setShare(false)} onToast={flash} />}

      {toast && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="pointer-events-none fixed bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[13px] font-bold text-white shadow-lg">
          {toast}
        </motion.div>
      )}
    </div>
  );
}
