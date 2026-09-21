"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, MicOff, Hand, PhoneOff, Video, VideoOff, X, MessageSquare, Ban, Crown, Users,
  Share2, Check, ShieldAlert, MonitorUp, Monitor, Bell, Send, SwitchCamera,
} from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, apiPost, apiPatch, getAccessToken } from "@/lib/api";
import { joinLiveKit, screenShareSupported, type LkRoom, type StageTrack } from "@/lib/livekit";
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

type ChatMsg = { userId: string; name: string; avatarUrl: string | null; body: string; at: number };
type Sock = { on: (e: string, cb: (p: never) => void) => void; off: (e: string) => void; emit: (e: string, p: unknown) => void };

type Access = "host" | "member" | "approved" | "kicked" | "none" | "loading";
type JoinReq = { userId: string; name: string; avatarUrl: string | null };

export default function MeetingRoomScreen({ id }: { id: string }) {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();

  const [access, setAccess] = useState<Access>("loading");
  const [hostInfo, setHostInfo] = useState<{ id: string; name: string; avatarUrl: string | null } | null>(null);
  const [myJoinStatus, setMyJoinStatus] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState("public");
  const [myId, setMyId] = useState("");
  const [rosterOpen, setRosterOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** True while the browser refuses to play remote audio (mobile needs a tap first). */
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [joinReqs, setJoinReqs] = useState<JoinReq[]>([]);
  const [reqBoxOpen, setReqBoxOpen] = useState(false);
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
  // Invite sheet: people the host follows, and who has already been sent an invite.
  const [inviteOpen, setInviteOpen] = useState(false);
  const [follows, setFollows] = useState<{ id: string; displayName: string; avatarUrl: string | null }[]>([]);
  const [invited, setInvited] = useState<Record<string, boolean>>({});
  const [noRecording, setNoRecording] = useState(false);
  const [recAlert, setRecAlert] = useState<{ userId: string; name: string } | null>(null);
  const [tracks, setTracks] = useState<StageTrack[]>([]);
  const [stageAsk, setStageAsk] = useState<{ userId: string; name: string; kind: "video" | "screen" } | null>(null);
  const [maxSeats, setMaxSeats] = useState(20);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatText, setChatText] = useState("");
  const roomRef = useRef<LkRoom | null>(null);
  const sockRef = useRef<Sock | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const meRef = useRef(""); // current user id, for the chat socket closure

  const others = people.filter((p) => !p.host);
  const stageTracks = tracks.slice(0, 4);

  const load = useCallback(async () => {
    const token = getAccessToken() || undefined;
    const res = await apiGet<{ meeting: { title: string; hostId: string; hostName: string; hostAvatar: string | null; allowRecording: boolean; maxSeats: number; access: Access; myJoinStatus: string | null; pendingJoins: JoinReq[]; participants: ApiP[]; privacy?: string } }>(`/api/meetings/${id}`, token);
    if (!res.ok || !res.data?.meeting) return;
    const m = res.data.meeting;
    setTitle(m.title);
    setNoRecording(!m.allowRecording);
    setMaxSeats(m.maxSeats || 20);
    setHostInfo({ id: m.hostId, name: m.hostName, avatarUrl: m.hostAvatar });
    setMyJoinStatus(m.myJoinStatus ?? null);
    setJoinReqs(m.pendingJoins ?? []);
    setPrivacy(m.privacy ?? "public");

    if (m.access === "none" && m.privacy === "public" && token) {
      // Public rooms are open — walk straight in (text on; mic/cam/screen ask the host).
      const j = await apiPost<{ ok: boolean }>(`/api/meetings/${id}/join`, {}, token);
      setAccess(j.ok ? "member" : "none");
    } else if (m.access === "approved" && token) {
      // Friends/private: the host approved — walk in.
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
      setMyId(uid);
      meRef.current = uid;
      setAmAdmin(m.hostId === uid);
      const mine = m.participants.find((p) => p.id === uid);
      if (mine) {
        setMyCan({ audio: mine.canAudio, video: mine.canVideo, text: mine.canText, screen: mine.canScreen });
        setMyWant((mine.wants as Want) ?? null);
      }
    }
  }, [id]);

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
        false,
        // Phones and tablets refuse to play audio until the page has had a real tap. A
        // listener who joins and touches nothing hears silence with no explanation — this
        // surfaces a button that both explains it and provides the gesture.
        (blocked: boolean) => setAudioBlocked(blocked)
      );
      if (dead) { room?.disconnect(); return; }
      roomRef.current = room;
    })();
    return () => { dead = true; room?.disconnect(); roomRef.current = null; };
  }, [ready, id, access]);

  // Keep the phone screen ON while in a live room — both the host broadcasting and anyone
  // watching. Without this the screen dims/locks mid-live and the stream drops. Browsers
  // release the lock when the tab is hidden, so we re-acquire it whenever the screen returns.
  useEffect(() => {
    if (!ready || (access !== "member" && access !== "host")) return;
    let sentinel: { release?: () => Promise<void> } | null = null;
    const acquire = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release?: () => Promise<void> }> } };
        if (nav.wakeLock && document.visibilityState === "visible") {
          sentinel = await nav.wakeLock.request("screen");
        }
      } catch { /* wake lock unsupported or denied — harmless */ }
    };
    const onVis = () => { if (document.visibilityState === "visible") acquire(); };
    acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      try { sentinel?.release?.(); } catch {}
    };
  }, [ready, id, access]);

  useEffect(() => {
    if (!ready || !noRecording) return;
    setSecureScreen(true);
    const report = () => { apiPost(`/api/meetings/${id}/recording-alert`, {}, getAccessToken() || undefined).catch(() => {}); };
    const onVis = () => { if (document.visibilityState === "hidden") report(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); setSecureScreen(false); };
  }, [ready, noRecording, id]);

  // Once we're a confirmed member, (re)announce to the socket room. The socket usually
  // connects BEFORE the auto-join creates the participant row, so that first meeting:join was
  // rejected and live comments only started after a reload. This re-fires it at the right time.
  useEffect(() => {
    if (access === "member" || access === "host") sockRef.current?.emit("meeting:join", { meetingId: id });
  }, [access, id]);

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
        // My own messages are shown instantly by sendChat — ignore the echo so they don't double.
        if (p.userId && p.userId === meRef.current) return;
        setChat((c) => [...c, { userId: p.userId ?? "", name: p.name ?? "", avatarUrl: p.avatarUrl ?? null, body: p.body!, at: p.at ?? Date.now() }]);
      });
      sock.on("meeting:ended", (p: { meetingId?: string }) => {
        if (p?.meetingId !== id) return;
        // NOT alert(): it blocks the JS thread until dismissed, and in an Android WebView
        // that dialog sometimes never renders — so router.push() below never ran and the
        // room stayed frozen on screen after the host ended it. Navigate first, tell them
        // second, with a toast that can't block anything.
        toast(t("meet.ended"));
        router.push("/meetings");
      });
      sock.on("meeting:recording", (p: { meetingId?: string; userId?: string; name?: string }) => {
        if (p?.meetingId === id && p?.userId) setRecAlert({ userId: p.userId, name: p.name || p.userId });
      });
      sock.on("meeting:kicked", (p: { meetingId?: string }) => {
        if (p?.meetingId !== id) return;
        toast(t("meet.youWereKicked")); // same reason as meeting:ended — never block on alert()
        router.push("/meetings");
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

  /**
   * Share opens a list of people you follow, so an invite can actually reach someone.
   *
   * It used to just copy the room link. A copied link notifies nobody, and for a host who is
   * mid-broadcast and can't leave to paste it anywhere, it did nothing useful at all.
   * Copy/native-share is still available inside the sheet for anyone who wants it.
   */
  function shareRoom() {
    setInviteOpen(true);
    if (follows.length) return; // already loaded this session
    const token = getAccessToken();
    if (!token) return;
    apiGet<{ targets: { id: string; displayName: string; avatarUrl: string | null }[] }>("/api/follows?full=1", token)
      .then((res) => { if (res.ok && res.data?.targets) setFollows(res.data.targets); });
  }

  async function inviteTo(userId: string) {
    if (invited[userId]) return;
    setInvited((s) => ({ ...s, [userId]: true })); // optimistic — the tick shouldn't wait on the network
    const res = await apiPost(`/api/meetings/${id}/invite`, { userIds: [userId] }, getAccessToken() || undefined);
    if (!res.ok) {
      setInvited((s) => ({ ...s, [userId]: false }));
      toast(t("common.error"));
    }
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
    const res = await apiPost<{ error?: string }>(`/api/meetings/${id}/grant`, { userId, kind, allow, mode }, getAccessToken() || undefined);
    if (!res.ok && res.data?.error === "stage_full") { setNote(t("meet.stageFull")); setTimeout(() => setNote(null), 2600); }
    load();
  }

  async function kick(userId: string) {
    await apiPost(`/api/meetings/${id}/kick`, { userId, reason: "recording" }, getAccessToken() || undefined);
    setPeople((ps) => ps.filter((p) => p.id !== userId));
    setRecAlert(null);
    setSel(null);
  }

  function toggleMic() {
    roomRef.current?.startAudio(); // unlock audio playback on iOS
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
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chat]);

  function sendChat() {
    const body = chatText.trim();
    if (!body) return;
    roomRef.current?.startAudio(); // this tap doubles as the iOS "enable sound" unlock
    sockRef.current?.emit("meeting:chat", { meetingId: id, body });
    // Show my own comment instantly — the server echo is ignored (see the chat handler).
    const mine = people.find((p) => p.id === myId);
    setChat((c) => [...c, { userId: myId, name: mine?.name || t("meet.you"), avatarUrl: mine?.avatarUrl ?? null, body, at: Date.now() }]);
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
  /** Brief message in the existing bottom pill (same one the stage-full notice uses). */
  function toast(msg: string) {
    setNote(msg);
    setTimeout(() => setNote(null), 2800);
  }

  async function toggleScreen() {
    if (!amAdmin && !myCan.screen) { request("screen"); return; }
    // Phones can't screen-share at all through a browser/WebView — say so instead of
    // flipping the button on and leaving a dead state behind.
    if (!myScreen && !screenShareSupported()) { toast(t("meet.screenUnsupported")); return; }
    const next = !myScreen;
    setMyScreen(next);
    const ok = await (roomRef.current?.setScreen(next) ?? Promise.resolve(false));
    if (!ok) setMyScreen(!next); // refused or cancelled — put the button back
  }

  async function flipCamera() {
    const ok = await (roomRef.current?.flipCamera() ?? Promise.resolve(false));
    if (!ok) toast(t("meet.flipFailed"));
    else setMyVideo(true); // flipping turns the camera on if it was off
  }

  if (!ready || access === "loading") return null;

  // Not in the room yet → the gate (code / ask the host / visit the host).
  if (access === "none" || access === "kicked") {
    return (
      <RoomGate
        id={id}
        title={title}
        privacy={privacy}
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
    <div dir={dir} className="relative mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-[#1b1440] text-white">
      <div className="flex items-center gap-3 px-5 pb-2 pt-[calc(env(safe-area-inset-top)+14px)]">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-extrabold">{title || t("meet.roomTitle")}</p>
          {/* owner's name — tap to open their profile */}
          <button onClick={() => hostInfo?.id && router.push(`/business/${hostInfo.id}`)} className="flex max-w-full items-center gap-1 truncate text-[11.5px] font-bold text-amber-300 active:opacity-80">
            <Crown className="h-3 w-3 shrink-0" /> <span className="truncate">{hostInfo?.name || t("meet.host")}</span>
          </button>
        </div>
        <button onClick={() => setRosterOpen(true)} aria-label={t("meet.people")} className="relative grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white active:scale-95">
          <Users className="h-5 w-5" />
          <span className="absolute -end-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[9px] font-extrabold text-white ring-2 ring-[#1b1440]">{ld(people.length, locale)}</span>
        </button>
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

      {/* host's join-request inbox — compact, no big avatar circle */}
      {amAdmin && (
        <div className="relative px-5 pb-1">
          <button
            onClick={() => setReqBoxOpen((o) => !o)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-bold active:scale-95 ${joinReqs.length ? "bg-amber-400 text-amber-950" : "bg-white/10 text-white"}`}
          >
            <Bell className="h-4 w-4" /> {t("meet.joinRequests")}
            {joinReqs.length > 0 && (
              <span className="grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-extrabold text-white">{joinReqs.length}</span>
            )}
          </button>
          {reqBoxOpen && (
            <div className="absolute start-5 top-10 z-40 w-64 overflow-hidden rounded-2xl bg-white text-ink shadow-xl">
              <p className="border-b border-slate-100 px-3 py-2 text-[12px] font-extrabold">{t("meet.joinRequests")}</p>
              {joinReqs.length === 0 ? (
                <p className="px-3 py-3 text-[12px] font-medium text-muted">{t("meet.noJoinRequests")}</p>
              ) : (
                joinReqs.map((r) => (
                  <div key={r.userId} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-0">
                    <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-50 text-[12px] font-extrabold text-brand-600">
                      {r.avatarUrl ? (
                        <img src={r.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        (r.name || "•").charAt(0).toUpperCase()
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold">{r.name}</span>
                    <button onClick={() => decideJoin(r.userId, true)} className="rounded-lg bg-emerald-500 px-2 py-1 text-[11px] font-bold text-white">{t("meet.allow")}</button>
                    <button onClick={() => decideJoin(r.userId, false)} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-muted">{t("meet.deny")}</button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* full-screen live stage — the video/screen fills the space and splits for 2/3/4 sharers */}
      <div className="relative flex-1 overflow-hidden bg-black">
        {stageTracks.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <Monitor className="mx-auto h-8 w-8 text-slate-600" />
              <p className="mt-1.5 text-[12px] font-bold text-slate-500">{t("meet.stageEmpty")}</p>
            </div>
          </div>
        ) : (
          <div className={`grid h-full w-full gap-0.5 ${stageTracks.length === 1 ? "grid-cols-1 grid-rows-1" : stageTracks.length === 2 ? "grid-cols-1 grid-rows-2" : "grid-cols-2 grid-rows-2"}`}>
            {stageTracks.map((tk) => (
              <StageTile key={`${tk.identity}-${tk.source}`} track={tk} name={people.find((p) => p.id === tk.identity)?.name ?? ""} />
            ))}
          </div>
        )}

        {/* host: pending mic/camera/screen requests — overlaid at the top of the stage */}
        {amAdmin && pending.length > 0 && (
          <div className="absolute inset-x-0 top-0 z-20 flex flex-col gap-1.5 p-3">
            {pending.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-2xl bg-black/60 px-3 py-2 backdrop-blur">
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
                <button onClick={() => grant(p.id, p.wants as "audio" | "video" | "text" | "screen", false)} className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-[11.5px] font-bold text-white/80 active:scale-95">
                  {t("meet.deny")}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Live comments — float over the video, scrollable, newest at the bottom, display-only */}
        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 via-black/20 to-transparent pt-16">
          <div className="no-scrollbar flex max-h-[42dvh] flex-col overflow-y-auto overscroll-contain px-4 pb-2">
            {/* mt-auto pins the newest to the bottom when short, but still lets you scroll UP
                when there are many — `justify-end` here used to clip the top and kill scroll. */}
            <div className="mt-auto flex flex-col gap-1.5">
              {chat.map((m, i) => (
                <div key={`c-${m.userId}-${m.at}-${i}`} className="flex items-start gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-600 text-[10px] font-extrabold text-white">
                    {m.avatarUrl ? (
                      <img src={m.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      (m.name || "•").charAt(0).toUpperCase()
                    )}
                  </span>
                  <p className="text-[12.5px] leading-snug text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">
                    <span className="font-extrabold">{m.name}</span>{" "}
                    <span className="font-medium text-white/90">{m.body}</span>
                  </p>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          </div>
        </div>
      </div>

      {/* comment input — always visible when allowed, like Instagram Live */}
      {(myCan.text || amAdmin) && (
        <div className="z-30 flex items-center gap-2 bg-[#1b1440] px-4 pb-2 pt-1">
          <input
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
            placeholder={t("meet.chatHint")}
            className="h-10 flex-1 rounded-full bg-white/10 px-4 text-[13.5px] font-medium text-white outline-none placeholder:text-slate-400"
          />
          <button onClick={sendChat} disabled={!chatText.trim()} aria-label={t("chat.send")} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 text-white disabled:opacity-40 active:scale-95">
            <Send className={`h-5 w-5 ${dir === "rtl" ? "-scale-x-100" : ""}`} />
          </button>
        </div>
      )}

      <div className="shrink-0 border-t border-white/10 bg-[#1b1440] px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3">
        {myWant && <p className="mb-2 text-center text-[11.5px] font-bold text-amber-300">{t("meet.waitingHost")}</p>}
        <div className="flex items-center justify-center gap-3">
          <CtrlBtn active={myState === "talking"} pending={myWant === "audio"} onClick={toggleMic} activeCls="bg-emerald-500" label={t("meet.mute")}>
            {myState === "talking" ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
          </CtrlBtn>
          <CtrlBtn active={myVideo} pending={myWant === "video"} onClick={toggleVideo} activeCls="bg-brand-500" label={t("meet.video")}>
            {myVideo ? <Video className="h-6 w-6" /> : <VideoOff className="h-6 w-6" />}
          </CtrlBtn>
          {myVideo && (
            <CtrlBtn active={false} onClick={flipCamera} activeCls="bg-brand-500" label={t("meet.flip")}>
              <SwitchCamera className="h-6 w-6" />
            </CtrlBtn>
          )}
          <CtrlBtn active={myScreen} pending={myWant === "screen"} onClick={toggleScreen} activeCls="bg-violet-500" label={t("meet.screen")}>
            <MonitorUp className="h-6 w-6" />
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

      {/* roster — who's in the room; the host taps someone to grant mic / camera / screen / text */}
      {rosterOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setRosterOpen(false)}>
          <div dir={dir} onClick={(e) => e.stopPropagation()} className="flex max-h-[70dvh] w-full max-w-[480px] flex-col rounded-t-3xl bg-[#241b57]">
            <div className="relative shrink-0 border-b border-white/10 py-3.5 text-center">
              <span className="absolute start-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-white/20" />
              <p className="text-[14.5px] font-extrabold text-white">{t("meet.people")} · {ld(people.length, locale)}/{ld(maxSeats, locale)}</p>
              <button onClick={() => setRosterOpen(false)} aria-label={t("close")} className="absolute end-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-white/10 text-white active:scale-95"><X className="h-4 w-4" /></button>
            </div>
            <div className="no-scrollbar flex-1 overflow-y-auto p-3">
              {people.map((p) => (
                <button key={p.id} onClick={() => { if (amAdmin && !p.host) { setSel(p); setRosterOpen(false); } else router.push(`/business/${p.id}`); }}
                  className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-start hover:bg-white/5">
                  <span className={`relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-[#2c2058] text-[14px] font-extrabold text-white ring-2 ${p.blocked ? "opacity-40 ring-slate-600" : ringFor(p.state)}`}>
                    {p.avatarUrl ? (
                      <img src={p.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      p.name.charAt(0).toUpperCase()
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 truncate text-[13.5px] font-bold text-white">
                      {p.host && <Crown className="h-3.5 w-3.5 text-amber-400" />} {p.name}
                    </span>
                    <span className="text-[11px] font-medium text-slate-400">{t(p.state === "talking" ? "meet.talking" : p.wants ? "meet.wantsTalk" : "meet.muted")}</span>
                  </span>
                  {p.wants && <Hand className="h-4 w-4 shrink-0 text-amber-300" />}
                  {amAdmin && !p.host && <span className="shrink-0 text-[11px] font-bold text-brand-300">{t("meet.manage")}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {inviteOpen && (
        <div dir={dir} className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60" onClick={() => setInviteOpen(false)}>
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[70dvh] w-full max-w-[480px] flex-col rounded-t-3xl bg-white"
          >
            <div className="shrink-0 border-b border-slate-100 py-3.5 text-center">
              <p className="text-[14.5px] font-extrabold text-ink">{t("meet.invite")}</p>
            </div>

            <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-3">
              {follows.length === 0 ? (
                <p className="py-8 text-center text-[13px] font-medium text-muted">{t("post.noFollowing")}</p>
              ) : (
                follows.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => inviteTo(p.id)}
                    className="flex w-full items-center gap-3 py-2.5 text-start active:scale-[0.99]"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-200 text-[13px] font-extrabold text-slate-500">
                      {p.avatarUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={p.avatarUrl} alt="" className="h-10 w-10 object-cover" />
                        : p.displayName.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-ink">{p.displayName}</span>
                    <span className={`shrink-0 rounded-xl px-3 py-1.5 text-[11.5px] font-extrabold ${invited[p.id] ? "bg-emerald-50 text-emerald-600" : "bg-brand-600 text-white"}`}>
                      {invited[p.id] ? t("meet.invited") : t("meet.inviteSend")}
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="shrink-0 border-t border-slate-100 p-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
              <button
                onClick={() => pushLink(`${window.location.origin}/meetings/${id}`)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-100 py-3 text-[13px] font-extrabold text-ink active:scale-95"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Share2 className="h-4 w-4" />}
                {copied ? t("post.copied") : t("post.copyLink")}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {audioBlocked && (
        <div className="fixed inset-x-0 bottom-40 z-[61] flex justify-center px-6">
          <button
            onClick={async () => {
              // The tap itself is what the browser is waiting for.
              await roomRef.current?.startAudio();
              setAudioBlocked(false);
            }}
            className="rounded-full bg-brand-600 px-5 py-3 text-[13px] font-extrabold text-white shadow-lg active:scale-95"
          >
            {t("meet.enableSound")}
          </button>
        </div>
      )}

      {note && (
        <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[60] flex justify-center px-6">
          <div className="rounded-full bg-black/80 px-4 py-2.5 text-[12.5px] font-bold text-white shadow-lg">{note}</div>
        </div>
      )}
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
      {pending && <span className="absolute -top-0.5 -end-0.5 h-3 w-3 animate-pulse rounded-full bg-amber-400 ring-2 ring-[#1b1440]" />}
      {!!badge && badge > 0 && (
        <span className="absolute -top-1 -end-1 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-extrabold text-white ring-2 ring-[#1b1440]">
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
