"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, MicOff, Hand, PhoneOff, Video, VideoOff, X, MessageSquare, Ban, Crown, Users,
  Share2, Check, ShieldAlert, MonitorUp, Monitor, KeyRound, Bell, Send,
} from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, apiPost, apiPatch, getAccessToken } from "@/lib/api";
import { joinLiveKit, type LkRoom, type StageTrack } from "@/lib/livekit";
import { getSocket } from "@/lib/socket";
import { setSecureScreen } from "@/lib/secure-screen";
import RoomGate from "@/components/room-gate";

type State = "talking" | "muted" | "requesting";
type Want = "audio" | "video" | "text" | "screen" | null;

type P = {
  id: string; name: string; avatarUrl?: string | null; state: State;
  canAudio: boolean; canText: boolean; canVideo: boolean; canScreen: boolean;
  onStage: boolean; wants: Want; blocked: boolean; host?: boolean;
};

type ApiP = {
  id: string; name: string; avatarUrl: string | null; role: string; audioState: string;
  canAudio: boolean; canText: boolean; canVideo: boolean; canScreen: boolean; onStage: boolean;
  wants: string | null; blocked: boolean;
};

const ringFor = (s: State) => (s === "talking" ? "ring-emerald-400" : s === "requesting" ? "ring-amber-400" : "ring-red-400");
const dotFor = (s: State) => (s === "talking" ? "bg-emerald-400" : s === "requesting" ? "bg-amber-400" : "bg-red-400");

type ChatMsg = { userId: string; name: string; avatarUrl: string | null; body: string; at: number };
type Sock = { on: (e: string, cb: (p: never) => void) => void; off: (e: string) => void; emit: (e: string, p: unknown) => void };

type Access = "host" | "member" | "approved" | "kicked" | "none" | "loading";
type JoinReq = { userId: string; name: string; avatarUrl: string | null };

