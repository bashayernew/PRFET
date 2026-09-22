"use client";

import { useEffect, useRef, useState } from "react";
import { PhoneOff, Mic, MicOff, Volume2, Volume1 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiGet, apiPost, getAccessToken } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { startRingback, setCallSpeaker } from "@/lib/ringtone";

type Signal = { from?: string; type: "offer" | "answer" | "ice" | "end"; sdp?: unknown; candidate?: unknown };

// The native Android shell (Capacitor) exposes helpers on window.PrfetNative. On a phone,
// setSpeakerphone routes the call audio between the loudspeaker and the earpiece via the OS
// AudioManager — the only thing that works inside a WebView. Absent on web / older builds.
type NativeAudio = { setSpeakerphone?: (on: boolean) => void };
const nativeAudio = (): NativeAudio | null =>
  (typeof window !== "undefined" ? ((window as unknown as { PrfetNative?: NativeAudio }).PrfetNative ?? null) : null);

// 1:1 audio call over WebRTC. Signaling flows through the Socket.IO `call:signal` relay.
export default function CallOverlay({
  peerId, peerName, incomingOffer, initialIce, onEnd,
}: { peerId: string; peerName: string; incomingOffer: unknown | null; initialIce?: unknown[]; onEnd: () => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<"connecting" | "ringing" | "in-call" | "failed">(incomingOffer ? "connecting" : "ringing");
  /** The DOMException name when a call can't start — shown under the error so a tester can report it. */
  const [failReason, setFailReason] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  // Whether this device has more than one audio output (i.e. a phone earpiece + speaker).
  const [canSwitchOutput, setCanSwitchOutput] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sockRef = useRef<{ emit: (e: string, p: unknown) => void; on: (e: string, cb: (p: Signal) => void) => void; off: (e: string, cb?: (p: Signal) => void) => void } | null>(null);
  const handlerRef = useRef<((p: Signal) => void) | null>(null);
  /** Re-sends the offer when a callee who answered from a notification comes online. */
  const readyRef = useRef<((p: { from: string }) => void) | null>(null);

  // Parents pass `onEnd` as an inline arrow, so its identity changes on EVERY parent
  // re-render. Keeping it in a ref (instead of the dependency array) stops the whole
  // call from being torn down and restarted whenever the chat screen re-renders.
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  // Candidates the ringing screen collected before this component existed.
  const initialIceRef = useRef(initialIce);

  // When audio actually started, so the call can be logged into the chat with a duration.
  const startedAtRef = useRef<number | null>(null);
  const loggedRef = useRef(false);

  /** Write the finished call into the conversation, exactly once. */
  const logCall = useRef((outgoing: boolean) => {
    if (loggedRef.current) return;
    loggedRef.current = true;
    const seconds = startedAtRef.current ? Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)) : 0;
    apiPost("/api/call/log", { peerId, seconds, outgoing }, getAccessToken() || undefined).catch(() => {});
  }).current;

  useEffect(() => {
    let ended = false;
    (async () => {
      try {
        const token = getAccessToken();
        if (!token) return onEndRef.current();
        const sock = await getSocket(token);
        if (ended) return;
        sockRef.current = sock;
        const { data } = await apiGet<{ iceServers: RTCIceServer[] }>("/api/turn", token);
        if (ended) return;
        const pc = new RTCPeerConnection({ iceServers: data?.iceServers || [{ urls: "stun:stun.l.google.com:19302" }] });
        pcRef.current = pc;

        // Explicit constraints. Plain `{ audio: true }` leaves these to the browser, which
        // on desktop often picks a far-field/array mic with no processing — the "distant,
        // unclear" sound. These force the phone-call style pipeline.
        const local = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
        if (ended) { local.getTracks().forEach((t) => t.stop()); return; }
        localRef.current = local;
        local.getTracks().forEach((t) => pc.addTrack(t, local));

        pc.ontrack = (e) => {
          if (audioRef.current) {
            audioRef.current.srcObject = e.streams[0];
            audioRef.current.volume = 1;
            audioRef.current.play().catch(() => {});
          }
          setStatus("in-call");
          if (!startedAtRef.current) startedAtRef.current = Date.now();
        };
        pc.onicecandidate = (e) => { if (e.candidate) sock.emit("call:signal", { to: peerId, type: "ice", candidate: e.candidate }); };

        /**
         * Report how the media path ends up.
         *
         * A call can pass every step here — mic acquired, offer sent, answer received — and
         * still have no audio, because the two phones never find a route to each other. That
         * shows as "failed" here and as nothing at all in the server log, which is why it
         * kept looking like the answer button was broken.
         */
        pc.onconnectionstatechange = () => {
          const st = pc.connectionState;
          if (st === "connected" || st === "failed" || st === "disconnected") {
            apiPost("/api/call/diag", { stage: "connect", detail: st, peerId }, getAccessToken() || undefined).catch(() => {});
          }
        };

        const onSignal = async (p: Signal) => {
          if (p.from !== peerId) return;
          if (p.type === "answer" && p.sdp) { await pc.setRemoteDescription(p.sdp as RTCSessionDescriptionInit); }
          else if (p.type === "ice" && p.candidate) { try { await pc.addIceCandidate(p.candidate as RTCIceCandidateInit); } catch {} }
          else if (p.type === "end") { logCall(!incomingOffer); cleanup(); onEndRef.current(); }
        };
        handlerRef.current = onSignal as (p: Signal) => void;
        sock.on("call:signal", handlerRef.current);

        if (incomingOffer) {
          await pc.setRemoteDescription(incomingOffer as RTCSessionDescriptionInit);
          // Replay anything that arrived while the phone was still ringing.
          for (const c of initialIceRef.current || []) {
            try { await pc.addIceCandidate(c as RTCIceCandidateInit); } catch {}
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sock.emit("call:signal", { to: peerId, type: "answer", sdp: answer });
        } else {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sock.emit("call:signal", { to: peerId, type: "offer", sdp: offer });
          // Also push an "incoming call" alert, so the callee is notified even if their app
          // is closed and no live socket is there to ring them.
          apiPost("/api/call/ring", { peerId }, getAccessToken() || undefined).catch(() => {});

          /**
           * If their app was closed, the offer above went to nobody — it is relayed live and
           * not stored. Answering the native ringer opens their app, which then announces
           * itself with "call:ready". That is our cue to send the offer a second time, to a
           * socket that now actually exists.
           */
          readyRef.current = async (p: { from: string }) => {
            if (p.from !== peerId || ended) return;
            try {
              const fresh = await pc.createOffer();
              await pc.setLocalDescription(fresh);
              sock.emit("call:signal", { to: peerId, type: "offer", sdp: fresh });
            } catch (e) {
              console.warn("[call] re-offer failed:", e);
            }
          };
          sock.on("call:ready", readyRef.current);
        }
      } catch (err) {
        // Most often: the person blocked the microphone, or there is no mic at all.
        // Without this the promise rejected silently and the call just never started.
        console.error("[call] failed to start:", err);
        // Report it to the server too — see /api/call/diag. This is the only way we get to
        // see a device-side failure on a phone we can't attach a debugger to.
        {
          const e = err as { name?: string; message?: string };
          apiPost("/api/call/diag", {
            stage: "getUserMedia",
            detail: `${e?.name || "unknown"}: ${e?.message || ""}`.slice(0, 300),
            peerId,
          }, getAccessToken() || undefined).catch(() => {});
        }
        // Keep the reason. "Couldn't reach the microphone" is true but useless when a
        // tester reports it: NotAllowedError (permission refused — on Android the app
        // itself may never have been granted RECORD_AUDIO) and NotFoundError (no mic at
        // all) need completely different fixes, and without the name we can't tell which
        // happened on a phone we can't attach a debugger to.
        if (!ended) {
          const e = err as { name?: string; message?: string };
          setFailReason(e?.name || e?.message || "unknown");
          setStatus("failed");
        }
      }
    })();

    function cleanup() {
      ended = true;
      try { pcRef.current?.close(); } catch {}
      localRef.current?.getTracks().forEach((t) => t.stop());
      if (handlerRef.current) sockRef.current?.off("call:signal", handlerRef.current);
      if (readyRef.current) {
        // `off` is typed against the call:signal payload; call:ready carries a different
        // shape on the same socket, so the cast is the narrow, local escape hatch.
        sockRef.current?.off("call:ready", readyRef.current as unknown as (p: Signal) => void);
        readyRef.current = null;
      }
      setCallSpeaker(false); // stop the silent keepalive tone so it never leaks past the call
    }
    return cleanup;
  }, [peerId, incomingOffer]);

  /**
   * Work out whether an earpiece/receiver output exists. Device labels are only readable
   * once mic permission has been granted, which happens as the call starts — so this runs
   * after the call is up rather than on mount.
   */
  useEffect(() => {
    if (status !== "in-call") return;
    let alive = true;
    (async () => {
      try {
        // Native Android build: route audio through the OS AudioManager. This is the ONLY way
        // to actually move sound between the loudspeaker and the earpiece inside a WebView, so
        // when the bridge is present we always enable the toggle and start on the speaker.
        const native = nativeAudio();
        if (native?.setSpeakerphone) {
          if (alive) { setCanSwitchOutput(true); setSpeaker(true); try { native.setSpeakerphone(true); } catch {} }
          return;
        }
        const supported = typeof (audioRef.current as (HTMLAudioElement & { setSinkId?: unknown }) | null)?.setSinkId === "function";
        // No output-device API (iPhone Safari): we can still switch speaker/earpiece via the
        // Web Audio session trick, so enable the toggle. Start on the speaker (matches the
        // button's default state) and let the user drop to the earpiece.
        if (!supported) {
          if (alive) { setCanSwitchOutput(true); setCallSpeaker(true); }
          return;
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outs = devices.filter((d) => d.kind === "audiooutput");
        const hasEarpiece = outs.some((d) => /earpiece|receiver/i.test(d.label));
        // On a phone the earpiece rarely shows a readable label, but the user still needs to be
        // able to turn the speaker off — so enable the toggle on any touch device, not just when
        // a labelled earpiece is found. (On a one-output laptop it stays disabled.)
        const isMobile = typeof navigator !== "undefined" &&
          (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
            (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches));
        if (alive) setCanSwitchOutput(hasEarpiece || isMobile);
      } catch { /* enumeration blocked — leave the toggle disabled */ }
    })();
    return () => { alive = false; };
  }, [status]);

  // Ringback for the caller: the person dialling used to get total silence while the
  // other phone was ringing, with no way to tell the call was actually going through.
  useEffect(() => {
    if (status !== "ringing") return;
    const tone = startRingback();
    return () => tone.stop();
  }, [status]);

  function hangUp() {
    sockRef.current?.emit("call:signal", { to: peerId, type: "end" });
    // The socket "end" above only reaches a phone that HAS a socket. If their app is closed
    // it never arrives and their notification keeps ringing at a call that no longer exists
    // — so also push a silent cancel. Skipped once we're actually talking, since by then
    // they're demonstrably connected.
    if (status !== "in-call") {
      apiPost("/api/call/cancel", { peerId }, getAccessToken() || undefined).catch(() => {});
    }
    logCall(!incomingOffer);
    onEnd();
  }

  /**
   * Mute every local audio track, not just the first one. Some devices expose more than
   * one, and disabling only `[0]` left another live — which is why muting appeared to do
   * nothing. Driving it from `muted` state (rather than reading `track.enabled`) also
   * keeps the button in sync when tracks are replaced.
   */
  function toggleMute() {
    const next = !muted;
    localRef.current?.getAudioTracks().forEach((tr) => { tr.enabled = !next; });
    setMuted(next);
  }

  /**
   * Speaker on/off — only meaningful when the device actually HAS a second output to
   * switch to (a phone earpiece). Laptops and desktops expose one output, so the toggle
   * had nothing to change and appeared permanently stuck on "speaker". We detect that up
   * front and disable the button instead of pretending it does something.
   */
  async function toggleSpeaker() {
    const el = audioRef.current;
    if (!el || !canSwitchOutput) return;
    const next = !speaker;

    // Native Android build: flip the OS speakerphone route — the only reliable way to move
    // audio to/from the earpiece inside a WebView.
    const native = nativeAudio();
    if (native?.setSpeakerphone) {
      try { native.setSpeakerphone(next); } catch {}
      el.muted = false;
      el.play().catch(() => {});
      setSpeaker(next);
      return;
    }

    type SinkAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    const sinkEl = el as SinkAudio;

    if (typeof sinkEl.setSinkId === "function") {
      // Android / desktop: switch the real output device.
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outs = devices.filter((d) => d.kind === "audiooutput");
        const speakerDev = outs.find((d) => /speaker/i.test(d.label)) ?? outs.find((d) => d.deviceId === "default");
        const earDev = outs.find((d) => /earpiece|receiver/i.test(d.label));
        const target = next ? speakerDev : (earDev ?? speakerDev);
        if (target) await sinkEl.setSinkId(target.deviceId);
      } catch { /* device switching unavailable — the OS route stands */ }
    } else {
      // iPhone Safari: no device API — bias the shared audio session toward the speaker
      // (Web Audio active) or the earpiece (Web Audio idle).
      setCallSpeaker(next);
    }

    el.muted = false;
    el.play().catch(() => {});
    setSpeaker(next);
  }

  return (
    <div className="fixed inset-0 z-[60] mx-auto flex max-w-[480px] flex-col items-center justify-center gap-6 bg-gradient-to-b from-brand-700 to-brand-900 text-white">
      <audio ref={audioRef} autoPlay />
      <div className="grid h-28 w-28 place-items-center rounded-full bg-white/15 text-4xl font-extrabold">{peerName.charAt(0)}</div>
      <div className="text-center">
        <p className="text-[20px] font-extrabold">{peerName}</p>
        <p className="mt-1 text-[13px] text-brand-100">
          {status === "failed" ? t("call.micBlocked")
            : status === "in-call" ? t("call.inCall")
            : status === "ringing" ? t("call.ringing")
            : t("call.connecting")}
        </p>
        {status === "failed" && failReason && (
          <p className="mt-1 text-[11px] font-mono text-brand-200/70" dir="ltr">{failReason}</p>
        )}
      </div>
      <div className="mt-4 flex items-center gap-5">
        <button onClick={toggleMute} aria-label={t("call.mute")} className={`grid h-14 w-14 place-items-center rounded-full ${muted ? "bg-white text-brand-700" : "bg-white/15"}`}>
          {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
        </button>
        <button onClick={hangUp} aria-label={t("call.end")} className="grid h-16 w-16 place-items-center rounded-full bg-red-500 active:scale-95">
          <PhoneOff className="h-7 w-7" />
        </button>
        <button
          onClick={toggleSpeaker}
          disabled={!canSwitchOutput}
          aria-label={t("call.speaker")}
          className={`grid h-14 w-14 place-items-center rounded-full transition-opacity ${speaker ? "bg-white text-brand-700" : "bg-white/15"} ${canSwitchOutput ? "" : "opacity-40"}`}
        >
          {speaker ? <Volume2 className="h-6 w-6" /> : <Volume1 className="h-6 w-6" />}
        </button>
      </div>
      <p className="text-[11.5px] font-bold text-brand-100/80">
        {!canSwitchOutput ? t("call.speakerOnly") : speaker ? t("call.speakerOn") : t("call.speakerOff")}
      </p>
    </div>
  );
}
