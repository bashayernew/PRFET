"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowRight,
  ArrowLeft,
  Share2,
  Star,
  MapPin,
  MessageCircle,
  UserPlus,
  UserCheck,
  Crown,
  User as UserIcon,
  Play,
  ImageIcon,
  MoreVertical,
  Flag,
  Ban,
  Link2,
  Store,
} from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { getBusiness, type Business } from "@/lib/data";
import { getCountry } from "@/lib/countries";
import { distDisplay } from "@/lib/geo";
import { catIcon } from "@/lib/cat-icons";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, apiPost, apiDelete, getAccessToken } from "@/lib/api";
import { vipStyle } from "@/lib/vip";
import MapView from "@/components/map-view";
import SocialCircles from "@/components/social-circles";

type ProfilePost = { id: string; kind: string; mediaUrl: string; caption: string | null };

type RealUser = {
  id: string;
  displayName: string;
  category: string | null;
  bio: string | null;
  rating: number | null;
  reviews: number;
  online: boolean;
  avatarUrl: string | null;
  accountType: string;
  address: string | null;
  isPremium: boolean;
  textColor: string | null;
  hasStory: boolean;
  gender: string | null;
  nationality: string | null;
  shareLocation: boolean;
  locationLat: number | null;
  locationLng: number | null;
  dist: string | null;
  social1: string | null;
  social2: string | null;
  social3: string | null;
  liveId: string | null;
  // sponsor & branches (admin-managed)
  isSponsor?: boolean;
  promoVideoUrl?: string | null;
  promoLinkUrl?: string | null;
  parent?: { id: string; name: string } | null;
  branches?: { id: string; name: string; avatarUrl: string | null }[];
};

// Build the Business-shaped view model, preferring real DB data, falling back to sample.
function buildView(id: string, real: RealUser | null, sample?: Business): Business | undefined {
  if (!real) return sample;
  return {
    id,
    ar: real.displayName,
    en: real.displayName,
    catKey: real.category ?? "cat.other",
    online: real.online,
    dist: real.dist ?? sample?.dist ?? "—",
    rating: real.rating != null ? String(real.rating) : (sample?.rating ?? "0"),
    reviews: real.reviews ?? sample?.reviews ?? 0,
    followers: sample?.followers ?? 0,
    descAr: real.bio ?? sample?.descAr ?? "",
    descEn: real.bio ?? sample?.descEn ?? "",
    addressAr: real.address ?? sample?.addressAr ?? "",
    addressEn: real.address ?? sample?.addressEn ?? "",
    phone: sample?.phone ?? "",
    openNow: real.online,
    closesAr: sample?.closesAr ?? "",
    closesEn: sample?.closesEn ?? "",
    avatarUrl: real.avatarUrl ?? sample?.avatarUrl,
    hasStory: real.hasStory ?? sample?.hasStory ?? false,
    gender: (real.gender as "male" | "female" | undefined) ?? sample?.gender,
    nationality: real.nationality ?? sample?.nationality,
    isPremium: real.isPremium,
    shareLocation: real.shareLocation,
    lat: real.locationLat ?? sample?.lat,
    lng: real.locationLng ?? sample?.lng,
  };
}

