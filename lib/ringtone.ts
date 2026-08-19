"use client";

/**
 * Ringing sounds for calls.
 *
 * Browsers refuse to start an AudioContext until the page has had a user gesture, and a
 * context created before that starts SUSPENDED — which is why the phone could show an
 * incoming call but stay completely silent. We keep ONE context for the whole app, unlock
 * it on the first tap/click/keypress anywhere, and resume it again each time we ring.
 */

let ctx: AudioContext | null = null;
let unlockWired = false;

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/** Call once on app start: the first user gesture unlocks audio for the whole session. */
export function wireAudioUnlock() {
  if (unlockWired || typeof window === "undefined") return;
  unlockWired = true;
  const unlock = () => {
    const c = audioCtx();
    if (c && c.state === "suspended") c.resume().catch(() => {});
  };
  ["pointerdown", "touchstart", "keydown"].forEach((ev) =>
    window.addEventListener(ev, unlock, { passive: true })
  );
}

type Tone = { stop: () => void };

/**
 * Repeating two-tone pattern.
 * `incoming` is the loud ring the person being called hears; the caller hears a quieter,
 * lower ringback so they know it's actually dialling.
 */
function pattern(kind: "incoming" | "ringback"): Tone {
  const c = audioCtx();
  if (!c) return { stop: () => {} };
  c.resume().catch(() => {});

  const freq = kind === "incoming" ? 620 : 440;
  const peak = kind === "incoming" ? 0.25 : 0.08;
  const every = kind === "incoming" ? 2000 : 3000;

  let dead = false;
  const beep = () => {
    if (dead || c.state === "closed") return;
    try {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const now = c.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
      osc.connect(gain).connect(c.destination);
      osc.start(now);
      osc.stop(now + 1);
    } catch { /* context died mid-ring */ }
  };

  beep();
  const iv = setInterval(beep, every);
  if (kind === "incoming") navigator.vibrate?.([500, 400, 500, 400]);

  return {
    stop: () => {
      dead = true;
      clearInterval(iv);
      if (kind === "incoming") navigator.vibrate?.(0);
      // NOTE: never close the shared context — other rings still need it.
    },
  };
}

/**
 * iOS routes ALL page audio to the loudspeaker while a Web Audio context is actively
 * producing sound, and back to the earpiece (the normal call route) when it is idle. We
 * use that on purpose to give calls a working speaker/earpiece switch on iPhone, where no
 * audio-output API exists.
 */
let speakerKeepalive: { stop: () => void } | null = null;

/** Loudspeaker: keep a silent tone running so iOS holds the call on the speaker. */
function holdSpeaker() {
  if (speakerKeepalive) return;
  const c = audioCtx();
  if (!c) return;
  c.resume().catch(() => {});
  try {
    const osc = c.createOscillator();
    const gain = c.createGain();
    gain.gain.value = 0.00001; // inaudible — just enough to keep the context active
    osc.type = "sine";
    osc.frequency.value = 30;
    osc.connect(gain).connect(c.destination);
    osc.start();
    speakerKeepalive = { stop: () => { try { osc.stop(); } catch {} } };
  } catch { /* ignore */ }
}

/** Earpiece: stop the keepalive and idle the context so iOS drops to the normal call route. */
function dropToEarpiece() {
  speakerKeepalive?.stop();
  speakerKeepalive = null;
  if (ctx && ctx.state === "running") ctx.suspend().catch(() => {});
}

/** Route live call audio to the loudspeaker (true) or the earpiece (false). */
export function setCallSpeaker(on: boolean) {
  if (on) holdSpeaker();
  else dropToEarpiece();
}

/** Loud ring for the person receiving a call. */
export function startIncomingRing(): Tone {
  return pattern("incoming");
}

/** Quiet ringback for the person placing a call. */
export function startRingback(): Tone {
  return pattern("ringback");
}
