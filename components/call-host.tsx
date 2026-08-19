"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiGet, apiPost, getAccessToken } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { startIncomingRing, wireAudioUnlock } from "@/lib/ringtone";
import CallOverlay from "@/components/call-overlay";

type Incoming = { from: string; sdp: unknown; name: string; avatarUrl: string | null };

/**
 * Listens for calls ANYWHERE in the app — not just inside the chat screen — so the phone
 * actually rings wherever the person happens to be, and they can accept or decline.
 */
export default function CallHost() {
  const { t, dir } = useI18n();
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [accepted, setAccepted] = useState<Incoming | null>(null);
  const sockRef = useRef<{ emit: (e: string, p: unknown) => void } | null>(null);
  const ringRef = useRef<{ stop: () => void } | null>(null);
  // Refs mirror the state so the socket handler never reads a stale closure.
  const incomingRef = useRef<Incoming | null>(null);
  const acceptedRef = useRef<Incoming | null>(null);
  const handlerRef = useRef<((p: never) => void) | null>(null);
  /**
   * The caller starts trickling ICE candidates the instant they dial, but the callee has
   * no RTCPeerConnection until Accept is tapped — so those candidates used to be thrown
   * away and the call could never find a route. Hold them here and hand them over.
   */
  const iceBufRef = useRef<unknown[]>([]);
  const [pendingIce, setPendingIce] = useState<unknown[]>([]);

  // Unlock audio on the first gesture anywhere, so the ringtone isn't silenced by the
  // browser's autoplay policy when a call arrives later.
  useEffect(() => { wireAudioUnlock(); }, []);

  const stopRing = useCallback(() => {
    ringRef.current?.stop();
    ringRef.current = null;
  }, []);

  // Ringtone built in the browser — no audio file to ship. Uses the shared, unlocked
  // AudioContext; the old code created a fresh one per call, which the browser started
  // in a suspended state, so the phone rang silently.
  const startRing = useCallback(() => {
    ringRef.current = startIncomingRing();
  }, []);

  /**
   * The root layout mounts this component ONCE and it survives client-side navigation.
   * If the app first loaded while logged out (welcome/login screen) there was no token
   * yet, the listener was never registered, and it never retried — so the phone could
   * never ring for the rest of the session even though chat and presence worked.
   * Track only WHETHER we're signed in (not the token value), so a 15-minute token
   * refresh doesn't tear the listener down mid-ring.
   */
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    const read = () => setAuthed(!!getAccessToken());
    read();
    const iv = setInterval(read, 1500);
    window.addEventListener("focus", read);
    window.addEventListener("storage", read);
    return () => {
      clearInterval(iv);
      window.removeEventListener("focus", read);
      window.removeEventListener("storage", read);
    };
  }, []);

  useEffect(() => {
    if (!authed) return;
    const token = getAccessToken();
    if (!token) return;
    let alive = true;
    let sock: { on: (e: string, cb: (p: never) => void) => void; off: (e: string, cb?: (p: never) => void) => void; emit: (e: string, p: unknown) => void } | null = null;

    (async () => {
      const s = await getSocket(token);
      if (!alive) return;
      sock = s;
      sockRef.current = s;

      const onSignal = async (p: { from?: string; type?: string; sdp?: unknown; candidate?: unknown }) => {
        if (!p?.from) return;

        if (p.type === "offer") {
          // already busy? politely refuse
          if (ringRef.current || acceptedRef.current) { s.emit("call:signal", { to: p.from, type: "end" }); return; }
          iceBufRef.current = [];
          // Show the ringing screen immediately so ICE buffering can start; the name is
          // filled in a moment later once the profile lookup returns.
          const base: Incoming = { from: p.from, sdp: p.sdp ?? null, name: "…", avatarUrl: null };
          incomingRef.current = base;
          setIncoming(base);
          startRing();

          // Read the token fresh — the one captured at mount may have since expired.
          const res = await apiGet<{ user: { displayName: string; avatarUrl: string | null } }>(`/api/users/${p.from}`, getAccessToken() || token);
          if (incomingRef.current?.from !== p.from) return; // answered or cancelled meanwhile
          const filled: Incoming = {
            ...base,
            name: res.ok && res.data?.user ? res.data.user.displayName : "…",
            avatarUrl: res.ok && res.data?.user ? res.data.user.avatarUrl : null,
          };
          incomingRef.current = filled;
          setIncoming(filled);
          return;
        }

        if (p.type === "ice" && p.candidate) {
          // Only while THIS caller is ringing us and the overlay hasn't taken over yet.
          if (incomingRef.current?.from === p.from && !acceptedRef.current && iceBufRef.current.length < 100) {
            iceBufRef.current.push(p.candidate);
          }
          return;
        }

        if (p.type === "end") {
          stopRing();
          incomingRef.current = null;
          iceBufRef.current = [];
          setIncoming(null);
        }
      };

      handlerRef.current = onSignal as unknown as (p: never) => void;
      s.on("call:signal", handlerRef.current);
    })();

    return () => {
      alive = false;
      // Remove ONLY our handler — `off(event)` with no handler would also rip out the
      // one CallOverlay registers on the same shared socket.
      if (sock && handlerRef.current) sock.off("call:signal", handlerRef.current);
      stopRing();
    };
  }, [authed, startRing, stopRing]);

  // Nobody picked up within 45s → hang up and leave a missed-call notification.
  useEffect(() => {
    if (!incoming) return;
    const to = setTimeout(() => { decline(true); }, 45000);
    return () => clearTimeout(to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  function accept() {
    const inc = incomingRef.current;
    if (!inc) return;
    stopRing();
    setPendingIce(iceBufRef.current); // hand the buffered candidates to the overlay
    iceBufRef.current = [];
    acceptedRef.current = inc;
    setAccepted(inc);
    incomingRef.current = null;
    setIncoming(null);
  }

  function decline(missed = false) {
    const inc = incomingRef.current;
    if (!inc) return;
    stopRing();
    sockRef.current?.emit("call:signal", { to: inc.from, type: "end" });
    if (missed) apiPost("/api/call/missed", { peerId: inc.from }, getAccessToken() || undefined).catch(() => {});
    incomingRef.current = null;
    iceBufRef.current = [];
    setIncoming(null);
  }

  if (accepted) {
    return (
      <CallOverlay
        peerId={accepted.from}
        peerName={accepted.name}
        incomingOffer={accepted.sdp}
        initialIce={pendingIce}
        onEnd={() => { acceptedRef.current = null; setAccepted(null); setPendingIce([]); }}
      />
    );
  }

  if (!incoming) return null;

  return (
    <div dir={dir} className="fixed inset-0 z-[70] mx-auto flex max-w-[480px] flex-col items-center justify-center gap-6 bg-gradient-to-b from-brand-700 to-brand-900 text-white">
      <span className="grid h-28 w-28 place-items-center overflow-hidden rounded-full bg-white/15 text-4xl font-extrabold">
        {incoming.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={incoming.avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          incoming.name.charAt(0).toUpperCase()
        )}
      </span>
      <div className="text-center">
        <p className="text-[21px] font-extrabold">{incoming.name}</p>
        <p className="mt-1 animate-pulse text-[13px] font-bold text-brand-100">{t("call.incoming")}</p>
      </div>
      <div className="mt-6 flex items-center gap-10">
        <button onClick={() => decline()} aria-label={t("call.decline")} className="flex flex-col items-center gap-2 active:scale-95">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-red-500"><PhoneOff className="h-7 w-7" /></span>
          <span className="text-[12px] font-bold">{t("call.decline")}</span>
        </button>
        <button onClick={accept} aria-label={t("call.accept")} className="flex flex-col items-center gap-2 active:scale-95">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500"><Phone className="h-7 w-7" /></span>
          <span className="text-[12px] font-bold">{t("call.accept")}</span>
        </button>
      </div>
    </div>
  );
}
