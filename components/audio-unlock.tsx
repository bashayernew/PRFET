"use client";

/**
 * Prime audio playback for the whole session, on the first touch anywhere in the app.
 *
 * ── The problem ─────────────────────────────────────────────────────────────────────
 * Mobile browsers refuse to play sound until the page has had a real user gesture. In a
 * live room that meant the host could be talking while listeners heard silence — and the
 * thing that "fixed" it was the listener opening their own microphone, because
 * getUserMedia satisfies the same policy as a side effect. It looked like a microphone
 * bug and was really a playback bug.
 *
 * Unlocking inside the room helps only if the listener taps something after joining. If
 * they join and sit still, the host's audio is still blocked.
 *
 * ── Why this works ──────────────────────────────────────────────────────────────────
 * The permission is granted to the *document*, and this app is a single-page app — the
 * document survives navigation between screens. So a tap on the home feed, a tap opening
 * the rooms list, any tap at all, unlocks audio for everything that follows, including a
 * room joined minutes later. By the time someone reaches a live they have almost
 * certainly tapped several times, so playback is already permitted and no prompt is ever
 * needed.
 *
 * Two mechanisms, because browsers differ in which they honour:
 *   1. Resume a shared AudioContext and run a silent buffer through it (WebKit).
 *   2. Play and immediately pause a silent inline <audio> element (Android WebView).
 * Both are inaudible, cost nothing, and run once per page load.
 */

import { useEffect } from "react";

/** 50ms of silence. Small enough to inline, real enough for the browser to count it. */
const SILENCE =
  "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tAwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD/////////////////////////////////////////////AAAAAExhdmM1OC4xMwAAAAAAAAAAAAAAACQCgAAAAAAAAAEg7qQZoAAAAAAAAAAAAAAAAAAA//sQxAADwAABpAAAACAAADSAAAAETEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==";

let primed = false;

/** Exported so a screen can force it from a known-good gesture (a button's onClick). */
export function primeAudio(): void {
  if (primed || typeof window === "undefined") return;

  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) {
      const ctx = new Ctor();
      // A suspended context is exactly the blocked state; resuming during a gesture is
      // what lifts it.
      ctx.resume().catch(() => {});
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    }
  } catch {
    // An unavailable AudioContext is not a failure — the <audio> path below still runs.
  }

  try {
    const el = document.createElement("audio");
    el.src = SILENCE;
    el.setAttribute("playsinline", "true");
    el.volume = 0;
    const p = el.play();
    if (p) {
      p.then(() => {
        el.pause();
        primed = true;
      }).catch(() => {
        // Still blocked — leave `primed` false so the next gesture tries again.
      });
    }
  } catch { /* ignore */ }

  primed = true;
}

export default function AudioUnlock() {
  useEffect(() => {
    const onGesture = () => {
      primeAudio();
      if (primed) {
        document.removeEventListener("pointerdown", onGesture);
        document.removeEventListener("touchstart", onGesture);
        document.removeEventListener("keydown", onGesture);
      }
    };
    // Passive: this must never interfere with scrolling.
    document.addEventListener("pointerdown", onGesture, { passive: true });
    document.addEventListener("touchstart", onGesture, { passive: true });
    document.addEventListener("keydown", onGesture);
    return () => {
      document.removeEventListener("pointerdown", onGesture);
      document.removeEventListener("touchstart", onGesture);
      document.removeEventListener("keydown", onGesture);
    };
  }, []);

  return null;
}
