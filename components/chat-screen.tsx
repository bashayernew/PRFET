"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import ImageZoom from "@/components/image-zoom";
import {
  ArrowRight,
  ArrowLeft,
  Phone,
  MoreVertical,
  Plus,
  Send,
  Mic,
  Square,
  ImageIcon,
  Video,
  Camera,
  Video as VideoIcon,
  Film,
  MapPin,
  X,
  BookmarkMinus,
  Eye,
  EyeOff,
  Flag,
  Ban,
  ShieldAlert,
  Loader2,
  Crown,
} from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { getBusiness } from "@/lib/data";
import { catIcon } from "@/lib/cat-icons";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, apiPost, apiPatch, apiDelete, apiUpload, getAccessToken } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { setSecureScreen } from "@/lib/secure-screen";
import CallOverlay from "@/components/call-overlay";
import { vipBubble, vipStyle } from "@/lib/vip";
import type { FeedPost } from "@/lib/posts";

type Kind = "text" | "image" | "voice" | "video" | "location" | "gift" | "call";
type Msg = { id: string; body: string; mine: boolean; at: string; kind: Kind; mediaUrl?: string | null; system?: boolean; deleted?: boolean; viewOnce?: boolean; expired?: boolean; allowSave?: boolean };
type ApiMsg = { id: string; fromMe: boolean; body: string; kind: Kind; mediaUrl?: string | null; createdAt: string; deleted?: boolean; viewOnce?: boolean; expired?: boolean; allowSave?: boolean };

function fmtTime(iso: string, locale: "ar" | "en") {
  const d = new Date(iso);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return ld(`${hh}:${mm}`, locale);
}

