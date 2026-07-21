"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, Megaphone, Plus, Film } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, getAccessToken } from "@/lib/api";
import type { FeedPost } from "@/lib/posts";
import PostCard from "@/components/post-card";
import CommentsSheet from "@/components/comments-sheet";
import ShareSheet from "@/components/share-sheet";

type ServedAd = { id: string; caption: string | null; mediaUrl: string | null; advertiser: string; userId: string };
type Row = { key: string; kind: "post"; post: FeedPost } | { key: string; kind: "ad"; ad: ServedAd };

/** The feed: posts and reels stacked under each other, scrolled like Instagram. */
export default function FeedScreen() {
  const router = useRouter();
  const { t, dir } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [ads, setAds] = useState<ServedAd[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [comments, setComments] = useState<FeedPost | null>(null);
  const [share, setShare] = useState<FeedPost | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken() || undefined;
    apiGet<{ posts: FeedPost[] }>("/api/posts", token).then((res) => {
      if (res.ok && res.data?.posts) setPosts(res.data.posts);
      setLoaded(true);
    });
    apiGet<{ ads: ServedAd[] }>("/api/ads/serve", token).then((res) => {
      if (res.ok && res.data?.ads) setAds(res.data.ads);
    });
  }, [ready]);

  // A paid ad slides in after every 4 posts. No house/demo ads.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let a = 0;
    posts.forEach((p, i) => {
      out.push({ key: p.id, kind: "post", post: p });
      if (ads.length && (i + 1) % 4 === 0) { out.push({ key: `ad-${a}-${ads[a % ads.length].id}`, kind: "ad", ad: ads[a % ads.length] }); a++; }
    });
    return out;
  }, [posts, ads]);

  if (!ready) return null;

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      <div className="z-10 flex shrink-0 items-center gap-3 border-b border-slate-100 bg-white px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)]">
        <button onClick={() => router.push("/home")} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-ink active:scale-95">
          <Back className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <p className="text-[16px] font-extrabold text-ink">{t("feed.title")}</p>
        <button onClick={() => router.push("/create")} aria-label={t("create.title")} className="ms-auto grid h-9 w-9 place-items-center rounded-full bg-brand-600 text-white active:scale-95">
          <Plus className="h-5 w-5" strokeWidth={2.6} />
        </button>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto">
        {rows.map((r) =>
          r.kind === "post" ? (
            <PostCard
              key={r.key}
              post={r.post}
              onComments={setComments}
              onShare={setShare}
              onDeleted={(id) => setPosts((ps) => ps.filter((p) => p.id !== id))}
              onToast={flash}
            />
          ) : (
            <AdCard key={r.key} ad={r.ad} t={t} onOpen={() => router.push(`/ad/${r.ad.id}`)} />
          )
        )}

        {loaded && posts.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 px-8 py-24 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-3xl bg-brand-50 text-brand-600"><Film className="h-8 w-8" /></span>
            <p className="text-[16px] font-extrabold text-ink">{t("feed.emptyTitle")}</p>
            <p className="max-w-[280px] text-[13px] font-medium text-muted">{t("feed.emptyHint")}</p>
            <button onClick={() => router.push("/create")} className="mt-1 rounded-2xl bg-brand-600 px-5 py-2.5 text-[13px] font-bold text-white active:scale-95">
              {t("create.title")}
            </button>
          </div>
        )}
      </div>

      {comments && (
        <CommentsSheet
          postId={comments.id}
          allowComment={comments.allowComment}
          onClose={() => setComments(null)}
          onCount={(n) => setPosts((ps) => ps.map((p) => (p.id === comments.id ? { ...p, comments: n } : p)))}
        />
      )}
      {share && <ShareSheet post={share} onClose={() => setShare(null)} onToast={flash} />}

      {toast && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="pointer-events-none fixed bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[13px] font-bold text-white shadow-lg">
          {toast}
        </motion.div>
      )}
    </div>
  );
}

function AdCard({ ad, t, onOpen }: { ad: ServedAd; t: (k: string) => string; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="block w-full border-b border-slate-100 bg-white pb-4 text-start active:opacity-90">
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
          <Megaphone className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-extrabold text-ink">{ad.advertiser}</span>
          <span className="block text-[11px] font-bold text-brand-600">{t("feed.sponsored")}</span>
        </span>
      </div>
      {ad.mediaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ad.mediaUrl} alt="" className="max-h-[60dvh] w-full bg-black object-contain" />
      ) : (
        <div className="grid h-44 w-full place-items-center bg-gradient-to-br from-brand-700 to-brand-500 px-8 text-white">
          <p className="line-clamp-3 text-center text-[18px] font-extrabold leading-snug drop-shadow">{ad.caption}</p>
        </div>
      )}
      {ad.caption && <p className="px-4 pt-2.5 text-[13.5px] font-medium leading-relaxed text-ink">{ad.caption}</p>}
    </button>
  );
}
