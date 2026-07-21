"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiGet, apiPost, getAccessToken } from "@/lib/api";
import { getSocket } from "@/lib/socket";
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
  const ringRef = useRef<{ ctx: AudioContext; stop: () => void } | null>(null);

  const stopRing = useCallback(() => {
    ringRef.current?.stop();
    ringRef.current = null;
  }, []);

  // A ringtone made in the browser — no audio file to ship.
  const startRing = useCallback(() => {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      let dead = false;
      const beep = () => {
        if (dead) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 620;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 1);
      };
      beep();
      const iv = setInterval(beep, 2000);
      navigator.vibrate?.([500, 400, 500, 400]);
      ringRef.current = {
        ctx,
        stop: () => { dead = true; clearInterval(iv); navigator.vibrate?.(0); ctx.close().catch(() => {}); },
      };
    } catch { /* audio blocked until the person interacts — the screen still shows */ }
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    let alive = true;
    let sock: { on: (e: string, cb: (p: never) => void) => void; off: (e: string) => void; emit: (e: string, p: unknown) => void } | null = null;

    (async () => {
      const s = await getSocket(token);
      if (!alive) return;
      sock = s;
      sockRef.current = s;

      s.on("call:signal", async (p: { from?: string; type?: string; sdp?: unknown }) => {
        if (!p?.from) return;
        if (p.type === "offer") {
          // already busy? politely refuse
          if (ringRef.current || accepted) { s.emit("call:signal", { to: p.from, type: "end" }); return; }
          const res = await apiGet<{ user: { displayName: string; avatarUrl: string | null } }>(`/api/users/${p.from}`, token);
          setIncoming({
            from: p.from,
            sdp: p.sdp ?? null,
            name: res.ok && res.data?.user ? res.data.user.displayName : "…",
            avatarUrl: res.ok && res.data?.user ? res.data.user.avatarUrl : null,
          });
          startRing();
        }
        if (p.type === "end") { stopRing(); setIncoming(null); }
      });
    })();

    return () => { alive = false; if (sock) sock.off("call:signal"); stopRing(); };
  }, [startRing, stopRing, accepted]);

  // Nobody picked up within 45s → hang up and leave a missed-call notification.
  useEffect(() => {
    if (!incoming) return;
    const to = setTimeout(() => { decline(true); }, 45000);
    return () => clearTimeout(to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  function accept() {
    if (!incoming) return;
    stopRing();
    setAccepted(incoming);
    setIncoming(null);
  }

  function decline(missed = false) {
    if (!incoming) return;
    stopRing();
    sockRef.current?.emit("call:signal", { to: incoming.from, type: "end" });
    if (missed) apiPost("/api/call/missed", { peerId: incoming.from }, getAccessToken() || undefined).catch(() => {});
    setIncoming(null);
  }

  if (accepted) {
    return (
      <CallOverlay
        peerId={accepted.from}
        peerName={accepted.name}
        incomingOffer={accepted.sdp}
        onEnd={() => setAccepted(null)}
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
