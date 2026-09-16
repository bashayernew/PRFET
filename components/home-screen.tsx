"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Search,
  Bell,
  Settings,
  MapPin,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  Newspaper,
  Crown,
  Sparkles,
  Briefcase,
  Video,
  Plus,
} from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { catIcon } from "@/lib/cat-icons";
import { getCountry } from "@/lib/countries";
import BottomNav from "@/components/bottom-nav";
import SocialCircles from "@/components/social-circles";
import CountrySheet from "@/components/country-sheet";
import { useRequireAuth } from "@/lib/use-auth";
import { useLocationSync } from "@/lib/use-location-sync";
import { apiGet, apiPatch, apiPost, apiUpload, getAccessToken } from "@/lib/api";
import type { FeedPost } from "@/lib/posts";
import PostCard from "@/components/post-card";
import MediaViewer from "@/components/media-viewer";
import CommentsSheet from "@/components/comments-sheet";
import ShareSheet from "@/components/share-sheet";
import { enablePush } from "@/lib/push-client";
import { registerNativePush } from "@/lib/native-push";

type Me = { displayName: string; accountType: string; country: string | null; browseCountries: string; shareLocation: boolean; avatarUrl: string | null; isPremium: boolean; isAdmin?: boolean; hideTop?: boolean; social1?: string | null; social2?: string | null; social3?: string | null };
type StoryUser = { id: string; displayName: string; avatarUrl: string | null; category: string | null };
type FeedAd = { id: string; caption: string | null; mediaUrl: string | null; advertiser: string; userId: string };