export default function ChatScreen({ id }: { id: string }) {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  const c = getBusiness(id);
  const [peer, setPeer] = useState<{ displayName: string; online: boolean; category: string | null; avatarUrl: string | null; isPremium?: boolean; textColor?: string | null; canMessage?: boolean } | null>(null);
  const [meVip, setMeVip] = useState<{ isPremium?: boolean; textColor?: string | null } | null>(null);

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);

  /**
   * Arriving from "contact advertiser" on a home-feed ad (/messages/<id>?ad=<adId>).
   * Loads that ad and drops it into the composer — NOT sent, so the person can add their
   * own question first. Read off window.location rather than useSearchParams(), which
   * would force this whole page into a Suspense boundary for a one-shot read.
   */
  const adPrefilled = useRef(false);
  useEffect(() => {
    if (adPrefilled.current) return;
    const adId = new URLSearchParams(window.location.search).get("ad");
    if (!adId) return;
    adPrefilled.current = true;
    (async () => {
      const res = await apiGet<{ ad?: { caption: string | null; mediaUrl: string | null } }>(
        `/api/ads/${adId}`,
        getAccessToken() || undefined
      );
      const ad = res.ok ? res.data?.ad : null;
      const lines = [t("ads.enquiryIntro")];
      if (ad?.caption?.trim()) lines.push(`"${ad.caption.trim()}"`);
      if (ad?.mediaUrl) lines.push(`${window.location.origin}${ad.mediaUrl}`);
      setText(lines.join("\n"));
      // Drop the query string so a refresh doesn't re-fill an already-edited box.
      window.history.replaceState({}, "", `/messages/${id}`);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [attachOpen, setAttachOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  const [giftTier, setGiftTier] = useState<"basic" | "vip">("basic"); // gift Golden or VIP (1 month)
  const [giftPrices, setGiftPrices] = useState({ basic: 5.99, vip: 10.99 }); // live from the dashboard
  const [gifting, setGifting] = useState(false);

  // chat settings
  const [saveMedia, setSaveMedia] = useState(false);
  const [keepAfterView, setKeepAfterView] = useState(true); // off => view-once + screenshot block
  const [blocked, setBlocked] = useState(false);
  const [livePresence, setLivePresence] = useState<boolean | null>(null);
  const [call, setCall] = useState<{ incomingOffer: unknown | null } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // voice recording
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);
  const pendingKind = useRef<Kind>("image");
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    const res = await apiGet<{ messages: ApiMsg[] }>(`/api/conversations/${id}`, token);
    if (res.ok && res.data?.messages) {
      setMsgs(res.data.messages.map((m) => ({ id: m.id, body: m.body, mine: m.fromMe, at: m.createdAt, kind: m.kind, mediaUrl: m.mediaUrl, deleted: m.deleted, viewOnce: m.viewOnce, expired: m.expired, allowSave: m.allowSave })));
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  useEffect(() => {
    apiGet<{ user: { displayName: string; online: boolean; category: string | null; avatarUrl: string | null; isPremium?: boolean; textColor?: string | null; canMessage?: boolean } }>(`/api/users/${id}`, getAccessToken() || undefined).then((res) => {
      if (res.ok && res.data?.user) setPeer(res.data.user);
    });
    // live Golden/VIP prices for the gift sheet (dashboard-driven)
    fetch("/api/settings").then((r) => r.json()).then((d) => {
      const s = d?.settings ?? {};
      setGiftPrices({
        basic: typeof s.priceSubscription === "number" ? s.priceSubscription : 5.99,
        vip: typeof s.priceVip === "number" ? s.priceVip : 10.99,
      });
    }).catch(() => {});
    const token = getAccessToken();
    if (token) apiGet<{ blocked: boolean }>(`/api/block/${id}`, token).then((res) => {
      if (res.ok && res.data) setBlocked(res.data.blocked);
    });
    // load my persisted media preferences
    if (token) apiGet<{ user: { allowSaveMedia: boolean; deleteMediaAfterView: boolean; isPremium?: boolean; textColor?: string | null } }>("/api/auth/me", token).then((res) => {
      if (res.ok && res.data?.user) {
        setSaveMedia(res.data.user.allowSaveMedia);
        setKeepAfterView(!res.data.user.deleteMediaAfterView);
        setMeVip({ isPremium: res.data.user.isPremium, textColor: res.data.user.textColor });
      }
    });
  }, [id]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    let s: { on: (e: string, cb: (p: unknown) => void) => void; off: (e: string) => void } | null = null;
    let mounted = true;
    (async () => {
      const sock = await getSocket(token);
      if (!mounted) return;
      s = sock;
      sock.on("message:new", (p: { from?: string; message?: { id: string; body: string; kind: Kind; mediaUrl?: string | null; viewOnce?: boolean; allowSave?: boolean; createdAt: string } }) => {
        if (p?.from === id && p?.message) {
          setMsgs((m) => [...m, { id: p.message!.id, body: p.message!.body, mine: false, at: p.message!.createdAt, kind: p.message!.kind, mediaUrl: p.message!.mediaUrl, viewOnce: p.message!.viewOnce, allowSave: p.message!.allowSave }]);
        }
      });
      sock.on("message:deleted", (p: { id?: string }) => {
        if (p?.id) setMsgs((m) => m.map((x) => (x.id === p.id ? { ...x, deleted: true, body: "", mediaUrl: null } : x)));
      });
      sock.on("presence:update", (p: { userId?: string; online?: boolean }) => {
        if (p?.userId === id) setLivePresence(!!p.online);
      });
    })();
    return () => { mounted = false; if (s) { s.off("message:new"); s.off("message:deleted"); s.off("presence:update"); } };
  }, [id]);

  // Pay this person's subscription, from inside our chat.
  async function payForThem() {
    if (gifting) return;
    setGifting(true);
    const res = await apiPost<{ ok: boolean; amount: number }>(
      "/api/subscribe/gift",
      { peerId: id, tier: giftTier },
      getAccessToken() || undefined
    );
    setGifting(false);
    setGiftOpen(false);
    if (res.ok) { showToast(t("gift.done")); load(); }
    else showToast(t("common.error"));
  }

  async function toggleBlock() {
    const token = getAccessToken() || undefined;
    const next = !blocked;
    setSettingsOpen(false);
    if (next) {
      // Ask why — stored for the moderation dashboard.
      const reason = window.prompt(t("chat.blockReason")) ?? "";
      setBlocked(true);
      showToast(t("chat.blocked"));
      await apiPost(`/api/block/${id}`, { reason: reason.trim() || undefined }, token);
    } else {
      setBlocked(false);
      showToast(t("chat.unblocked"));
      await apiDelete(`/api/block/${id}`, token);
    }
  }

  async function doReport() {
    const token = getAccessToken() || undefined;
    setSettingsOpen(false);
    const reason = window.prompt(t("chat.reportReason"));
    if (reason === null) return; // cancelled
    showToast(t("chat.reported"));
    // Attach the peer's last message as evidence, so the admin can SEE what was said.
    const lastPeerMsg = [...msgs].reverse().find((m) => !m.mine && !m.deleted);
    await apiPost(
      "/api/report",
      lastPeerMsg
        ? { targetId: lastPeerMsg.id, kind: "message", reason: reason.trim() || undefined }
        : { targetId: id, kind: "user", reason: reason.trim() || undefined },
      token
    );
  }

  /**
   * View-once: reveal the media, tell the server it's consumed, then take it away again.
   *
   * The server already marks it expired, but that only takes effect on the NEXT load — so
   * opening a view-once photo used to leave it sitting in the thread for as long as the chat
   * stayed open. "View once" that you can stare at indefinitely isn't view once, and it's
   * the behaviour the client reported.
   *
   * VIEW_SECONDS is the window; after it the message collapses to the same "expired" pill a
   * reload would show, and it can't be reopened.
   */
  const VIEW_SECONDS = 15;
  const [openedOnce, setOpenedOnce] = useState<Set<string>>(new Set());
  const [hiddenOnce, setHiddenOnce] = useState<Set<string>>(new Set());
  const hideTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  function hideOnce(msgId: string) {
    setHiddenOnce((s) => new Set(s).add(msgId));
    const tm = hideTimers.current.get(msgId);
    if (tm) { clearTimeout(tm); hideTimers.current.delete(msgId); }
  }

  function openOnce(msgId: string) {
    if (hiddenOnce.has(msgId)) return; // already consumed in this session
    setOpenedOnce((s) => new Set(s).add(msgId));
    apiPost(`/api/messages/${msgId}/viewed`, {}, getAccessToken() || undefined);
    hideTimers.current.set(msgId, setTimeout(() => hideOnce(msgId), VIEW_SECONDS * 1000));
  }

  // Leaving the chat consumes anything still on screen — otherwise a pending timer is lost
  // on unmount and the photo would be revealed again by the next render.
  useEffect(() => {
    const timers = hideTimers.current;
    return () => { timers.forEach((tm) => clearTimeout(tm)); timers.clear(); };
  }, []);

  // Persisted chat media settings.
  function toggleSaveMedia() {
    const v = !saveMedia;
    setSaveMedia(v);
    apiPatch("/api/auth/me", { allowSaveMedia: v }, getAccessToken() || undefined);
  }
  function toggleKeepAfterView() {
    const v = !keepAfterView;
    setKeepAfterView(v);
    apiPatch("/api/auth/me", { deleteMediaAfterView: !v }, getAccessToken() || undefined);
  }

  // Delete one of my own messages (for both sides). Long-press / right-click the bubble.
  async function deleteMessage(msgId: string) {
    if (!window.confirm(t("chat.deleteConfirm"))) return;
    const token = getAccessToken() || undefined;
    setMsgs((m) => m.map((x) => (x.id === msgId ? { ...x, deleted: true, body: "", mediaUrl: null } : x)));
    await apiDelete(`/api/messages/${msgId}`, token);
  }

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  function pushSystem(body: string) {
    setMsgs((m) => [...m, { id: `sys-${Date.now()}`, body, mine: false, at: new Date().toISOString(), kind: "text", system: true }]);
  }

  // Best-effort screenshot-attempt detection when view-once is active (web can't truly block).
  useEffect(() => {
    if (keepAfterView) return;
    function onKey(e: KeyboardEvent) {
      const combo = e.key === "PrintScreen" || ((e.metaKey || e.ctrlKey) && e.shiftKey && ["s", "S", "3", "4", "5"].includes(e.key));
      if (combo) pushSystem(t("chat.screenshotAlert"));
    }
    window.addEventListener("keyup", onKey);
    return () => window.removeEventListener("keyup", onKey);
  }, [keepAfterView, t]);

  // Native screenshot blocking (Android FLAG_SECURE) while view-once mode is active.
  useEffect(() => {
    setSecureScreen(!keepAfterView);
    return () => { setSecureScreen(false); };
  }, [keepAfterView]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  }

  async function sendBody(body: string, kind: Kind = "text", mediaUrl?: string) {
    if (!body || sending || blocked) return;
    const temp: Msg = { id: `tmp-${Date.now()}`, body, mine: true, at: new Date().toISOString(), kind, mediaUrl };
    setMsgs((m) => [...m, temp]);
    setSending(true);
    const token = getAccessToken();
    const res = await apiPost<{ message: ApiMsg; error?: string }>(`/api/conversations/${id}`, { body, kind, mediaUrl, viewOnce: !keepAfterView, allowSave: saveMedia }, token || undefined);
    if (res.ok && res.data?.message) {
      const real = res.data.message;
      setMsgs((m) => m.map((x) => (x.id === temp.id ? { id: real.id, body: real.body, mine: real.fromMe, at: real.createdAt, kind: real.kind, mediaUrl: real.mediaUrl } : x)));
    } else {
      // the message didn't go — take the bubble back and say why
      setMsgs((m) => m.filter((x) => x.id !== temp.id));
      if (res.data?.error === "dm_closed") { setPeer((p) => (p ? { ...p, canMessage: false } : p)); showToast(t("dm.peerClosed")); }
      else if (res.data?.error === "blocked") showToast(t("chat.blocked"));
      else showToast(t("common.error"));
    }
    setSending(false);
  }

  async function send() {
    const v = text.trim();
    if (!v) return;
    setText("");
    await sendBody(v, "text");
  }

  /**
   * Attach media.
   *
   * `source` decides where it comes from. The `capture` attribute asks the phone to open the
   * camera directly instead of the gallery — it is set per use and REMOVED for gallery picks,
   * because leaving it on makes some Android builds refuse to offer the gallery at all.
   *
   * Desktop browsers ignore `capture` and just show the file dialog, so the camera tiles
   * degrade harmlessly on the web.
   */
  function pickFile(kind: "image" | "video", source: "gallery" | "camera" = "gallery") {
    setAttachOpen(false);
    pendingKind.current = kind;
    const el = fileRef.current;
    if (!el) return;
    el.accept = kind === "image" ? "image/*" : "video/*";
    if (source === "camera") {
      // "environment" = rear camera; the user can still flip once it opens.
      el.setAttribute("capture", "environment");
    } else {
      el.removeAttribute("capture");
    }
    el.value = "";
    el.click();
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const token = getAccessToken() || undefined;
    setUploading(true);
    const res = await apiUpload<{ url: string }>("/api/upload", file, token);
    setUploading(false);
    if (res.ok && res.data?.url) {
      const kind = pendingKind.current;
      const once = !keepAfterView ? ` ${t("chat.onceTag")}` : "";
      await sendBody(`${kind === "image" ? "📷" : "🎥"} ${file.name}${once}`, kind, res.data.url);
    } else {
      showToast(t("common.error"));
    }
  }

  function shareLocation() {
    setAttachOpen(false);
    if (typeof navigator === "undefined" || !navigator.geolocation) { showToast(t("chat.locUnsupported")); return; }
    showToast(t("chat.locFinding"));
    navigator.geolocation.getCurrentPosition(
      (pos) => sendBody(`${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`, "location"),
      (err) => showToast(err.code === err.PERMISSION_DENIED ? t("chat.locDenied") : t("chat.locFailed")),
      // without a timeout the phone can sit there forever and nothing is ever sent
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }

  // Voice note via MediaRecorder.
  // Every phone records a different format (iPhone = mp4/aac, Android = webm/opus), so we
  // record in whatever the device supports and let the server convert it to .m4a — the one
  // format both iPhone and Android can play.
  async function toggleRecord() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      showToast(t("chat.micUnsupported"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Pick a container this browser can actually produce.
      const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
      const mime = candidates.find((m) => MediaRecorder.isTypeSupported?.(m)) || "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);

      chunksRef.current = [];
      rec.ondataavailable = (ev) => ev.data.size > 0 && chunksRef.current.push(ev.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setRecording(false);
        const type = rec.mimeType || mime || "audio/webm";
        if (!chunksRef.current.length) { showToast(t("common.error")); return; }
        const blob = new Blob(chunksRef.current, { type });
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type });
        const token = getAccessToken() || undefined;
        setUploading(true);
        const res = await apiUpload<{ url: string }>("/api/upload", file, token);
        setUploading(false);
        if (res.ok && res.data?.url) await sendBody(`🎤 ${t("chat.audio")}`, "voice", res.data.url);
        else showToast(t("common.error"));
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      showToast(t("chat.micDenied"));
    }
  }

  if (!ready) return null;

  if (!c && !peer) {
    return (
      <div dir={dir} className="flex h-[100dvh] flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <p className="text-[15px] font-bold text-ink">{t("merchant.notFound")}</p>
        <button onClick={() => router.push("/messages")} className="rounded-2xl bg-brand-600 px-6 py-3 text-sm font-bold text-white">
          {t("messages.title")}
        </button>
      </div>
    );
  }

  const Icon = catIcon(peer?.category ?? c?.catKey ?? "cat.other");
  const name = peer?.displayName ?? (c ? (locale === "ar" ? c.ar : c.en) : "");
  const online = livePresence ?? peer?.online ?? c?.online ?? false;
  const avatarUrl = peer?.avatarUrl ?? c?.avatarUrl ?? null;

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      <input ref={fileRef} type="file" hidden onChange={onFilePicked} />

      {/* header */}
      <div className="flex items-center gap-3 border-b border-slate-100 bg-white px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)]">
        <button onClick={() => router.push("/messages")} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full text-ink active:scale-95">
          <Back className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <button onClick={() => setSettingsOpen(true)} aria-label={t("chat.settings")} className="grid h-9 w-9 place-items-center rounded-full text-muted active:scale-95">
          <MoreVertical className="h-5 w-5" />
        </button>
        <button onClick={() => router.push(`/business/${id}`)} className="min-w-0 flex-1 text-center">
          <p className="truncate text-[15px] font-extrabold text-ink" style={vipStyle(peer)}>{name}</p>
          {online && <p className="text-[11.5px] font-medium text-emerald-600">{t("messages.online")}</p>}
        </button>
        <button onClick={() => setCall({ incomingOffer: null })} aria-label={t("chat.call")} className="grid h-9 w-9 place-items-center rounded-full text-brand-600 active:scale-95">
          <Phone className="h-5 w-5" />
        </button>
        <button onClick={() => router.push(`/business/${id}`)} aria-label={name} className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-brand-50 active:scale-95">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-10 w-10 object-cover" />
          ) : (
            <Icon className="h-5 w-5 text-brand-600" strokeWidth={2} />
          )}
          {online && <span className="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white" />}
        </button>
      </div>

      {/* messages */}
      <div className="no-scrollbar flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-4">
        {!loading && msgs.length === 0 && (
          <div className="m-auto flex flex-col items-center gap-1.5 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-400"><Send className="h-6 w-6" /></span>
            <p className="text-[14px] font-extrabold text-ink">{t("chat.empty")}</p>
            <p className="max-w-[220px] text-[12px] text-muted">{t("chat.emptyHint")}</p>
          </div>
        )}
        {msgs.map((m) =>
          m.system ? (
            <div key={m.id} className="mx-auto flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-[11.5px] font-bold text-amber-700 ring-1 ring-amber-100">
              <ShieldAlert className="h-3.5 w-3.5" /> {m.body}
            </div>
          ) : (
            (() => {
              // a subscriber's messages are written in their own colour — both sides see it
              const vip = m.mine ? vipBubble(meVip) : vipBubble(peer);
              return (
                <div
                  key={m.id}
                  onContextMenu={(e) => { if (m.mine && !m.deleted) { e.preventDefault(); deleteMessage(m.id); } }}
                  style={vip}
                  className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 ${
                    vip
                      ? m.mine ? "self-end rounded-br-md" : "self-start rounded-bl-md"
                      : m.mine ? "self-end rounded-br-md bg-brand-600 text-white" : "self-start rounded-bl-md bg-white text-ink shadow-sm ring-1 ring-slate-100"
                  } ${m.deleted ? "opacity-70" : ""}`}
                >
                  {m.deleted ? (
                    <p className={`text-[13px] italic ${vip ? "opacity-70" : m.mine ? "text-brand-100" : "text-muted"}`}>{t("chat.deletedMsg")}</p>
                  ) : (
                    <MessageBody
                      m={m}
                      t={t}
                      opened={openedOnce.has(m.id) && !hiddenOnce.has(m.id)}
                      consumed={hiddenOnce.has(m.id)}
                      onOpenOnce={() => openOnce(m.id)}
                    />
                  )}
                  <p className={`mt-1 text-[10px] ${vip ? "opacity-60" : m.mine ? "text-brand-100" : "text-muted"}`} dir="ltr">{fmtTime(m.at, locale)}</p>
                </div>
              );
            })()
          )
        )}
        <div ref={endRef} />
      </div>

      {blocked && (
        <div className="mx-4 mb-2 flex items-center justify-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-[12px] font-bold text-red-600">
          <Ban className="h-4 w-4" /> {t("chat.blockedBanner")}
        </div>
      )}

      {/* their inbox is closed and I'm not on their list */}
      {peer && peer.canMessage === false && !blocked && (
        <div className="mx-4 mb-2 flex items-center justify-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-center text-[12px] font-bold text-amber-700">
          <Ban className="h-4 w-4 shrink-0" /> {t("dm.peerClosed")}
        </div>
      )}

      {/* input */}
      <div className={`shrink-0 border-t border-slate-100 bg-white px-3 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2.5 ${peer?.canMessage === false ? "pointer-events-none opacity-50" : ""}`}>
        {!keepAfterView && (
          <div className="mx-1 mb-1.5 flex items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-[11.5px] font-medium text-brand-700">
            <Eye className="h-3.5 w-3.5" /> {t("chat.onceHint")}
          </div>
        )}
        {recording && (
          <div className="mx-1 mb-1.5 flex items-center gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11.5px] font-bold text-red-600">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> {t("chat.recording")}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button onClick={() => setAttachOpen(true)} aria-label={t("chat.attach")} disabled={uploading} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-brand-600 active:scale-95">
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={t("messages.typeholder")}
            className="h-11 flex-1 rounded-full bg-slate-100 px-4 text-[14px] font-medium text-ink outline-none placeholder:font-normal placeholder:text-muted focus:bg-slate-50"
          />
          {text.trim() ? (
            <button onClick={send} disabled={sending} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
              <Send className={`h-5 w-5 ${dir === "rtl" ? "-scale-x-100" : ""}`} />
            </button>
          ) : (
            <button onClick={toggleRecord} aria-label={t("chat.audio")} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-white active:scale-95 ${recording ? "bg-red-500" : "bg-brand-600"}`}>
              {recording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
          )}
        </div>
      </div>

      {/* toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} className="pointer-events-none fixed inset-x-0 bottom-24 z-50 mx-auto max-w-[320px] rounded-2xl bg-ink px-4 py-2.5 text-center text-[13px] font-bold text-white">
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* attach sheet */}
      <Sheet open={attachOpen} onClose={() => setAttachOpen(false)} dir={dir} title={t("chat.attach")}>
        <div className="grid grid-cols-3 gap-3">
          {/* Camera first — taking a photo or clip is the common case in a chat. */}
          <AttachTile icon={<Camera className="h-6 w-6" />} label={t("chat.takePhoto")} tint="bg-brand-50 text-brand-600" onClick={() => pickFile("image", "camera")} />
          <AttachTile icon={<VideoIcon className="h-6 w-6" />} label={t("chat.recordVideo")} tint="bg-rose-50 text-rose-600" onClick={() => pickFile("video", "camera")} />
          <AttachTile icon={<MapPin className="h-6 w-6" />} label={t("chat.attachLocation")} tint="bg-emerald-50 text-emerald-600" onClick={shareLocation} />
          <AttachTile icon={<ImageIcon className="h-6 w-6" />} label={t("chat.attachImage")} tint="bg-slate-100 text-slate-600" onClick={() => pickFile("image")} />
          <AttachTile icon={<Film className="h-6 w-6" />} label={t("chat.attachVideo")} tint="bg-slate-100 text-slate-600" onClick={() => pickFile("video")} />
        </div>
      </Sheet>

      {/* chat settings sheet */}
      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} dir={dir} title={t("chat.settings")}>
        <ToggleRow icon={<BookmarkMinus className="h-5 w-5" />} label={t("chat.saveMedia")} on={saveMedia} onClick={toggleSaveMedia} />
        <ToggleRow icon={<Eye className="h-5 w-5" />} label={t("chat.keepAfterView")} hint={t("chat.keepAfterViewHint")} on={keepAfterView} onClick={toggleKeepAfterView} />
        <button
          onClick={() => { setSettingsOpen(false); setGiftOpen(true); }}
          className="mt-1 flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-start text-[14px] font-bold text-amber-700 active:bg-amber-50"
        >
          <Crown className="h-5 w-5" /> {t("gift.action")}
        </button>
        <button onClick={doReport} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-start text-[14px] font-bold text-amber-600 active:bg-amber-50">
          <Flag className="h-5 w-5" /> {t("chat.report")}
        </button>
        <button onClick={toggleBlock} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-start text-[14px] font-bold text-red-600 active:bg-red-50">
          <Ban className="h-5 w-5" /> {blocked ? t("chat.unblock") : t("chat.block")}
        </button>
      </Sheet>

      {/* pay for their subscription */}
      <Sheet open={giftOpen} onClose={() => setGiftOpen(false)} dir={dir} title={t("gift.title")}>
        <p className="mb-3 text-[13px] font-medium leading-relaxed text-muted">
          {t("gift.hint").replace("{name}", name)}
        </p>

        <div className="mb-3 flex gap-2">
          {(["basic", "vip"] as const).map((tv) => (
            <button
              key={tv}
              onClick={() => setGiftTier(tv)}
              className={`flex-1 rounded-2xl py-2.5 text-[13px] font-bold transition-colors ${giftTier === tv ? "bg-brand-600 text-white" : "bg-slate-100 text-muted"}`}
            >
              {t(tv === "vip" ? "premium.vipName" : "premium.goldName")}
            </button>
          ))}
        </div>

        <div className="mb-4 flex items-center justify-between rounded-2xl bg-amber-50 px-4 py-3">
          <span className="text-[13px] font-bold text-amber-800">{t("gift.total")}</span>
          <span dir="ltr" className="text-[17px] font-extrabold text-amber-900">${giftTier === "vip" ? giftPrices.vip : giftPrices.basic}</span>
        </div>

        <button
          onClick={payForThem}
          disabled={gifting}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-amber-500 to-amber-600 text-[15px] font-extrabold text-white disabled:opacity-50 active:scale-[0.99]"
        >
          <Crown className="h-4 w-4" /> {gifting ? t("common.loading") : t("gift.pay")}
        </button>
        <p className="mt-2 text-center text-[11.5px] font-medium text-muted">{t("gift.stackHint")}</p>
      </Sheet>

      {call && <CallOverlay peerId={id} peerName={name} incomingOffer={call.incomingOffer} onEnd={() => setCall(null)} />}
    </div>
  );
}

// A chat image that opens the full-screen pinch-zoom lightbox on tap (fix #13).
function ChatImage({ src, noSave }: { src: string; noSave: boolean }) {
  const [zoom, setZoom] = useState(false);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        onClick={() => setZoom(true)}
        draggable={!noSave}
        onContextMenu={noSave ? (e) => e.preventDefault() : undefined}
        className="max-h-64 w-full cursor-zoom-in rounded-xl object-cover"
      />
      {zoom && <ImageZoom src={src} onClose={() => setZoom(false)} />}
    </>
  );
}

function MessageBody({ m, t, opened, consumed, onOpenOnce }: { m: Msg; t: (k: string) => string; opened?: boolean; consumed?: boolean; onOpenOnce?: () => void }) {
  const isMedia = (m.kind === "image" || m.kind === "video" || m.kind === "voice");

  // A finished call, shown the way a phone's call history does. `body` is the duration
  // in seconds; 0 means it never connected (declined or unanswered).
  if (m.kind === "call") {
    const secs = parseInt(m.body || "0", 10) || 0;
    const mm = Math.floor(secs / 60);
    const ss = secs % 60;
    const label = secs > 0
      ? `${t(m.mine ? "call.outgoing" : "call.incoming2")} · ${mm}:${String(ss).padStart(2, "0")}`
      : t(m.mine ? "call.noAnswer" : "call.missed");
    return (
      <p className={`flex items-center gap-2 text-[13.5px] font-bold ${secs > 0 ? "" : "text-red-500"}`}>
        <Phone className="h-4 w-4" /> {label}
      </p>
    );
  }

  // View-once handling for RECEIVED media.
  if (isMedia && m.viewOnce && !m.mine) {
    // `consumed` = watched here a moment ago and the viewing window closed.
    // `m.expired` = the server already recorded it as viewed (so, a later visit).
    if (consumed || (m.expired && !opened)) {
      return (
        <p className="flex items-center gap-1.5 text-[13px] italic text-muted">
          <EyeOff className="h-4 w-4" /> {t("chat.expiredMedia")}
        </p>
      );
    }
    if (!opened && m.mediaUrl) {
      return (
        <button onClick={onOpenOnce} className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-3 text-[13.5px] font-bold text-brand-700 active:scale-95">
          <Eye className="h-4 w-4" /> {t("chat.tapToView")}
        </button>
      );
    }
  }

  // When the sender disabled saving, make downloading harder (no download controls / drag / context menu).
  const noSave = !m.mine && m.allowSave === false;

  if (m.kind === "image" && m.mediaUrl) {
    return <ChatImage src={m.mediaUrl} noSave={noSave} />;
  }
  if (m.kind === "video" && m.mediaUrl) {
    return <video src={m.mediaUrl} controls controlsList={noSave ? "nodownload" : undefined} className="max-h-64 w-full rounded-xl" />;
  }
  if (m.kind === "voice" && m.mediaUrl) {
    return <audio src={m.mediaUrl} controls controlsList={noSave ? "nodownload" : undefined} className="w-52" />;
  }
  if (m.kind === "location") {
    const href = `https://www.google.com/maps?q=${encodeURIComponent(m.body)}`;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[14px] font-bold underline">
        <MapPin className="h-4 w-4" /> {t("chat.attachLocation")}
      </a>
    );
  }
  if (m.kind === "gift") {
    return (
      <span className="flex items-center gap-2 rounded-xl bg-amber-100 px-3 py-2 text-[13px] font-extrabold text-amber-900">
        <Crown className="h-4 w-4" /> {t("gift.bubble")}
      </span>
    );
  }

  // A shared post arrives as text with a /post/<id> link — show the actual post instead.
  const shared = /\/post\/([a-z0-9]+)/i.exec(m.body);
  if (shared) {
    const note = m.body.replace(/https?:\/\/\S*\/post\/[a-z0-9]+/i, "").trim();
    return <SharedPost id={shared[1]} note={note} t={t} />;
  }

  return <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{linkify(m.body)}</p>;
}

/**
 * Turn URLs and in-app paths inside message text into tappable links.
 *
 * Broadcasts can carry a link — a member's profile, an ad, or an external site — and
 * without this it arrived as plain text the reader had to copy by hand.
 *
 * In-app paths (`/business/<id>`, `/ad/<id>`, …) are matched as well as full URLs, and
 * they deliberately open in the same tab: inside the WebView that's in-app navigation,
 * which is what "takes them to the account in the app" means. External links open in a
 * new tab so the app isn't replaced by a website.
 */
const LINK_PATTERN = "https?:\\/\\/[^\\s<]+|\\/(?:business|ad|job|post|story|meetings|messages)\\/[A-Za-z0-9_-]+";
// Two instances on purpose: the /g one is needed to split, but a global regex carries
// lastIndex between .test() calls and would mis-classify later parts. The test copy has
// no /g, so it is stateless.
const LINK_SPLIT = new RegExp(`(${LINK_PATTERN})`, "g");
const LINK_TEST = new RegExp(`^(?:${LINK_PATTERN})$`);

function linkify(text: string): React.ReactNode {
  if (!text) return text;
  const parts = text.split(LINK_SPLIT);
  if (parts.length === 1) return text;

  return parts.map((part, i) => {
    if (!LINK_TEST.test(part)) return part;
    const internal = part.startsWith("/");
    return (
      <a
        key={i}
        href={part}
        target={internal ? undefined : "_blank"}
        rel={internal ? undefined : "noopener noreferrer"}
        className="font-bold underline underline-offset-2"
      >
        {part}
      </a>
    );
  });
}

/** Preview card for a post shared into a chat. */
function SharedPost({ id, note, t }: { id: string; note: string; t: (k: string) => string }) {
  const router = useRouter();
  const [post, setPost] = useState<FeedPost | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    apiGet<{ post: FeedPost }>(`/api/posts/${id}`, getAccessToken() || undefined).then((res) => {
      if (res.ok && res.data?.post) setPost(res.data.post);
      else setGone(true);
    });
  }, [id]);

  if (gone) return <p className="text-[13px] italic opacity-70">{t("post.gone")}</p>;

  return (
    <button onClick={() => router.push(`/post/${id}`)} className="block w-56 overflow-hidden rounded-xl bg-black/10 text-start active:scale-[0.98]">
      {post ? (
        <>
          {post.kind === "video" ? (
            <video src={`${post.mediaUrl}#t=0.1`} muted playsInline preload="metadata" className="h-36 w-full bg-black object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.mediaUrl} alt="" className="h-36 w-full bg-black object-cover" />
          )}
          <span className="block px-2.5 py-2">
            <span className="block truncate text-[12.5px] font-extrabold">{post.user.displayName}</span>
            {post.caption && <span className="mt-0.5 block line-clamp-2 text-[12px] font-medium opacity-80">{post.caption}</span>}
          </span>
        </>
      ) : (
        <span className="block h-36 w-full animate-pulse bg-black/10" />
      )}
      {note && <span className="block px-2.5 pb-2 text-[12.5px] font-medium">{note}</span>}
    </button>
  );
}