export default function MerchantScreen({ id }: { id: string }) {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();
  const [following, setFollowing] = useState(false);
  const [apiFollowers, setApiFollowers] = useState(0);
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const sample = getBusiness(id);
  const [real, setReal] = useState<RealUser | null>(null);
  const [posts, setPosts] = useState<ProfilePost[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [locHidden, setLocHidden] = useState(false);
  const [dmAllowed, setDmAllowed] = useState(false); // do I let THIS person message me?
  const [myDmClosed, setMyDmClosed] = useState(false);
  const b = useMemo(() => buildView(id, real, sample), [id, real, sample]);

  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken();
    if (!token) return;
    apiGet<{ following: boolean; followers: number }>(`/api/follow/${id}`, token).then((res) => {
      if (res.ok && res.data) {
        setFollowing(!!res.data.following);
        setApiFollowers(res.data.followers ?? 0);
      }
    });
  }, [ready, id]);

  useEffect(() => {
    // Load the real account; if it 404s (not seeded yet) we keep the sample fallback.
    // send the token so the server can count this profile view
    apiGet<{ user: RealUser }>(`/api/users/${id}`, getAccessToken() || undefined).then((res) => {
      if (res.ok && res.data?.user) setReal(res.data.user);
    });
    // their real posts
    apiGet<{ posts: ProfilePost[] }>(`/api/posts?userId=${id}`).then((res) => {
      if (res.ok && res.data?.posts) setPosts(res.data.posts);
    });
    // my privacy state toward this user
    const token = getAccessToken();
    if (token) {
      apiGet<{ blocked: boolean }>(`/api/block/${id}`, token).then((res) => {
        if (res.ok && res.data) setIsBlocked(res.data.blocked);
      });
      apiGet<{ allowed: boolean }>(`/api/dm-allow/${id}`, token).then((res) => {
        if (res.ok && res.data) setDmAllowed(res.data.allowed);
      });
      apiGet<{ user: { dmClosed: boolean } }>("/api/auth/me", token).then((res) => {
        if (res.ok && res.data?.user) setMyDmClosed(res.data.user.dmClosed);
      });
      apiGet<{ hidden: boolean }>(`/api/location-hide/${id}`, token).then((res) => {
        if (res.ok && res.data) setLocHidden(res.data.hidden);
      });
    }
  }, [id]);

  // ----- visitor menu actions -----
  async function doReport() {
    setMenuOpen(false);
    const reason = window.prompt(t("chat.reportReason"));
    if (reason === null) return;
    await apiPost("/api/report", { targetId: id, kind: "user", reason: reason.trim() || undefined }, getAccessToken() || undefined);
  }
  async function toggleBlock() {
    const token = getAccessToken() || undefined;
    setMenuOpen(false);
    if (!isBlocked) {
      const reason = window.prompt(t("chat.blockReason")) ?? "";
      setIsBlocked(true);
      await apiPost(`/api/block/${id}`, { reason: reason.trim() || undefined }, token);
    } else {
      setIsBlocked(false);
      await apiDelete(`/api/block/${id}`, token);
    }
  }
  // While my inbox is closed, this is how I open it for one person.
  async function toggleDmAllow() {
    const token = getAccessToken() || undefined;
    const next = !dmAllowed;
    setDmAllowed(next);
    setMenuOpen(false);
    if (next) await apiPost(`/api/dm-allow/${id}`, {}, token);
    else await apiDelete(`/api/dm-allow/${id}`, token);
  }

  async function toggleLocShare() {
    const token = getAccessToken() || undefined;
    const nextHidden = !locHidden;
    setLocHidden(nextHidden);
    if (nextHidden) await apiPost(`/api/location-hide/${id}`, {}, token);
    else await apiDelete(`/api/location-hide/${id}`, token);
  }
  async function shareProfile() {
    const url = `${window.location.origin}/business/${id}`;
    try {
      if (navigator.share) { await navigator.share({ title: name, url }); return; }
    } catch { /* cancelled */ }
    try { await navigator.clipboard.writeText(url); } catch { /* unavailable */ }
  }

  async function toggleFollow() {
    const token = getAccessToken() || undefined;
    const next = !following;
    setFollowing(next); // optimistic
    const res = next
      ? await apiPost<{ following: boolean; followers: number }>(`/api/follow/${id}`, {}, token)
      : await apiDelete<{ following: boolean; followers: number }>(`/api/follow/${id}`, token);
    if (res.ok && res.data) {
      setFollowing(!!res.data.following);
      setApiFollowers(res.data.followers ?? 0);
    }
  }

  if (!ready) return null;

  if (!b) {
    return (
      <div dir={dir} className="flex h-[100dvh] flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <p className="text-[15px] font-bold text-ink">{t("merchant.notFound")}</p>
        <button onClick={() => router.push("/home")} className="rounded-2xl bg-brand-600 px-6 py-3 text-sm font-bold text-white">
          {t("nav.home")}
        </button>
      </div>
    );
  }

  const Icon = catIcon(b.catKey);
  const name = locale === "ar" ? b.ar : b.en;
  const desc = locale === "ar" ? b.descAr : b.descEn;
  const followerCount = b.followers + apiFollowers;

  const premium = !!b.isPremium;
  const nat = getCountry(b.nationality);

  // precise-location pin state: silver (not subscribed) / green (on) / red (off)
  const locState: "silver" | "green" | "red" = !premium ? "silver" : b.shareLocation ? "green" : "red";
  const locClasses =
    locState === "green"
      ? "bg-emerald-500 text-white"
      : locState === "red"
      ? "bg-red-500 text-white"
      : "bg-slate-200 text-slate-400";
  const locTitle =
    locState === "green" ? t("merchant.preciseLocation") : locState === "red" ? t("merchant.locationOff") : t("merchant.premiumOnly");
  function openPreciseLocation() {
    if (locState !== "green") return;
    const q = b?.lat != null && b?.lng != null ? `${b.lat},${b.lng}` : encodeURIComponent(name);
    window.open(`https://www.google.com/maps?q=${q}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      <div className="no-scrollbar flex-1 overflow-y-auto">
        {/* ===== header — same design as your own profile: everything in the blue ===== */}
        <div className={`px-5 pb-6 pt-[calc(env(safe-area-inset-top)+12px)] ${premium ? "vip-header" : "bg-gradient-to-b from-brand-700 to-brand-600"}`}>
          <div className="flex items-center justify-between">
            <button
              onClick={() => router.back()}
              aria-label={t("back")}
              className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95"
            >
              <Back className="h-5 w-5" strokeWidth={2.4} />
            </button>
            <div className="flex items-center gap-2">
              <button onClick={shareProfile} aria-label={t("feed.share")} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
                <Share2 className="h-5 w-5" />
              </button>
              <button onClick={() => setMenuOpen((o) => !o)} aria-label={t("chat.settings")} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
                <MoreVertical className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-4">
            {/* avatar — press to view story */}
            <button
              onClick={() => b.hasStory && router.push(`/story/${b.id}`)}
              aria-label={b.hasStory ? t("merchant.viewStory") : name}
              className={`relative grid h-20 w-20 shrink-0 place-items-center rounded-3xl ${
                b.hasStory
                  ? premium
                    ? "bg-gradient-to-tr from-gold-400 to-amber-500 p-[3px]"
                    : "bg-gradient-to-tr from-brand-500 to-accent-500 p-[3px]"
                  : ""
              }`}
            >
              <span className="grid h-full w-full place-items-center overflow-hidden rounded-3xl bg-white">
                {b.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Icon className="h-8 w-8 text-brand-600" strokeWidth={2} />
                )}
              </span>
              <span className={`absolute -bottom-0.5 -end-0.5 h-4 w-4 rounded-full ring-2 ring-white ${b.online ? "bg-emerald-500" : "bg-slate-300"}`} />
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[19px] font-extrabold text-white" style={vipStyle(real)}>{name}</h1>
                {premium && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[#17193f] px-2 py-0.5 text-[10px] font-extrabold text-[#f3d97f] ring-1 ring-white/30">
                    <Crown className="h-3 w-3" />
                    {t("merchant.vip")}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {/* they're live right now — one tap drops the visitor into the room, no premium needed */}
                {real?.liveId && (
                  <button
                    onClick={() => router.push(`/meetings/${real.liveId}`)}
                    className="flex items-center gap-1 rounded-full bg-red-500 px-2.5 py-0.5 text-[11px] font-extrabold text-white shadow-md active:scale-95"
                  >
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> {t("live.badge")}
                  </button>
                )}
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white ${premium ? "vip-chip" : "bg-white/15"}`}>{t(b.catKey)}</span>
                {b.gender && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold text-white ${premium ? "vip-chip" : "bg-white/15"}`}>
                    <UserIcon className="h-3 w-3" />
                    {t(b.gender === "male" ? "register.male" : "register.female")}
                  </span>
                )}
                {nat && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold text-white ${premium ? "vip-chip" : "bg-white/15"}`}>
                    <span>{nat.flag}</span>
                    {nat[locale]}
                  </span>
                )}
              </div>
            </div>

            {/* precise-location pin */}
            <button
              onClick={openPreciseLocation}
              title={locTitle}
              aria-label={locTitle}
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full active:scale-95 ${locState === "green" ? "bg-emerald-500 text-white" : "bg-white/15 text-white/70"}`}
            >
              <MapPin className="h-5 w-5" />
            </button>
          </div>

          {/* stats — in the blue header */}
          <div className={`mt-4 flex overflow-hidden rounded-2xl ${premium ? "vip-panel" : "bg-white/10"}`}>
            <HeaderStat
              value={
                <span className="flex items-center justify-center gap-1">
                  <Star className="h-4 w-4 fill-gold-400 text-gold-400" />
                  {b.rating}
                </span>
              }
              label={`${ld(b.reviews, locale)} ${t("merchant.reviews")}`}
            />
            <span className="my-2 w-px bg-white/15" />
            <HeaderStat value={ld(followerCount, locale)} label={t("merchant.followers")} onClick={() => router.push(`/follows?user=${id}`)} />
            <span className="my-2 w-px bg-white/15" />
            <HeaderStat value={<DistValue dist={b.dist} />} label={t("merchant.distance")} />
          </div>

          {/* premium socials — small brand-coloured circles right in the header */}
          {premium && (
            <div className="mt-3">
              <SocialCircles links={[real?.social1, real?.social2, real?.social3]} size={28} />
            </div>
          )}
        </div>

        {/* precise location — a real map, only when they're premium and sharing it with me */}
        {locState === "green" && b.lat != null && b.lng != null && (
          <div className="px-5 pt-4">
            <p className="mb-2 text-[13px] font-extrabold text-ink">{t("map.location")}</p>
            <MapView lat={b.lat} lng={b.lng} name={name} />
          </div>
        )}

        {/* visitor menu — report / block / my location toward this user */}
        {menuOpen && (
          <div className="mx-5 mt-3 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
            {myDmClosed && (
              <button onClick={toggleDmAllow} className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-start text-[13.5px] font-bold text-ink active:bg-slate-50">
                <MessageCircle className={`h-5 w-5 ${dmAllowed ? "text-emerald-600" : "text-muted"}`} />
                {dmAllowed ? t("dm.revokeOne") : t("dm.allowOne")}
              </button>
            )}
            <button onClick={toggleLocShare} className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-start text-[13.5px] font-bold text-ink active:bg-slate-50">
              <MapPin className="h-4 w-4 text-brand-600" />
              <span className="flex-1">{t("merchant.shareLocWith")}</span>
              <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${!locHidden ? "bg-brand-500" : "bg-slate-300"}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${!locHidden ? "start-[22px]" : "start-0.5"}`} />
              </span>
            </button>
            <button onClick={doReport} className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-start text-[13.5px] font-bold text-amber-600 active:bg-amber-50">
              <Flag className="h-4 w-4" /> {t("chat.report")}
            </button>
            <button onClick={toggleBlock} className="flex w-full items-center gap-3 px-4 py-3 text-start text-[13.5px] font-bold text-red-600 active:bg-red-50">
              <Ban className="h-4 w-4" /> {isBlocked ? t("chat.unblock") : t("chat.block")}
            </button>
          </div>
        )}

        {/* follow + message */}
        <div className="px-5">
          <div className="mt-4 grid grid-cols-2 gap-2.5">
              <button
                onClick={toggleFollow}
                className={`flex items-center justify-center gap-1.5 rounded-2xl py-3 text-[14px] font-bold transition-colors ${
                  following
                    ? "bg-brand-50 text-brand-700"
                    : premium
                    ? "vip-btn-dark"
                    : "bg-brand-600 text-white"
                }`}
              >
                {following ? <UserCheck className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                {following ? t("merchant.following") : t("merchant.follow")}
              </button>
              <button
                onClick={() => router.push(`/messages/${b.id}`)}
                className={`flex items-center justify-center gap-1.5 rounded-2xl py-3 text-[14px] font-bold ${
                  premium ? "vip-btn-gold" : "bg-gradient-to-l from-brand-700 to-brand-500 text-white"
                }`}
              >
                <MessageCircle className="h-4 w-4" />
                {t("merchant.message")}
              </button>
            </div>
          </div>

        {/* ---- sponsor & branches (all admin-managed) ---- */}
        {real?.isSponsor && (
          <div className="mx-5 mt-4 flex items-center gap-2 rounded-2xl bg-gradient-to-l from-amber-500 to-amber-600 px-4 py-3">
            <Crown className="h-5 w-5 shrink-0 text-white" />
            <p className="text-[13.5px] font-extrabold text-white">{t("sponsor.badge")}</p>
          </div>
        )}

        {/* the branch banner — this account belongs to a main one; tap = go there */}
        {real?.parent && (
          <button onClick={() => router.push(`/business/${real.parent!.id}`)}
            className="mx-5 mt-4 flex w-[calc(100%-2.5rem)] items-center gap-2 rounded-2xl bg-brand-50 px-4 py-3 text-start ring-1 ring-brand-200 active:scale-[0.99]">
            <Store className="h-4 w-4 shrink-0 text-brand-600" />
            <p className="flex-1 text-[13px] font-bold text-brand-700">{t("sponsor.branchOf")} {real.parent.name}</p>
          </button>
        )}

        {/* the pinned video, with its link right underneath */}
        {real?.promoVideoUrl && (
          <div className="mx-5 mt-4 overflow-hidden rounded-3xl bg-black ring-1 ring-slate-200">
            <video src={real.promoVideoUrl} controls playsInline preload="metadata" className="max-h-72 w-full" />
          </div>
        )}
        {real?.promoLinkUrl && (
          <a href={real.promoLinkUrl} target="_blank" rel="noopener noreferrer"
            className="mx-5 mt-2 flex items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-3 text-[13.5px] font-bold text-white active:scale-[0.99]">
            <Link2 className="h-4 w-4" /> {t("sponsor.visit")}
          </a>
        )}

        {/* branches of this account */}
        {!!real?.branches?.length && (
          <div className="mx-5 mt-4">
            <p className="mb-2 text-[13px] font-extrabold text-ink">{t("sponsor.branches")}</p>
            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              {real.branches.map((br) => (
                <button key={br.id} onClick={() => router.push(`/business/${br.id}`)}
                  className="flex shrink-0 items-center gap-2 rounded-2xl bg-white px-3 py-2 ring-1 ring-slate-200 active:scale-95">
                  {br.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={br.avatarUrl} alt="" className="h-7 w-7 rounded-lg object-cover" />
                  ) : (
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-[12px] font-extrabold text-brand-600">{br.name.charAt(0)}</span>
                  )}
                  <span className="text-[12.5px] font-bold text-ink">{br.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* about */}
        <Section title={t("merchant.about")}>
          <p className="text-[13.5px] leading-relaxed text-ink/80">{desc}</p>
        </Section>

        {/* posts — their real posts */}
        <div className="mt-5 px-5">
          <h2 className="mb-2 text-[15px] font-extrabold text-ink">{t("merchant.posts")}</h2>
          {posts.length === 0 ? (
            <div className="grid place-items-center rounded-2xl bg-white py-8 ring-1 ring-slate-100">
              <ImageIcon className="h-7 w-7 text-slate-300" />
              <p className="mt-1 text-[12px] font-bold text-muted">{t("merchant.noPosts")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {posts.map((p) => (
                <button key={p.id} onClick={() => router.push(`/post/${p.id}`)} className="relative aspect-square overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-slate-100 active:scale-95">
                  {p.kind === "video" ? (
                    <>
                      <video src={p.mediaUrl} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" />
                      <span className="absolute inset-0 grid place-items-center"><Play className="h-7 w-7 fill-white text-white drop-shadow" /></span>
                      <span className="absolute bottom-1.5 start-1.5 rounded-md bg-black/40 px-1.5 py-0.5 text-[9px] font-bold text-white">{t("merchant.video")}</span>
                    </>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.mediaUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="h-6" />
      </div>
    </div>
  );
}

/** Distance for the header stat — metres when close, km when far. */
function DistValue({ dist }: { dist: string | null }) {
  const { t, locale } = useI18n();
  if (!dist || dist === "—") return <>—</>;
  const d = distDisplay(dist);
  return <>{ld(d.value, locale)} {t(d.unit)}</>;
}

function HeaderStat({ value, label, onClick }: { value: React.ReactNode; label: string; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={`flex flex-1 flex-col items-center py-2.5 ${onClick ? "active:scale-95" : ""}`}>
      <div className="text-[15px] font-extrabold text-white">{value}</div>
      <div className="text-[10.5px] font-bold text-white/70">{label}</div>
    </Tag>
  );
}
function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 py-2.5 text-center">
      <div className="text-[15px] font-extrabold text-ink">{value}</div>
      <div className="mt-0.5 text-[11px] font-medium text-muted">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 px-5">
      <h2 className="mb-2 text-[15px] font-extrabold text-ink">{title}</h2>
      <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">{children}</div>
    </div>
  );
}
