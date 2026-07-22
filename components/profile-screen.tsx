"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { MapPin, Crown, Link2, Camera, Settings, Pencil, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiGet, apiPatch, apiPost, apiUpload, getAccessToken } from "@/lib/api";
import BottomNav from "@/components/bottom-nav";
import { useRequireAuth } from "@/lib/use-auth";
import { getCountry } from "@/lib/countries";
import { Section } from "@/components/profile-ui";
import SocialCircles from "@/components/social-circles";

type Me = {
  id: string;
  email: string | null;
  phone: string | null;
  contactMethod: string;
  promoVideoUrl?: string | null;
  promoLinkUrl?: string | null;
  displayName: string;
  realName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  accountType: string;
  country: string | null;
  locale: string;
  visibility: string;
  showDistance: boolean;
  allowSaveMedia: boolean;
  showAddress: boolean;
  isPremium: boolean;
  isAdmin?: boolean;
  textColor: string | null;
  shareLocation: boolean;
  locationLat: number | null;
  locationLng: number | null;
  social1: string | null;
  social2: string | null;
  social3: string | null;
};

type Stats = { followers: number; following: number; profileViews: number };
type MyPost = { id: string; kind: string; mediaUrl: string };


export default function ProfileScreen() {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();

  const [me, setMe] = useState<Me | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  // (the profile-page rooms shortcut was removed per the client's list, item 9)
  const [toast, setToast] = useState<string | null>(null);
  const [bioDraft, setBioDraft] = useState<string | null>(null); // null = not editing
  const [myPosts, setMyPosts] = useState<MyPost[]>([]);
  const [hasStory, setHasStory] = useState(false);
  const avatarRef = useRef<HTMLInputElement>(null);
  const storyInputRef = useRef<HTMLInputElement>(null);
  const postInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken();
    if (!token) return;
    apiGet<{ user: Me }>("/api/auth/me", token).then((res) => {
      if (res.ok && res.data?.user) setMe(res.data.user);
    });
  }, [ready]);

  // public stats (followers / following / views)
  useEffect(() => {
    if (!me?.id) return;
    const token = getAccessToken();
    if (!token) return;
    apiGet<{ user: Stats }>(`/api/users/${me.id}`, token).then((res) => {
      if (res.ok && res.data?.user) setStats(res.data.user);
    });
    apiGet<{ stories: unknown[] }>(`/api/stories?userId=${me.id}`, token).then((res) => {
      if (res.ok && res.data?.stories) setHasStory(res.data.stories.length > 0);
    });
    apiGet<{ posts: MyPost[] }>(`/api/posts?userId=${me.id}`, token).then((res) => {
      if (res.ok && res.data?.posts) setMyPosts(res.data.posts);
    });
  }, [me?.id]);

  // Publish an image/video post right from the profile.
  async function publishPost(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const token = getAccessToken() || undefined;
    const up = await apiUpload<{ url: string }>("/api/upload", file, token);
    if (up.ok && up.data?.url) {
      const kind = file.type.startsWith("video") ? "video" : "image";
      const created = await apiPost<{ id: string }>("/api/posts", { kind, mediaUrl: up.data.url }, token);
      if (created.ok && me?.id) {
        flash(t("posts.posted"));
        const res = await apiGet<{ posts: MyPost[] }>(`/api/posts?userId=${me.id}`, token);
        if (res.ok && res.data?.posts) setMyPosts(res.data.posts);
      }
    }
    if (postInputRef.current) postInputRef.current.value = "";
  }

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  async function patch(partial: Partial<Me>) {
    const token = getAccessToken();
    if (!token) return;
    const prev = me;
    setMe((m) => (m ? { ...m, ...partial } : m)); // optimistic
    const res = await apiPatch<{ user: Me }>("/api/auth/me", partial, token);
    if (res.ok && res.data?.user) {
      setMe(res.data.user);
      flash(t("profile.saved"));
    } else {
      setMe(prev); // revert
      flash(t("common.error"));
    }
  }

  async function uploadAvatar(file: File) {
    const token = getAccessToken() || undefined;
    const up = await apiUpload<{ url: string }>("/api/upload", file, token);
    if (up.ok && up.data?.url) patch({ avatarUrl: up.data.url });
  }

  // Post a story straight from the profile (same flow as home).
  async function postStory(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const token = getAccessToken() || undefined;
    const up = await apiUpload<{ url: string }>("/api/upload", file, token);
    if (up.ok && up.data?.url) {
      const kind = file.type.startsWith("video") ? "video" : "image";
      await apiPost("/api/stories", { kind, mediaUrl: up.data.url }, getAccessToken() || undefined);
      flash(t("story.posted"));
    }
    if (storyInputRef.current) storyInputRef.current.value = "";
  }

  function toggleLocation(v: boolean) {
    if (v && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => patch({ shareLocation: true, locationLat: pos.coords.latitude, locationLng: pos.coords.longitude }),
        () => patch({ shareLocation: true })
      );
    } else {
      patch({ shareLocation: v }); // coords stay stored — they only power the distance, never shown
    }
  }

  if (!ready) return null;

  const isBusiness = me?.accountType === "business";
  const initial = (me?.displayName || "•").trim().charAt(0).toUpperCase();
  const country = getCountry(me?.country);
  const nameColor = me?.isPremium && me?.textColor ? me.textColor : undefined;

  // what others currently see about my location
  const preciseOn = !!me?.isPremium && !!me?.shareLocation;

  const socials = [me?.social1, me?.social2, me?.social3].filter(Boolean) as string[];

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      {/* header — public identity card */}
      <div className={`px-5 pb-4 pt-[calc(env(safe-area-inset-top)+10px)] ${me?.isAdmin ? "admin-header" : me?.isPremium ? "vip-header" : "bg-gradient-to-b from-brand-700 to-brand-600"}`}>
        <div className="flex items-center justify-between">
          {/* precise-location pin — premium toggles it (Google-Maps-style), free users get the upsell */}
          <button
            onClick={() => {
              if (me?.isPremium) toggleLocation(!me.shareLocation);
              else { flash(t("profile.locUpsell")); router.push("/subscribe"); }
            }}
            aria-label={t("profile.shareLocation")}
            className={`grid h-9 w-9 place-items-center rounded-full active:scale-95 ${preciseOn ? "bg-emerald-500 text-white" : "bg-white/15 text-white/70"}`}
          >
            <MapPin className="h-5 w-5" />
          </button>
          <p className="text-center text-[15px] font-extrabold text-white">{t("profile.title")}</p>
          <div className="flex items-center gap-2">
            {/* the rooms shortcut was removed per the client — rooms live only in their own tab */}
            {/* the pencil now goes straight to Settings — all account & premium edits live there */}
            <button
              onClick={() => router.push("/settings")}
              aria-label={t("profile.settings")}
              className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button onClick={() => storyInputRef.current?.click()} aria-label={t("stories.you")} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
              <Plus className="h-5 w-5" strokeWidth={2.6} />
            </button>
            <button onClick={() => router.push("/settings")} aria-label={t("profile.settings")} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </div>
        {/* premium socials — small circles tucked under the top icons */}
        {me?.isPremium && socials.length > 0 && (
          <div className="mt-1.5 flex justify-end">
            <SocialCircles links={socials} size={22} />
          </div>
        )}
        <input ref={storyInputRef} type="file" accept="image/*,video/*" hidden onChange={postStory} />
        <div className="mt-2.5 flex items-center gap-3">
          <div className={`relative shrink-0 rounded-[26px] ${hasStory ? "bg-gradient-to-tr from-amber-400 via-rose-500 to-fuchsia-600 p-[3px]" : ""}`}>
            <button
              onClick={() => (hasStory && me ? router.push(`/story/${me.id}`) : avatarRef.current?.click())}
              aria-label={hasStory ? t("merchant.viewStory") : t("profile.title")}
              className="relative grid h-14 w-14 place-items-center overflow-hidden rounded-2xl bg-white text-2xl font-extrabold text-brand-700 ring-2 ring-white"
            >
              {me?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={me.avatarUrl} alt="" className="h-14 w-14 object-cover" />
              ) : (
                initial
              )}
            </button>
            {/* change photo — always its own little button, so the avatar can open the story */}
            <button
              onClick={() => avatarRef.current?.click()}
              aria-label={t("profile.photo")}
              className="absolute -bottom-1 -end-1 grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-white ring-2 ring-white active:scale-95"
            >
              <Camera className="h-3 w-3" />
            </button>
          </div>
          <input ref={avatarRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {/* admins wear the golden name on their profile; everyone else their picked colour */}
              <p className="truncate text-[16px] font-extrabold text-white" style={me?.isAdmin ? { color: "#f3d97f" } : nameColor ? { color: nameColor } : undefined}>
                {me?.displayName || "…"}
              </p>
              {me?.isPremium && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#17193f] px-2 py-0.5 text-[10px] font-extrabold text-[#f3d97f] ring-1 ring-white/30">
                  <Crown className="h-3 w-3" /> {t("premium.badge")}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white ${me?.isPremium ? "vip-chip" : "bg-white/15"}`}>
                {isBusiness ? t("account.business.title") : t("account.personal.title")}
              </span>
              {country && (
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white ${me?.isPremium ? "vip-chip" : "bg-white/15"}`}>
                  {country.flag} {country[locale]}
                </span>
              )}
            </div>
          </div>
        </div>
        {/* stats row */}
        <div className={`mt-3 flex overflow-hidden rounded-2xl ${me?.isPremium ? "vip-panel" : "bg-white/10"}`}>
          <Stat value={stats?.followers} label={t("profile.followers")} onClick={() => router.push("/follows?tab=followers")} />
          <span className="my-2 w-px bg-white/15" />
          <Stat value={stats?.following} label={t("profile.following")} onClick={() => router.push("/follows?tab=following")} />
          <span className="my-2 w-px bg-white/15" />
          <Stat value={stats?.profileViews} label={t("profile.views")} />
        </div>

      </div>

      {/* body */}
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-4">
        {/* the admin-pinned video (sponsor / promoted accounts) with its link */}
        {me?.promoVideoUrl && (
          <div className="mb-2 overflow-hidden rounded-3xl bg-black ring-1 ring-slate-200">
            <video src={me.promoVideoUrl} controls playsInline preload="metadata" className="max-h-72 w-full" />
          </div>
        )}
        {me?.promoLinkUrl && (
          <a href={me.promoLinkUrl} target="_blank" rel="noopener noreferrer"
            className="mb-4 flex items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-3 text-[13.5px] font-bold text-white active:scale-[0.99]">
            <Link2 className="h-4 w-4" /> {t("sponsor.visit")}
          </a>
        )}

        {/* bio */}
        <Section title={t("profile.bio")}>
          {bioDraft === null ? (
            <button onClick={() => setBioDraft(me?.bio || "")} className="flex w-full items-start gap-2 py-3 text-start">
              <p className={`flex-1 text-[13.5px] leading-relaxed ${me?.bio ? "font-medium text-ink" : "text-muted"}`}>
                {me?.bio || t("profile.bioPlaceholder")}
              </p>
              <Pencil className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
            </button>
          ) : (
            <div className="py-3">
              <textarea
                autoFocus
                value={bioDraft}
                maxLength={200}
                onChange={(e) => setBioDraft(e.target.value)}
                rows={3}
                placeholder={t("profile.bioPlaceholder")}
                className="w-full resize-none rounded-xl border-2 border-brand-500 bg-white p-3 text-[13.5px] font-medium text-ink outline-none"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-muted">{bioDraft.length}/200</span>
                <div className="flex gap-3">
                  <button onClick={() => setBioDraft(null)} className="text-[12.5px] font-bold text-muted">{t("profile.cancel")}</button>
                  <button onClick={() => { patch({ bio: bioDraft.trim() || null }); setBioDraft(null); }} className="text-[12.5px] font-bold text-brand-600">{t("profile.save")}</button>
                </div>
              </div>
            </div>
          )}
        </Section>

        {/* my posts — images & videos, with create */}
        <Section title={t("merchant.posts")}>
          <div className="grid grid-cols-3 gap-2 py-3">
            <button onClick={() => router.push("/create")} className="grid aspect-square place-items-center rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50 text-brand-600 active:scale-95">
              <span className="flex flex-col items-center gap-1">
                <Plus className="h-6 w-6" strokeWidth={2.6} />
                <span className="text-[10px] font-bold">{t("posts.add")}</span>
              </span>
            </button>
            {myPosts.map((p) => (
              <button key={p.id} onClick={() => router.push(`/post/${p.id}`)} className="relative aspect-square overflow-hidden rounded-2xl bg-slate-900 active:scale-95">
                {p.kind === "video" ? (
                  <video src={p.mediaUrl} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.mediaUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                )}
              </button>
            ))}
          </div>
        </Section>
        <input ref={postInputRef} type="file" accept="image/*,video/*" hidden onChange={publishPost} />


        {/* social link boxes preview (what visitors see) */}
        {socials.length > 0 && (
          <Section title={t("profile.socials")}>
            <div className="flex flex-col gap-2 py-3">
              {socials.map((s, i) => (
                <a key={i} href={s} target="_blank" rel="noopener noreferrer" dir="ltr"
                  className="flex items-center gap-2 truncate rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] font-bold text-brand-600">
                  <Link2 className="h-4 w-4 shrink-0" /> <span className="truncate">{s}</span>
                </a>
              ))}
            </div>
          </Section>
        )}
      </div>

      {toast && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[13px] font-bold text-white shadow-lg">
          {toast}
        </motion.div>
      )}

      <BottomNav active="profile" />
    </div>
  );
}

function Stat({ value, label, onClick }: { value: number | undefined; label: string; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={`flex flex-1 flex-col items-center py-2 ${onClick ? "active:bg-white/10" : ""}`}>
      <span className="text-[16px] font-extrabold text-white">{value ?? "—"}</span>
      <span className="text-[10.5px] font-bold text-white/70">{label}</span>
    </Tag>
  );
}