function Sheet({ open, onClose, title, dir, children }: { open: boolean; onClose: () => void; title: string; dir: string; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <motion.div dir={dir} initial={{ y: 320 }} animate={{ y: 0 }} exit={{ y: 320 }} transition={{ type: "spring", damping: 30, stiffness: 320 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-[480px] rounded-t-3xl bg-white px-5 pb-[calc(env(safe-area-inset-bottom)+18px)] pt-3">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" />
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[16px] font-extrabold text-ink">{title}</h3>
              <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-muted"><X className="h-4 w-4" /></button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AttachTile({ icon, label, tint, onClick }: { icon: React.ReactNode; label: string; tint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-2 rounded-2xl bg-slate-50 py-4 active:scale-95">
      <span className={`grid h-12 w-12 place-items-center rounded-2xl ${tint}`}>{icon}</span>
      <span className="text-[12px] font-bold text-ink/80">{label}</span>
    </button>
  );
}

function ToggleRow({ icon, label, hint, on, onClick }: { icon: React.ReactNode; label: string; hint?: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-start active:bg-slate-50">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-bold text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-[11.5px] font-medium text-muted">{hint}</span>}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-brand-600" : "bg-slate-200"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "start-[22px]" : "start-0.5"}`} />
      </span>
    </button>
  );
}