export default function MeetingRoomScreen({ id }: { id: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();

  const [access, setAccess] = useState<Access>("loading");
  const [hostInfo, setHostInfo] = useState<{ id: string; name: string; avatarUrl: string | null } | null>(null);
  const [myJoinStatus, setMyJoinStatus] = useState<string | null>(null);
  const [joinReqs, setJoinReqs] = useState<JoinReq[]>([]);
  const [reqBoxOpen, setReqBoxOpen] = useState(false);
  const [shareAsk, setShareAsk] = useState(false);
  const [shareCode, setShareCode] = useState("");
  const [shareErr, setShareErr] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [people, setPeople] = useState<P[]>([]);
  const [amAdmin, setAmAdmin] = useState(false);
  const [title, setTitle] = useState("");
  const [myState, setMyState] = useState<State>("muted");
  const [myVideo, setMyVideo] = useState(false);
  const [myScreen, setMyScreen] = useState(false);
  const [myWant, setMyWant] = useState<Want>(null);
  const [myCan, setMyCan] = useState({ audio: false, video: false, text: true, screen: false });
  const [sel, setSel] = useState<P | null>(null);
  const [copied, setCopied] = useState(false);
  const [noRecording, setNoRecording] = useState(false);
  const [recAlert, setRecAlert] = useState<{ userId: string; name: string } | null>(null);
  const [tracks, setTracks] = useState<StageTrack[]>([]);
  const [stageAsk, setStageAsk] = useState<{ userId: string; name: string; kind: "video" | "screen" } | null>(null);
  const [maxSeats, setMaxSeats] = useState(20);
  const [chatOpen, setChatOpen] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatText, setChatText] = useState("");
  const [unread, setUnread] = useState(0);
  const roomRef = useRef<LkRoom | null>(null);
  const sockRef = useRef<Sock | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const host = people.find((p) => p.host) ?? null;
  const others = people.filter((p) => !p.host);
  const stageTracks = tracks.slice(0, 2);

  const load = useCallback(async () => {
    const token = getAccessToken() || undefined;
    const res = await apiGet<{ meeting: { title: string; hostId: string; hostName: string; hostAvatar: string | null; allowRecording: boolean; maxSeats: number; access: Access; myJoinStatus: string | null; pendingJoins: JoinReq[]; participants: ApiP[] } }>(`/api/meetings/${id}`, token);
    if (!res.ok || !res.data?.meeting) return;
    const m = res.data.meeting;
    setTitle(m.title);
    setNoRecording(!m.allowRecording);
    setMaxSeats(m.maxSeats || 20);
    setHostInfo({ id: m.hostId, name: m.hostName, avatarUrl: m.hostAvatar });
    setMyJoinStatus(m.myJoinStatus ?? null);
    setJoinReqs(m.pendingJoins ?? []);

    // The owner's share link carries the code — join straight away.
    const linkCode = search.get("c");
    if (m.access === "none" && linkCode && token) {
      const j = await apiPost<{ ok: boolean }>(`/api/meetings/${id}/join`, { code: linkCode }, token);
      if (j.ok) { setAccess("member"); }
      else setAccess("none");
    } else if (m.access === "approved" && token) {
      // host already said yes — walk in without a code
      const j = await apiPost<{ ok: boolean }>(`/api/meetings/${id}/join`, {}, token);
      setAccess(j.ok ? "member" : "none");
    } else {
      setAccess(m.access);
    }
    setPeople(
      m.participants.map((p) => ({
        id: p.id, name: p.name || p.id, avatarUrl: p.avatarUrl, state: p.audioState as State,
        canAudio: p.canAudio, canText: p.canText, canVideo: p.canVideo, canScreen: p.canScreen,
        onStage: p.onStage, wants: (p.wants as Want) ?? null, blocked: p.blocked, host: p.role === "host",
      }))
    );
    const me = token ? await apiGet<{ user: { id: string } }>("/api/auth/me", token) : null;
    if (me?.ok && me.data?.user) {
      const uid = me.data.user.id;
      setAmAdmin(m.hostId === uid);
      const mine = m.participants.find((p) => p.id === uid);
      if (mine) {
        setMyCan({ audio: mine.canAudio, video: mine.canVideo, text: mine.canText, screen: mine.canScreen });
        setMyWant((mine.wants as Want) ?? null);
      }
    }
  }, [id, search]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  // Keep the room list live: new joiners, leavers and mic states show up without a refresh.
  useEffect(() => {
    if (!ready || access !== "member" && access !== "host") return;
    const iv = setInterval(() => { load(); }, 5000);
    return () => clearInterval(iv);
  }, [ready, access, load]);

  // Connect the media room. The server hands back the LiveKit url at runtime, so this
  // works no matter how the app was built. Mic stays off until the host allows it.
  useEffect(() => {
    if (!ready || (access !== "member" && access !== "host")) return;
    const token = getAccessToken();
    if (!token) return;
    let room: LkRoom | null = null;
    let dead = false;
    (async () => {
      const res = await apiGet<{ token: string; url: string }>(`/api/meetings/${id}/token`, token);
      if (dead || !res.ok || !res.data?.token || !res.data?.url) return;
      room = await joinLiveKit(
        res.data.url,
        res.data.token,
        (speakers: string[]) => {
          setPeople((ps) => ps.map((p) => (speakers.includes(p.id) ? { ...p, state: "talking" } : p)));
        },
        (tk: StageTrack[]) => setTracks(tk),
        false
      );
      if (dead) { room?.disconnect(); return; }
      roomRef.current = room;
    })();
    return () => { dead = true; room?.disconnect(); roomRef.current = null; };
  }, [ready, id, access]);

  useEffect(() => {
    if (!ready || !noRecording) return;
    setSecureScreen(true);
    const report = () => { apiPost(`/api/meetings/${id}/recording-alert`, {}, getAccessToken() || undefined).catch(() => {}); };
    const onVis = () => { if (document.visibilityState === "hidden") report(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); setSecureScreen(false); };
  }, [ready, noRecording, id]);

  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken();
    if (!token) return;
    let s: { on: (e: string, cb: (p: never) => void) => void; off: (e: string) => void; emit: (e: string, p: unknown) => void } | null = null;
    let mounted = true;
    (async () => {
      const sock = await getSocket(token);
      if (!mounted) return;
      s = sock;
      sockRef.current = sock as unknown as Sock;
      sock.emit("meeting:join", { meetingId: id });
      sock.on("meeting:chat", (p: { meetingId?: string; userId?: string; name?: string; avatarUrl?: string | null; body?: string; at?: number }) => {
        if (p?.meetingId !== id || !p.body) return;
        setChat((c) => [...c, { userId: p.userId ?? "", name: p.name ?? "", avatarUrl: p.avatarUrl ?? null, body: p.body!, at: p.at ?? Date.now() }]);
        setUnread((n) => n + 1);
      });
      sock.on("meeting:ended", (p: { meetingId?: string }) => {
        if (p?.meetingId === id) { alert(t("meet.ended")); router.push("/meetings"); }
      });
      sock.on("meeting:recording", (p: { meetingId?: string; userId?: string; name?: string }) => {
        if (p?.meetingId === id && p?.userId) setRecAlert({ userId: p.userId, name: p.name || p.userId });
      });
      sock.on("meeting:kicked", (p: { meetingId?: string }) => {
        if (p?.meetingId === id) { alert(t("meet.youWereKicked")); router.push("/meetings"); }
      });
      sock.on("meeting:request", (p: { meetingId?: string; userId?: string; want?: string | null }) => {
        if (p?.meetingId !== id || !p.userId) return;
        setPeople((ps) => ps.map((x) => (x.id === p.userId ? { ...x, wants: (p.want as Want) ?? null, state: p.want === "audio" ? "requesting" : x.state } : x)));
      });
      sock.on("meeting:granted", (p: { meetingId?: string; kind?: string; allow?: boolean }) => {
        if (p?.meetingId !== id || !p.kind) return;
        setMyWant(null);
        setMyCan((c) => ({ ...c, [p.kind as "audio" | "video" | "text" | "screen"]: !!p.allow }));
        if (p.kind === "audio" && p.allow) { setMyState("talking"); roomRef.current?.setMic(true).catch(() => {}); }
        if (p.kind === "video" && !p.allow) { setMyVideo(false); roomRef.current?.setCamera(false).catch(() => {}); }
        if (p.kind === "screen" && !p.allow) { setMyScreen(false); roomRef.current?.setScreen(false).catch(() => {}); }
      });
      sock.on("meeting:joinRequest", (p: { meetingId?: string; userId?: string; name?: string; avatarUrl?: string | null }) => {
        if (p?.meetingId !== id || !p.userId) return;
        setJoinReqs((rs) => (rs.some((r) => r.userId === p.userId) ? rs : [...rs, { userId: p.userId!, name: p.name || p.userId!, avatarUrl: p.avatarUrl ?? null }]));
      });
      sock.on("meeting:joinDecision", (p: { meetingId?: string; allow?: boolean }) => {
        if (p?.meetingId !== id) return;
        if (p.allow) load();
        else setMyJoinStatus("denied");
      });
      sock.on("meeting:stage", (p: { meetingId?: string; onStage?: boolean }) => {
        if (p?.meetingId !== id || p.onStage) return;
        setMyVideo(false); setMyScreen(false);
        setMyCan((c) => ({ ...c, video: false, screen: false }));
        roomRef.current?.setCamera(false).catch(() => {});
        roomRef.current?.setScreen(false).catch(() => {});
      });
    })();
    return () => {
      mounted = false;
      if (s) {
        (s as unknown as Sock).emit?.("meeting:leaveRoom", { meetingId: id });
        s.off("meeting:recording"); s.off("meeting:kicked"); s.off("meeting:request"); s.off("meeting:granted");
        s.off("meeting:stage"); s.off("meeting:joinRequest"); s.off("meeting:joinDecision");
        s.off("meeting:chat"); s.off("meeting:ended");
      }
      sockRef.current = null;
    };
  }, [ready, id, router, t, load]);

  async function pushLink(url: string) {
    try {
      if (navigator.share) { await navigator.share({ title: title || t("meet.roomTitle"), url }); return; }
    } catch { /* cancelled */ }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* unavailable */ }
  }

  // Owner: link carries the code, so the recipient walks straight in.
  // Member: must prove they know the code before they can share a (plain) link.
  async function shareRoom() {
    const base = `${window.location.origin}/meetings/${id}`;
    if (amAdmin) {
      const code = roomCode ?? (await (async () => {
        const r = await apiGet<{ code: string }>(`/api/meetings/${id}/code`, getAccessToken() || undefined);
        const c = r.ok && r.data?.code ? r.data.code : null;
        setRoomCode(c);
        return c;
      })());
      pushLink(code ? `${base}?c=${code}` : base);
      return;
    }
    setShareAsk(true);
    setShareCode("");
    setShareErr(null);
  }

  async function confirmShare() {
    const r = await apiPost<{ ok: boolean }>(`/api/meetings/${id}/verify-code`, { code: shareCode.trim() }, getAccessToken() || undefined);
    if (!r.ok) { setShareErr(t("meet.badCode")); return; }
    setShareAsk(false);
    pushLink(`${window.location.origin}/meetings/${id}`);
  }

  async function decideJoin(userId: string, allow: boolean) {
    setJoinReqs((rs) => rs.filter((r) => r.userId !== userId));
    await apiPatch(`/api/meetings/${id}/join-request`, { userId, allow }, getAccessToken() || undefined);
    if (allow) load();
  }

  async function request(want: Exclude<Want, null>) {
    const next: Want = myWant === want ? null : want;
    setMyWant(next);
    await apiPost(`/api/meetings/${id}/request`, { want: next }, getAccessToken() || undefined);
  }

  async function grant(userId: string, kind: "audio" | "video" | "text" | "screen", allow: boolean, mode?: "solo" | "split") {
    setPeople((ps) => ps.map((p) => (p.id === userId ? { ...p, wants: null } : p)));
    await apiPost(`/api/meetings/${id}/grant`, { userId, kind, allow, mode }, getAccessToken() || undefined);
    load();
  }

  async function kick(userId: string) {
    await apiPost(`/api/meetings/${id}/kick`, { userId, reason: "recording" }, getAccessToken() || undefined);
    setPeople((ps) => ps.filter((p) => p.id !== userId));
    setRecAlert(null);
    setSel(null);
  }

  function toggleMic() {
    if (!amAdmin && !myCan.audio) { request("audio"); return; }
    setMyState((s) => {
      const next: State = s === "talking" ? "muted" : "talking";
      roomRef.current?.setMic(next === "talking").catch(() => {});
      // tell the room, so everyone's ring turns green/red
      apiPatch(`/api/meetings/${id}/state`, { audioState: next }, getAccessToken() || undefined).catch(() => {});
      return next;
    });
  }

  async function leaveRoom() {
    roomRef.current?.disconnect();
    await apiPost(`/api/meetings/${id}/leave`, {}, getAccessToken() || undefined).catch(() => {});
    router.push("/meetings");
  }

  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, chatOpen]);

  function sendChat() {
    const body = chatText.trim();
    if (!body) return;
    sockRef.current?.emit("meeting:chat", { meetingId: id, body });
    setChatText("");
  }
  function toggleVideo() {
    if (!amAdmin && !myCan.video) { request("video"); return; }
    setMyVideo((v) => {
      const next = !v;
      roomRef.current?.setCamera(next).catch(() => {});
      return next;
    });
  }
  function toggleScreen() {
    if (!amAdmin && !myCan.screen) { request("screen"); return; }
    setMyScreen((v) => {
      const next = !v;
      roomRef.current?.setScreen(next).catch(() => {});
      return next;
    });
  }

  if (!ready || access === "loading") return null;

  // Not in the room yet → the gate (code / ask the host / visit the host).
  if (access === "none" || access === "kicked") {
    return (
      <RoomGate
        id={id}
        title={title}
        hostId={hostInfo?.id ?? ""}
        hostName={hostInfo?.name ?? ""}
        hostAvatar={hostInfo?.avatarUrl ?? null}
        myJoinStatus={myJoinStatus}
        kicked={access === "kicked"}
        onEntered={() => { setAccess("member"); load(); }}
      />
    );
  }

  const pending = others.filter((p) => p.wants);

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-900 text-white">
      <div className="flex items-center gap-3 px-5 pb-2 pt-[calc(env(safe-area-inset-top)+14px)]">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-extrabold">{title || t("meet.roomTitle")}</p>
          <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-400">
            <Users className="h-3.5 w-3.5" /> {ld(people.length, locale)}/{ld(maxSeats, locale)}
            {amAdmin && <span className="ms-1 inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-300"><Crown className="h-3 w-3" /> {t("meet.admin")}</span>}
          </p>
        </div>
        <button onClick={shareRoom} aria-label={t("meet.invite")} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white active:scale-95">
          {copied ? <Check className="h-5 w-5 text-emerald-400" /> : <Share2 className="h-5 w-5" />}
        </button>
        <button onClick={() => router.push("/meetings")} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white active:scale-95">
          <X className="h-5 w-5" />
        </button>
      </div>

      {recAlert && amAdmin && (
        <div className="mx-5 mb-2 flex items-center gap-2 rounded-2xl bg-red-500/20 px-3 py-2.5 ring-1 ring-red-500/40">
          <ShieldAlert className="h-5 w-5 shrink-0 text-red-400" />
          <p className="flex-1 text-[12px] font-bold text-red-200">{recAlert.name} — {t("meet.recordingWarn")}</p>
          <button onClick={() => kick(recAlert.userId)} className="shrink-0 rounded-xl bg-red-500 px-3 py-1.5 text-[12px] font-bold text-white active:scale-95">{t("meet.kick")}</button>
          <button onClick={() => setRecAlert(null)} aria-label={t("profile.cancel")} className="shrink-0 text-red-300"><X className="h-4 w-4" /></button>
        </div>
      )}
      {noRecording && !recAlert && (
        <div className="mx-5 mb-2 flex items-center gap-1.5 rounded-2xl bg-amber-400/15 px-3 py-1.5 text-[11px] font-bold text-amber-300">
          <ShieldAlert className="h-3.5 w-3.5" /> {t("meet.noRecordingNote")}
        </div>
      )}

      {host && (
        <div className="relative flex flex-col items-center pb-3">
          {/* host's join-request inbox — sits next to the name */}
          {amAdmin && (
            <button
              onClick={() => setReqBoxOpen((o) => !o)}
              aria-label={t("meet.joinRequests")}
              className={`absolute end-5 top-0 grid h-9 w-9 place-items-center rounded-full active:scale-95 ${joinReqs.length ? "bg-amber-400 text-amber-950" : "bg-white/10 text-white"}`}
            >
              <Bell className="h-4.5 w-4.5" />
              {joinReqs.length > 0 && (
                <span className="absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-extrabold text-white ring-2 ring-slate-900">
                  {joinReqs.length}
                </span>
              )}
            </button>
          )}
          {amAdmin && reqBoxOpen && (
            <div className="absolute end-5 top-11 z-40 w-64 overflow-hidden rounded-2xl bg-white text-ink shadow-xl">
              <p className="border-b border-slate-100 px-3 py-2 text-[12px] font-extrabold">{t("meet.joinRequests")}</p>
              {joinReqs.length === 0 ? (
                <p className="px-3 py-3 text-[12px] font-medium text-muted">{t("meet.noJoinRequests")}</p>
              ) : (
                joinReqs.map((r) => (
                  <div key={r.userId} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-0">
                    <button onClick={() => router.push(`/business/${r.userId}`)} className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-50 text-[12px] font-extrabold text-brand-600">
                      {r.avatarUrl ? (
                        <img src={r.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        (r.name || "•").charAt(0).toUpperCase()
                      )}
                    </button>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold">{r.name}</span>
                    <button onClick={() => decideJoin(r.userId, true)} className="rounded-lg bg-emerald-500 px-2 py-1 text-[11px] font-bold text-white">{t("meet.allow")}</button>
                    <button onClick={() => decideJoin(r.userId, false)} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-muted">{t("meet.deny")}</button>
                  </div>
                ))
              )}
            </div>
          )}
          <button onClick={() => (amAdmin ? setSel(host) : router.push(`/business/${host.id}`))} className="flex flex-col items-center gap-1.5">
            <span className={`relative grid h-[72px] w-[72px] place-items-center overflow-hidden rounded-full bg-slate-700 text-[24px] font-extrabold ring-[3px] ${ringFor(host.state)}`}>
              {host.avatarUrl ? (
                <img src={host.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                host.name.charAt(0).toUpperCase()
              )}
              <span className={`absolute -bottom-0.5 -end-0.5 grid h-6 w-6 place-items-center rounded-full ring-2 ring-slate-900 ${dotFor(host.state)}`}>
                {host.state === "talking" ? <Mic className="h-3 w-3 text-emerald-900" /> : <MicOff className="h-3 w-3 text-red-900" />}
              </span>
            </span>
            <span className="flex items-center gap-1 text-[13px] font-extrabold text-white">
              <Crown className="h-3.5 w-3.5 text-amber-400" /> {host.name}
            </span>
          </button>
        </div>
      )}

      <div className="mx-5 mb-3 overflow-hidden rounded-3xl bg-black ring-1 ring-white/10">
        {stageTracks.length === 0 ? (
          <div className="grid h-40 place-items-center text-center">
            <div>
              <Monitor className="mx-auto h-7 w-7 text-slate-600" />
              <p className="mt-1 text-[11.5px] font-bold text-slate-500">{t("meet.stageEmpty")}</p>
            </div>
          </div>
        ) : (
          <div className={`grid h-48 ${stageTracks.length === 2 ? "grid-cols-2 gap-0.5" : "grid-cols-1"}`}>
            {stageTracks.map((tk) => (
              <StageTile key={`${tk.identity}-${tk.source}`} track={tk} name={people.find((p) => p.id === tk.identity)?.name ?? ""} />
            ))}
          </div>
        )}
      </div>

      {amAdmin && pending.length > 0 && (
        <div className="mx-5 mb-2 flex flex-col gap-1.5">
          {pending.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-2xl bg-amber-400/15 px-3 py-2">
              <Hand className="h-4 w-4 shrink-0 text-amber-300" />
              <p className="flex-1 truncate text-[12px] font-bold text-amber-200">
                {p.name} — {t(p.wants === "audio" ? "meet.wantsMic" : p.wants === "video" ? "meet.wantsVideo" : p.wants === "screen" ? "meet.wantsScreen" : "meet.wantsText")}
              </p>
              <button
                onClick={() => {
                  if (p.wants === "video" || p.wants === "screen") setStageAsk({ userId: p.id, name: p.name, kind: p.wants });
                  else grant(p.id, p.wants as "audio" | "text", true);
                }}
                className="shrink-0 rounded-lg bg-emerald-500 px-2.5 py-1 text-[11.5px] font-bold text-white active:scale-95"
              >
                {t("meet.allow")}
              </button>
              <button onClick={() => grant(p.id, p.wants as "audio" | "video" | "text" | "screen", false)} className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1 text-[11.5px] font-bold text-slate-300 active:scale-95">
                {t("meet.deny")}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-center gap-4 px-5 pb-1 text-[10.5px] font-medium text-slate-400">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" /> {t("meet.talking")}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-400" /> {t("meet.muted")}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" /> {t("meet.wantsTalk")}</span>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-2">
        <div className="grid grid-cols-4 gap-3">
          {others.map((p) => (
            <button key={p.id} onClick={() => (amAdmin ? setSel(p) : router.push(`/business/${p.id}`))} className="flex flex-col items-center gap-1.5">
              <span className={`relative grid h-14 w-14 place-items-center overflow-hidden rounded-full bg-slate-700 text-[17px] font-extrabold ring-2 ${p.blocked ? "opacity-40 ring-slate-600" : ringFor(p.state)}`}>
                {p.avatarUrl ? (
                  <img src={p.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  p.name.charAt(0).toUpperCase()
                )}
                <span className={`absolute -bottom-0.5 -end-0.5 grid h-5 w-5 place-items-center rounded-full ring-2 ring-slate-900 ${p.wants ? "bg-amber-400" : dotFor(p.state)}`}>
                  {p.wants ? <Hand className="h-2.5 w-2.5 text-amber-900" /> : p.state === "talking" ? <Mic className="h-2.5 w-2.5 text-emerald-900" /> : <MicOff className="h-2.5 w-2.5 text-red-900" />}
                </span>
                {p.onStage && <span className="absolute inset-x-0 bottom-0 bg-brand-600/80 py-[1px] text-center text-[8px] font-bold">{t("meet.onStage")}</span>}
              </span>
              <span className="w-full truncate text-center text-[10.5px] font-bold text-slate-200">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-white/10 bg-slate-900 px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3">
        {myWant && <p className="mb-2 text-center text-[11.5px] font-bold text-amber-300">{t("meet.waitingHost")}</p>}
        <div className="flex items-center justify-center gap-3">
          <CtrlBtn active={myState === "talking"} pending={myWant === "audio"} onClick={toggleMic} activeCls="bg-emerald-500" label={t("meet.mute")}>
            {myState === "talking" ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
          </CtrlBtn>
          <CtrlBtn active={myVideo} pending={myWant === "video"} onClick={toggleVideo} activeCls="bg-brand-500" label={t("meet.video")}>
            {myVideo ? <Video className="h-6 w-6" /> : <VideoOff className="h-6 w-6" />}
          </CtrlBtn>
          <CtrlBtn active={myScreen} pending={myWant === "screen"} onClick={toggleScreen} activeCls="bg-violet-500" label={t("meet.screen")}>
            <MonitorUp className="h-6 w-6" />
          </CtrlBtn>
          <CtrlBtn
            active={myCan.text || amAdmin}
            pending={myWant === "text"}
            badge={unread}
            onClick={() => {
              if (!amAdmin && !myCan.text) { request("text"); return; }
              setChatOpen(true);
              setUnread(0);
            }}
            activeCls="bg-amber-400 text-amber-950"
            label={t("meet.chat")}
          >
            <MessageSquare className="h-6 w-6" />
          </CtrlBtn>
          <button onClick={leaveRoom} aria-label={t("meet.leave")} className="grid h-14 w-14 place-items-center rounded-full bg-red-500 text-white active:scale-95">
            <PhoneOff className="h-6 w-6" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {stageAsk && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setStageAsk(null)} className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
            <motion.div
              dir={dir}
              initial={{ y: 300 }} animate={{ y: 0 }} exit={{ y: 300 }} transition={{ type: "spring", damping: 30, stiffness: 320 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[480px] rounded-t-3xl bg-white px-5 pb-[calc(env(safe-area-inset-bottom)+18px)] pt-3 text-ink"
            >
              <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" />
              <p className="mb-1 text-[15px] font-extrabold">{stageAsk.name}</p>
              <p className="mb-4 text-[12.5px] font-medium text-muted">
                {t(stageAsk.kind === "screen" ? "meet.wantsScreen" : "meet.wantsVideo")} — {t("meet.stageHow")}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => { grant(stageAsk.userId, stageAsk.kind, true, "solo"); setStageAsk(null); }} className="flex flex-col items-center gap-1.5 rounded-2xl bg-brand-600 py-4 text-white active:scale-95">
                  <Monitor className="h-6 w-6" />
                  <span className="text-[13px] font-bold">{t("meet.stageSolo")}</span>
                </button>
                <button onClick={() => { grant(stageAsk.userId, stageAsk.kind, true, "split"); setStageAsk(null); }} className="flex flex-col items-center gap-1.5 rounded-2xl bg-violet-600 py-4 text-white active:scale-95">
                  <div className="flex gap-0.5"><Monitor className="h-6 w-6" /><Monitor className="h-6 w-6" /></div>
                  <span className="text-[13px] font-bold">{t("meet.stageSplit")}</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* member: prove you know the code before sharing */}
      {shareAsk && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setShareAsk(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[480px] rounded-t-3xl bg-white px-5 pb-[calc(env(safe-area-inset-bottom)+18px)] pt-4 text-ink">
            <p className="mb-1 flex items-center gap-1.5 text-[15px] font-extrabold">
              <KeyRound className="h-4 w-4 text-brand-600" /> {t("meet.shareNeedsCode")}
            </p>
            <p className="mb-3 text-[12px] font-medium text-muted">{t("meet.shareNeedsCodeHint")}</p>
            <input
              autoFocus
              value={shareCode}
              onChange={(e) => { setShareCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)); setShareErr(null); }}
              onKeyDown={(e) => e.key === "Enter" && confirmShare()}
              dir="ltr"
              placeholder="XXXXXX"
              className="mb-2 h-12 w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-4 text-center text-[17px] font-extrabold tracking-[0.3em] text-ink outline-none focus:border-brand-500 focus:bg-white"
            />
            {shareErr && <p className="mb-2 text-center text-[12.5px] font-bold text-red-600">{shareErr}</p>}
            <button onClick={confirmShare} disabled={shareCode.trim().length < 4} className={`w-full rounded-2xl py-3.5 text-[15px] font-bold text-white ${shareCode.trim().length >= 4 ? "bg-brand-600" : "bg-slate-300"}`}>
              {t("meet.invite")}
            </button>
          </div>
        </div>
      )}

      {/* in-room chat */}
      <AnimatePresence>
        {chatOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setChatOpen(false)} className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
            <motion.div
              dir={dir}
              initial={{ y: 400 }} animate={{ y: 0 }} exit={{ y: 400 }} transition={{ type: "spring", damping: 30, stiffness: 320 }}
              onClick={(e) => e.stopPropagation()}
              className="flex h-[64dvh] w-full max-w-[480px] flex-col rounded-t-3xl bg-slate-800"
            >
              <div className="relative shrink-0 border-b border-white/10 py-3.5 text-center">
                <span className="absolute start-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-white/20" />
                <p className="text-[14.5px] font-extrabold text-white">{t("meet.chat")}</p>
                <button onClick={() => setChatOpen(false)} aria-label={t("close")} className="absolute end-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-white/10 text-white active:scale-95">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-3">
                {chat.length === 0 ? (
                  <p className="mt-10 text-center text-[13px] font-medium text-slate-400">{t("meet.chatEmpty")}</p>
                ) : (
                  chat.map((m, i) => (
                    <div key={`${m.userId}-${m.at}-${i}`} className="flex items-start gap-2.5 py-2">
                      <button onClick={() => router.push(`/business/${m.userId}`)} className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-600 text-[11px] font-extrabold text-white">
                        {m.avatarUrl ? (
                          <img src={m.avatarUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          (m.name || "•").charAt(0).toUpperCase()
                        )}
                      </button>
                      <p className="min-w-0 flex-1 text-[13px] leading-snug text-slate-100">
                        <button onClick={() => router.push(`/business/${m.userId}`)} className="font-extrabold text-white">{m.name}</button>{" "}
                        <span className="font-medium text-slate-300">{m.body}</span>
                      </p>
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="shrink-0 border-t border-white/10 p-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
                <div className="flex items-center gap-2">
                  <input
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
                    placeholder={t("meet.chatHint")}
                    className="h-11 flex-1 rounded-2xl bg-white/10 px-4 text-[14px] font-medium text-white outline-none placeholder:text-slate-500"
                  />
                  <button onClick={sendChat} disabled={!chatText.trim()} aria-label={t("chat.send")} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-600 text-white disabled:opacity-40 active:scale-95">
                    <Send className={`h-5 w-5 ${dir === "rtl" ? "-scale-x-100" : ""}`} />
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sel && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSel(null)} className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
            <motion.div
              dir={dir}
              initial={{ y: 340 }} animate={{ y: 0 }} exit={{ y: 340 }} transition={{ type: "spring", damping: 30, stiffness: 320 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[480px] rounded-t-3xl bg-white px-5 pb-[calc(env(safe-area-inset-bottom)+18px)] pt-3 text-ink"
            >
              <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" />
              <div className="mb-3 flex items-center gap-3">
                <span className={`grid h-11 w-11 place-items-center overflow-hidden rounded-full bg-slate-100 text-[16px] font-extrabold text-ink ring-2 ${ringFor(sel.state)}`}>
                  {sel.avatarUrl ? (
                    <img src={sel.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    sel.name.charAt(0).toUpperCase()
                  )}
                </span>
                <div className="flex-1">
                  <p className="text-[15px] font-extrabold text-ink">{sel.name}</p>
                  <p className="text-[11.5px] font-medium text-muted">{t(sel.state === "talking" ? "meet.talking" : sel.state === "requesting" ? "meet.wantsTalk" : "meet.muted")}</p>
                </div>
              </div>

              <AccessRow icon={<Mic className="h-5 w-5" />} label={t("meet.accessAudio")} on={sel.canAudio} onClick={() => { grant(sel.id, "audio", !sel.canAudio); setSel({ ...sel, canAudio: !sel.canAudio }); }} />
              <AccessRow icon={<MessageSquare className="h-5 w-5" />} label={t("meet.accessText")} on={sel.canText} onClick={() => { grant(sel.id, "text", !sel.canText); setSel({ ...sel, canText: !sel.canText }); }} />
              <AccessRow icon={<Video className="h-5 w-5" />} label={t("meet.accessVideo")} on={sel.canVideo} onClick={() => { if (!sel.canVideo) setStageAsk({ userId: sel.id, name: sel.name, kind: "video" }); else grant(sel.id, "video", false); setSel(null); }} />
              <AccessRow icon={<MonitorUp className="h-5 w-5" />} label={t("meet.screen")} on={sel.canScreen} onClick={() => { if (!sel.canScreen) setStageAsk({ userId: sel.id, name: sel.name, kind: "screen" }); else grant(sel.id, "screen", false); setSel(null); }} last />

              <button onClick={() => { const uid = sel.id; setSel(null); router.push(`/business/${uid}`); }} className="mt-1 flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-start text-[14px] font-bold text-brand-700 active:bg-brand-50">
                <Users className="h-5 w-5" /> {t("meet.viewProfile")}
              </button>

              {!sel.host && (
                <button onClick={() => kick(sel.id)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-start text-[14px] font-bold text-red-600 active:bg-red-50">
                  <Ban className="h-5 w-5" /> {t("meet.kick")}
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StageTile({ track, name }: { track: StageTrack; name: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => track.detach();
  }, [track]);
  return (
    <div className="relative bg-black">
      <video ref={ref} autoPlay playsInline muted className="h-full w-full object-contain" />
      <span className="absolute bottom-1.5 start-1.5 flex items-center gap-1 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-bold text-white">
        {track.source === "screen" ? <MonitorUp className="h-3 w-3" /> : <Video className="h-3 w-3" />} {name}
      </span>
    </div>
  );
}

function CtrlBtn({ active, pending, badge, onClick, children, activeCls, label }: { active: boolean; pending?: boolean; badge?: number; onClick: () => void; children: React.ReactNode; activeCls: string; label: string }) {
  return (
    <button onClick={onClick} aria-label={label} className={`relative grid h-14 w-14 place-items-center rounded-full transition-colors active:scale-95 ${active ? activeCls : "bg-white/10 text-white"}`}>
      {children}
      {pending && <span className="absolute -top-0.5 -end-0.5 h-3 w-3 animate-pulse rounded-full bg-amber-400 ring-2 ring-slate-900" />}
      {!!badge && badge > 0 && (
        <span className="absolute -top-1 -end-1 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-extrabold text-white ring-2 ring-slate-900">
          {badge}
        </span>
      )}
    </button>
  );
}

function AccessRow({ icon, label, on, onClick, last }: { icon: React.ReactNode; label: string; on: boolean; onClick: () => void; last?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-3 bg-white py-3 text-start ${last ? "" : "border-b border-slate-100"}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>
      <span className="flex-1 text-[14px] font-bold text-ink">{label}</span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-brand-600" : "bg-slate-200"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "start-[22px]" : "start-0.5"}`} />
      </span>
    </button>
  );
}