export default function HomeScreen() {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();
  useLocationSync(ready); // store my position so distances can be shown
  const [name, setName] = useState("");
  const [me, setMe] = useState<Me | null>(null);
  const [hasUnread, setHasUnread] = useState(false);
  const [follows, setFollows] = useState<string[]>([]);
  const [dirUsers, setDirUsers] = useState<{ id: string; displayName: string; category: string | null }[] | null>(null);
  const [storyUsers, setStoryUsers] = useState<StoryUser[]>([]);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [feedAds, setFeedAds] = useState<FeedAd[]>([]);
  const [liveRooms, setLiveRooms] = useState<{ id: string; title: string; host: string; hostId: string; hostAvatar: string | null }[]>([]);
  const [viewerAt, setViewerAt] = useState<number | null>(null); // index into posts for the fullscreen viewer
  const [comments, setComments] = useState<FeedPost | null>(null);
  const [share, setShare] = useState<FeedPost | null>(null);
  const storyInputRef = useRef<HTMLInputElement>(null);
  const [storyToast, setStoryToast] = useState<string | null>(null);
  const [countryOpen, setCountryOpen] = useState(false);

  async function postStory(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const token = getAccessToken() || undefined;
    const up = await apiUpload<{ url: string }>("/api/upload", file, token);
    if (up.ok && up.data?.url) {
      const kind = file.type.startsWith("video") ? "video" : "image";
      await apiPost("/api/stories", { kind, mediaUrl: up.data.url }, token);
      setStoryToast(t("story.posted"));
      window.setTimeout(() => setStoryToast(null), 1800);
    }
    if (storyInputRef.current) storyInputRef.current.value = "";
  }
  const Chevron = dir === "rtl" ? ChevronLeft : ChevronRight;

  useEffect(() => {
    const n = localStorage.getItem("herot.name");
    if (n) setName(n);
  }, []);

  // "Live now" — rooms visible to me (people I follow + public) that are broadcasting right
  // now. Polls every 30s so a newly-started live appears at the top of home without a reload.
  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken() || undefined;
    const load = () => {
      apiGet<{ meetings: { id: string; title: string; host: string; hostId: string; hostAvatar: string | null }[] }>("/api/meetings", token)
        .then((r) => { if (r.ok && r.data?.meetings) setLiveRooms(r.data.meetings); })
        .catch(() => {});
    };
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, [ready]);

  // Country-targeted ads mixed into the home feed — everyone in the ad's country sees them
  // (no follow needed). Falls back to worldwide ads if we don't know the viewer's country yet.
  useEffect(() => {
    if (!ready) return;
    const country = me?.country || (typeof window !== "undefined" ? localStorage.getItem("herot.country") : "") || "";
    const url = country ? `/api/ads/serve?limit=8&country=${encodeURIComponent(country)}` : "/api/ads/serve?limit=8";
    apiGet<{ ads: FeedAd[] }>(url).then((r) => { if (r.ok && r.data?.ads) setFeedAds(r.data.ads); }).catch(() => {});
  }, [ready, me?.country]);

  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken();
    if (!token) return;
    enablePush(token);            // browsers / installed PWA (web-push)
    registerNativePush(token);    // installed app (native FCM — reaches the phone when closed)
    apiGet<{ user: Me }>("/api/auth/me", token).then((res) => {
      if (res.ok && res.data?.user) {
        setMe(res.data.user);
        if (res.data.user.displayName) setName(res.data.user.displayName);
      }
    });
    apiGet<{ unread: number }>("/api/notifications", token).then((res) => {
      if (res.ok && res.data) setHasUnread(res.data.unread > 0);
    });
    apiGet<{ targetIds: string[] }>("/api/follows", token).then((res) => {
      if (res.ok && res.data?.targetIds) setFollows(res.data.targetIds);
    });
    apiGet<{ users: { id: string; displayName: string; category: string | null }[] }>("/api/users", token).then((res) => {
      if (res.ok && res.data?.users) setDirUsers(res.data.users);
    });
    // real stories: who actually posted (unique users, newest first)
    apiGet<{ stories: { userId: string; user: { id: string; displayName: string; avatarUrl: string | null; category: string | null } }[] }>("/api/stories", token).then((res) => {
      if (res.ok && res.data?.stories) {
        const seen = new Set<string>();
        const users: StoryUser[] = [];
        for (const s of res.data.stories) {
          if (!seen.has(s.userId)) { seen.add(s.userId); users.push(s.user); }
        }
        setStoryUsers(users);
        // remember the order so the story viewer can jump between people
        try { sessionStorage.setItem("herot.storyOrder", JSON.stringify(users.map((u) => u.id))); } catch { /* ignore */ }
      }
    });
    let alive = true;
    const loadPosts = () => {
      // following-only: discovery lives on the Discover page, not the home feed
      apiGet<{ posts: FeedPost[] }>("/api/posts?feed=following", token).then((res) => {
        if (alive && res.ok && res.data?.posts) setPosts(res.data.posts);
      });
    };
    loadPosts();
    // Keep the feed fresh: refetch when the tab regains focus, and quietly poll while open,
    // so a newly published post appears without a manual reload.
    const onFocus = () => { if (document.visibilityState === "visible") loadPosts(); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => { if (document.visibilityState === "visible") loadPosts(); }, 30_000);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [ready]);

  // Publish an image/video post from the Reels row.

  function toggleShareLocation() {
    // Precise location sharing is a premium feature — free users get the upsell.
    if (!me?.isPremium) {
      router.push("/subscribe");
      return;
    }
    const token = getAccessToken() || undefined;
    const next = !me?.shareLocation;
    setMe((m) => (m ? { ...m, shareLocation: next } : m));
    if (next && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => apiPatch("/api/auth/me", { shareLocation: true, locationLat: pos.coords.latitude, locationLng: pos.coords.longitude }, token),
        () => apiPatch("/api/auth/me", { shareLocation: true }, token)
      );
    } else {
      apiPatch("/api/auth/me", { shareLocation: next }, token);
    }
  }

  if (!ready) return null;

  const initial = (name || "•").trim().charAt(0).toUpperCase();
  const isBusiness = me?.accountType === "business";
  // which countries am I browsing? (empty = everywhere)
  const browse = (me?.browseCountries || "").split(",").map((c) => c.trim()).filter(Boolean);
  const browseLabel = browse.length === 0
    ? t("browse.everywhere")
    : browse.length === 1
    ? (() => { const c = getCountry(browse[0]); return c ? `${c.flag} ${c[locale]}` : browse[0]; })()
    : `${browse.map((b) => getCountry(b)?.flag ?? "").join(" ")} ${ld(browse.length, locale)} ${t("ads.countries")}`;

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      <input ref={storyInputRef} type="file" accept="image/*,video/*" hidden onChange={postStory} />
      {storyToast && (
        <div className="pointer-events-none fixed inset-x-0 top-24 z-50 mx-auto max-w-[300px] rounded-2xl bg-ink px-4 py-2.5 text-center text-[13px] font-bold text-white">{storyToast}</div>
      )}
      {/* ===== header — gold while subscribed ===== */}
      <div className={`px-5 pb-6 pt-[calc(env(safe-area-inset-top)+16px)] ${me?.isAdmin ? "admin-header" : me?.isPremium ? "vip-header" : "bg-gradient-to-b from-brand-700 to-brand-600"}`}>
        <div className="flex items-center justify-between">
          {/* photo + name + account type */}
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => router.push("/profile")}
              className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white text-[17px] font-extrabold text-brand-700"
            >
              {me?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={me.avatarUrl} alt="" className="h-11 w-11 object-cover" />
              ) : (
                initial
              )}
            </button>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-bold text-white">
                {t("home.hi")}{name ? `، ${name}` : ""} 👋
              </p>
              <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white ${me?.isPremium ? "vip-chip" : "bg-white/15"}`}>
                {isBusiness ? t("account.business.title") : t("account.personal.title")}
              </span>
            </div>
          </div>
          {/* location · settings · bell */}
          <div className="flex shrink-0 items-center gap-2.5">
            <button
              onClick={toggleShareLocation}
              aria-label="location"
              className={`grid h-10 w-10 place-items-center rounded-full active:scale-95 ${me?.shareLocation ? "bg-emerald-500 text-white" : "bg-white/15 text-white/70"}`}
            >
              <MapPin className="h-5 w-5" />
            </button>
            <button
              onClick={() => router.push("/settings")}
              aria-label={t("home.settings")}
              className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white active:scale-95"
            >
              <Settings className="h-5 w-5" />
            </button>
            <button
              onClick={() => router.push("/notifications")}
              aria-label={t("notif.title")}
              className="relative grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white active:scale-95"
            >
              <Bell className="h-5 w-5" />
              {hasUnread && <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-accent-400 ring-2 ring-brand-700" />}
            </button>
          </div>
        </div>

        {/* my socials — small circles right under the icons */}
        {me?.isPremium && (
          <div className="mt-2.5 flex justify-end">
            <SocialCircles links={[me.social1, me.social2, me.social3]} size={26} />
          </div>
        )}

        {/* the countries whose people I want to see — one, several, or everywhere */}
        <div className="mt-4 flex items-center gap-2 text-white">
          <MapPin className="h-4 w-4 text-brand-200" />
          <span className="truncate text-[14px] font-bold">{browseLabel}</span>
          <button
            onClick={() => setCountryOpen(true)}
            className={`ms-1 flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-bold text-white ${me?.isPremium ? "vip-chip" : "bg-white/12"}`}
          >
            {t("profile.change")}
            <Chevron className="h-3.5 w-3.5 text-brand-200" />
          </button>
        </div>

      </div>

      {/* ===== scroll body ===== */}
      <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-4 pt-5">
        {/* quick actions — 6 boxes (2 rows) */}
        <div className="grid grid-cols-3 gap-2">
          <StripCard icon={<Newspaper className="h-5 w-5" />} tint="bg-brand-50 text-brand-600" label={t("home.boxAds")} onClick={() => router.push("/ads")} />
          <StripCard icon={<Crown className="h-5 w-5" />} tint="bg-amber-50 text-amber-600" label={t("home.boxSponsor")} onClick={() => router.push("/sponsor")} />
          <StripCard icon={<Briefcase className="h-5 w-5" />} tint="bg-rose-50 text-rose-600" label={t("home.boxJobs")} onClick={() => router.push("/jobs")} />
          {/* Ask PRFET — the AI assistant (replaces the old "most viewed" doorway) */}
          <StripCard icon={<Sparkles className="h-5 w-5" />} tint="bg-emerald-50 text-emerald-600" label={t("home.boxAsk")} onClick={() => router.push("/ask")} />
          <StripCard icon={<Video className="h-5 w-5" />} tint="bg-violet-50 text-violet-600" label={t("home.boxMeetings")} onClick={() => router.push("/meetings")} />
          <StripCard icon={<Search className="h-5 w-5" />} tint="bg-sky-50 text-sky-600" label={t("home.boxSearch")} onClick={() => router.push("/discover")} />
        </div>

        {/* Live now — only people I FOLLOW who are broadcasting right this moment (a public
            room from a stranger shouldn't appear on everyone's home). */}
        {liveRooms.filter((r) => follows.includes(r.hostId)).length > 0 && (
          <div className="mt-7">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              <h2 className="text-[16px] font-extrabold text-ink">{t("home.liveNow")}</h2>
            </div>
            <div className="no-scrollbar -mx-5 flex gap-3.5 overflow-x-auto px-5 pb-1">
              {liveRooms.filter((r) => follows.includes(r.hostId)).map((r) => (
                <button key={r.id} onClick={() => router.push(`/meetings/${r.id}`)} className="flex shrink-0 flex-col items-center gap-1.5">
                  <span className="relative rounded-full bg-gradient-to-tr from-red-500 to-rose-500 p-[2.5px]">
                    <span className="grid place-items-center rounded-full bg-slate-50 p-[2.5px]">
                      <span className="grid h-[54px] w-[54px] place-items-center overflow-hidden rounded-full bg-brand-50">
                        {r.hostAvatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.hostAvatar} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[18px] font-extrabold text-brand-600">{(r.host || "•").charAt(0).toUpperCase()}</span>
                        )}
                      </span>
                    </span>
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-red-500 px-1.5 text-[8.5px] font-extrabold text-white ring-2 ring-slate-50">LIVE</span>
                  </span>
                  <span className="w-16 truncate text-center text-[11px] font-bold text-ink/80">{r.host}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* stories */}
        <div className="mb-2 mt-7 flex items-center justify-between">
          <h2 className="text-[16px] font-extrabold text-ink">{t("home.stories")}</h2>
          <button onClick={() => router.push("/following")} className="flex items-center gap-0.5 text-[12.5px] font-bold text-brand-600">
            {t("home.viewAll")} <Chevron className="h-4 w-4" />
          </button>
        </div>
        <div className="no-scrollbar -mx-5 flex gap-3.5 overflow-x-auto px-5 pb-1">
          {/* The "Your story +" tile was removed: this row now shows ONLY real, active
              stories — mine included, once I've posted one. Posting a story is done from
              the Create button in the bottom bar. */}
          {storyUsers.map((u) => {
            const Icon = catIcon(u.category ?? "cat.other");
            return (
              <button key={u.id} onClick={() => router.push(`/story/${u.id}`)} className="flex shrink-0 flex-col items-center gap-1.5">
                <span className="rounded-full bg-gradient-to-tr from-rose-500 via-amber-500 to-brand-500 p-[2.5px]">
                  <span className="grid place-items-center rounded-full bg-slate-50 p-[2.5px]">
                    <span className="grid h-[54px] w-[54px] place-items-center overflow-hidden rounded-full bg-brand-50">
                      {u.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : u.category ? (
                        <Icon className="h-7 w-7 text-brand-600" strokeWidth={2} />
                      ) : (
                        <span className="text-[18px] font-extrabold text-brand-600">{(u.displayName || "•").charAt(0).toUpperCase()}</span>
                      )}
                    </span>
                  </span>
                </span>
                <span className="w-16 truncate text-center text-[11px] font-bold text-ink/80">{u.displayName}</span>
              </button>
            );
          })}
        </div>

        {/* the feed — posts and reels stacked under each other */}
        <div className="mb-2 mt-7 flex items-center justify-between">
          <h2 className="text-[16px] font-extrabold text-ink">{t("home.reels")}</h2>
          <button onClick={() => router.push("/create")} className="flex items-center gap-1 rounded-full bg-brand-600 px-3 py-1.5 text-[12px] font-bold text-white active:scale-95">
            <Plus className="h-3.5 w-3.5" strokeWidth={3} /> {t("posts.add")}
          </button>
        </div>

        {posts.length === 0 ? (
          <button onClick={() => router.push("/create")} className="flex w-full flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-brand-300 bg-brand-50 py-10 text-brand-600 active:scale-[0.99]">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-600 text-white"><Plus className="h-5 w-5" strokeWidth={3} /></span>
            <span className="text-[13px] font-bold">{t("feed.emptyTitle")}</span>
          </button>
        ) : (
          <div className="-mx-5 overflow-hidden">
            {posts.map((p, i) => {
              // After every 4 posts, slot in a country-targeted ad (cycling through them).
              const showAd = feedAds.length > 0 && i > 0 && (i + 1) % 4 === 0;
              const ad = showAd ? feedAds[Math.floor((i + 1) / 4 - 1) % feedAds.length] : null;
              return (
                <div key={p.id}>
                  <PostCard
                    post={p}
                    onComments={setComments}
                    onShare={setShare}
                    onDeleted={(id) => setPosts((ps) => ps.filter((x) => x.id !== id))}
                    onToast={(m) => { setStoryToast(m); setTimeout(() => setStoryToast(null), 1800); }}
                    onOpenMedia={() => setViewerAt(i)}
                  />
                  {ad && <FeedAdCard key={`ad-${ad.id}-${i}`} ad={ad} label={t("home.sponsored")} cta={t("ads.contact")} onClick={() => router.push(`/messages/${ad.userId}`)} />}
                </div>
              );
            })}
          </div>
        )}

        {comments && (
          <CommentsSheet
            postId={comments.id}
            allowComment={comments.allowComment}
            onClose={() => setComments(null)}
            onCount={(n) => setPosts((ps) => ps.map((x) => (x.id === comments.id ? { ...x, comments: n } : x)))}
          />
        )}
        {share && <ShareSheet post={share} onClose={() => setShare(null)} onToast={(m) => { setStoryToast(m); setTimeout(() => setStoryToast(null), 1800); }} />}
        {viewerAt !== null && (
          <MediaViewer
            items={posts}
            startIndex={viewerAt}
            onClose={() => setViewerAt(null)}
            onComments={setComments}
            onShare={setShare}
            onToast={(m) => { setStoryToast(m); setTimeout(() => setStoryToast(null), 1800); }}
            onLikeChange={(id, liked, likes) =>
              setPosts((ps) => ps.map((x) => (x.id === id ? { ...x, likedByMe: liked, likes } : x)))
            }
          />
        )}
      </div>

      <CountrySheet
        open={countryOpen}
        value={browse}
        onClose={() => setCountryOpen(false)}
        onSave={async (codes) => {
          const token = getAccessToken() || undefined;
          await apiPatch("/api/auth/me", { browseCountries: codes.join(",") }, token);
          const res = await apiGet<{ user: Me }>("/api/auth/me", token);
          if (res.ok && res.data?.user) setMe(res.data.user);
        }}
      />

      <BottomNav active="home" />
    </div>
  );
}
function FeedAdCard({ ad, label, cta, onClick }: { ad: FeedAd; label: string; cta: string; onClick: () => void }) {
  return (
    <div className="mx-5 my-3 overflow-hidden rounded-3xl bg-white ring-1 ring-slate-100">
      <div className="flex items-center gap-2 px-4 pt-3">
        <Megaphone className="h-4 w-4 text-brand-600" />
        <span className="text-[12px] font-extrabold text-brand-600">{label}</span>
        <span className="ms-auto truncate text-[12px] font-bold text-muted">{ad.advertiser}</span>
      </div>
      {ad.mediaUrl && (
        ad.mediaUrl.match(/\.(mp4|webm|mov)(\?|#|$)/i) ? (
          <video src={`${ad.mediaUrl}#t=0.1`} className="mt-2.5 max-h-[420px] w-full bg-black object-contain" controls playsInline preload="metadata" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ad.mediaUrl} alt="" className="mt-2.5 max-h-[420px] w-full object-cover" />
        )
      )}
      {ad.caption && <p className="whitespace-pre-wrap px-4 pt-3 text-[13.5px] font-medium leading-relaxed text-ink">{ad.caption}</p>}
      <button onClick={onClick} className="m-4 flex w-[calc(100%-2rem)] items-center justify-center gap-1.5 rounded-2xl bg-brand-600 py-2.5 text-[13px] font-bold text-white active:scale-95">
        <Megaphone className="h-4 w-4" /> {cta}
      </button>
    </div>
  );
}
function StripCard({ icon, tint, label, onClick }: { icon: React.ReactNode; tint: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-100 active:scale-[0.97]">
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${tint}`}>{icon}</span>
      <span className="w-full truncate text-center text-[10px] font-bold text-ink">{label}</span>
    </button>
  );
}
