"use client";

import { useEffect, useRef, useState } from "react";
import { PhoneOff, Mic, MicOff, Volume2, Volume1 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiGet, getAccessToken } from "@/lib/api";
import { getSocket } from "@/lib/socket";

type Signal = { from?: string; type: "offer" | "answer" | "ice" | "end"; sdp?: unknown; candidate?: unknown };

// 1:1 audio call over WebRTC. Signaling flows through the Socket.IO `call:signal` relay.
export default function CallOverlay({
  peerId, peerName, incomingOffer, onEnd,
}: { peerId: string; peerName: string; incomingOffer: unknown | null; onEnd: () => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<"connecting" | "ringing" | "in-call">(incomingOffer ? "connecting" : "ringing");
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sockRef = useRef<{ emit: (e: string, p: unknown) => void; on: (e: string, cb: (p: Signal) => void) => void; off: (e: string, cb?: (p: Signal) => void) => void } | null>(null);
  const handlerRef = useRef<((p: Signal) => void) | null>(null);

  useEffect(() => {
    let ended = false;
    (async () => {
      const token = getAccessToken();
      if (!token) return onEnd();
      const sock = await getSocket(token);
      sockRef.current = sock;
      const { data } = await apiGet<{ iceServers: RTCIceServer[] }>("/api/turn", token);
      const pc = new RTCPeerConnection({ iceServers: data?.iceServers || [{ urls: "stun:stun.l.google.com:19302" }] });
      pcRef.current = pc;

      const local = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (ended) { local.getTracks().forEach((t) => t.stop()); return; }
      localRef.current = local;
      local.getTracks().forEach((t) => pc.addTrack(t, local));

      pc.ontrack = (e) => { if (audioRef.current) { audioRef.current.srcObject = e.streams[0]; audioRef.current.play().catch(() => {}); } setStatus("in-call"); };
      pc.onicecandidate = (e) => { if (e.candidate) sock.emit("call:signal", { to: peerId, type: "ice", candidate: e.candidate }); };

      const onSignal = async (p: Signal) => {
        if (p.from !== peerId) return;
        if (p.type === "answer" && p.sdp) { await pc.setRemoteDescription(p.sdp as RTCSessionDescriptionInit); }
        else if (p.type === "ice" && p.candidate) { try { await pc.addIceCandidate(p.candidate as RTCIceCandidateInit); } catch {} }
        else if (p.type === "end") { cleanup(); onEnd(); }
      };
      handlerRef.current = onSignal as (p: Signal) => void;
      sock.on("call:signal", handlerRef.current);

      if (incomingOffer) {
        await pc.setRemoteDescription(incomingOffer as RTCSessionDescriptionInit);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sock.emit("call:signal", { to: peerId, type: "answer", sdp: answer });
      } else {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sock.emit("call:signal", { to: peerId, type: "offer", sdp: offer });
      }
    })();

    function cleanup() {
      ended = true;
      try { pcRef.current?.close(); } catch {}
      localRef.current?.getTracks().forEach((t) => t.stop());
      if (handlerRef.current) sockRef.current?.off("call:signal", handlerRef.current);
    }
    return cleanup;
  }, [peerId, incomingOffer, onEnd]);

  function hangUp() {
    sockRef.current?.emit("call:signal", { to: peerId, type: "end" });
    onEnd();
  }
  function toggleMute() {
    const track = localRef.current?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setMuted(!track.enabled); }
  }

  /**
   * Speaker on/off.
   * Chrome/Android can switch the output device directly (setSinkId). Safari can't, so we
   * push the call audio through an AudioContext instead, which routes it to the loudspeaker.
   */
  async function toggleSpeaker() {
    const el = audioRef.current;
    if (!el) return;
    const next = !speaker;

    type SinkAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    const sinkEl = el as SinkAudio;

    if (typeof sinkEl.setSinkId === "function") {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outs = devices.filter((d) => d.kind === "audiooutput");
        const speakerDev = outs.find((d) => /speaker/i.test(d.label)) ?? outs.find((d) => d.deviceId === "default");
        const earDev = outs.find((d) => /earpiece|receiver/i.test(d.label));
        const target = next ? speakerDev : (earDev ?? speakerDev);
        if (target) await sinkEl.setSinkId(target.deviceId);
        setSpeaker(next);
        return;
      } catch { /* fall through to the AudioContext route */ }
    }

    try {
      const stream = el.srcObject as MediaStream | null;
      if (!stream) { setSpeaker(next); return; }
      if (next) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = ctxRef.current ?? new Ctx();
        ctxRef.current = ctx;
        await ctx.resume().catch(() => {});
        const src = ctx.createMediaStreamSource(stream);
        src.connect(ctx.destination);
        el.muted = true; // the element would otherwise double up on the earpiece
      } else {
        await ctxRef.current?.close().catch(() => {});
        ctxRef.current = null;
        el.muted = false;
        el.play().catch(() => {});
      }
      setSpeaker(next);
    } catch {
      setSpeaker(next);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] mx-auto flex max-w-[480px] flex-col items-center justify-center gap-6 bg-gradient-to-b from-brand-700 to-brand-900 text-white">
      <audio ref={audioRef} autoPlay />
      <div className="grid h-28 w-28 place-items-center rounded-full bg-white/15 text-4xl font-extrabold">{peerName.charAt(0)}</div>
      <div className="text-center">
        <p className="text-[20px] font-extrabold">{peerName}</p>
        <p className="mt-1 text-[13px] text-brand-100">
          {status === "in-call" ? t("call.inCall") : status === "ringing" ? t("call.ringing") : t("call.connecting")}
        </p>
      </div>
      <div className="mt-4 flex items-center gap-5">
        <button onClick={toggleMute} aria-label={t("call.mute")} className={`grid h-14 w-14 place-items-center rounded-full ${muted ? "bg-white text-brand-700" : "bg-white/15"}`}>
          {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
        </button>
        <button onClick={hangUp} aria-label={t("call.end")} className="grid h-16 w-16 place-items-center rounded-full bg-red-500 active:scale-95">
          <PhoneOff className="h-7 w-7" />
        </button>
        <button onClick={toggleSpeaker} aria-label={t("call.speaker")} className={`grid h-14 w-14 place-items-center rounded-full ${speaker ? "bg-white text-brand-700" : "bg-white/15"}`}>
          {speaker ? <Volume2 className="h-6 w-6" /> : <Volume1 className="h-6 w-6" />}
        </button>
      </div>
      <p className="text-[11.5px] font-bold text-brand-100/80">{speaker ? t("call.speakerOn") : t("call.speakerOff")}</p>
    </div>
  );
}
