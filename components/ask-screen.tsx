"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, Send, Sparkles, Trash2, UserRound, ImagePlus, Mic, Volume2, Clapperboard, Download, Crown, Check, X, AudioLines, CreditCard, Paperclip } from "lucide-react";
// Trash2 is reused for removing a saved character from the picker.
import { useI18n } from "@/lib/i18n";
import { apiGet, apiPost, apiDelete, getAccessToken } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";

/**
 * Portraits for the two built-in characters. Drop the files in `public/` and they are
 * served from the site root — no import or rebuild of the image needed.
 */
const CHAR_IMG = { saud: "/saud.png", dana: "/dana.png" } as const;

/** One-time welcome clip, played before a new subscriber picks their character. */
const INTRO_VIDEO = "/welcome.mp4";
const INTRO_KEY = "prfet.ai.intro";

/**
 * Voice chat (talking to the AI, dictation, and read-aloud) is HIDDEN for now.
 * Flip this to `true` to bring it back instantly — all the underlying code stays in place,
 * only the UI entry points are gated by this flag.
 */
const VOICE_CHAT = false;

/**
 * An assistant character: a name, an optional gender, and an optional portrait.
 * `fullBody` remembers that the portrait shows the whole figure, so the live-talk screen
 * can frame it head-to-toe instead of cropping it into a circle.
 */
type Persona = { name: string; gender: "male" | "female" | ""; avatar?: string; fullBody?: boolean };

/**
 * Decide whether an uploaded photo is a full-body shot from its shape alone.
 * Taller than 1.3:1 is the usual giveaway for a standing figure; face photos and selfies
 * are square-ish or landscape. Crude, but it needs no extra model call and no cost.
 */
function isFullBody(dataUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve(img.height / img.width >= 1.3);
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

/** Characters the person created, kept on the device so they can be reused. */
const SAVED_KEY = "prfet.ai.characters";
const MAX_SAVED = 12;

/** The slice of a post the assistant needs in order to review it. */
type EvalPost = {
  id: string;
  kind: string;
  caption: string | null;
  views: number;
  likes: number;
  comments: number;
  reposts: number;
  createdAt: string;
  user: { displayName: string };
};

/**
 * Turn a post into a review request.
 *
 * The model can't see the picture or video, so the prompt says so plainly and asks it to
 * work from the caption and the engagement numbers instead of inventing an opinion about
 * imagery it has never seen.
 */
function buildEvalPrompt(p: EvalPost, t: (k: string) => string): string {
  const rate = p.views > 0 ? ((p.likes / p.views) * 100).toFixed(1) : "0";
  return [
    t("ask.evalAsk"),
    "",
    `- ${t("ask.evalKind")}: ${p.kind}`,
    `- ${t("ask.evalAuthor")}: ${p.user.displayName}`,
    `- ${t("ask.evalCaption")}: ${p.caption?.trim() || t("ask.evalNoCaption")}`,
    `- ${t("ask.evalViews")}: ${p.views}`,
    `- ${t("ask.evalLikes")}: ${p.likes} (${rate}%)`,
    `- ${t("ask.evalComments")}: ${p.comments}`,
    `- ${t("ask.evalReposts")}: ${p.reposts}`,
    `- ${t("ask.evalPosted")}: ${p.createdAt}`,
    "",
    t("ask.evalRules"),
  ].join("\n");
}

type Msg = { id: string; role: "user" | "model"; body: string; imageUrl?: string; videoUrl?: string };
/** Break a reply into short, sentence-ish chunks so each speaks fast and never times out. */
function splitForSpeech(text: string, max = 220): string[] {
  const out: string[] = [];
  let buf = "";
  for (const tk of text.split(/(\s+)/)) {
    if ((buf + tk).length > max && buf.trim()) { out.push(buf.trim()); buf = ""; }
    buf += tk;
    // flush at a natural sentence end (Latin + Arabic punctuation)
    if (/[.!?،؛؟…\n]\s*$/.test(buf) && buf.trim().length > 40) { out.push(buf.trim()); buf = ""; }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.length ? out : [text];
}

type Status = null | "disabled" | "premium_only" | "unconfigured";
type Cap = { unlimited: boolean; cap: number; used: number; remaining: number };
type Usage = { isPremium: boolean; tier: string; messages: Cap; images: Cap; videos: Cap; voiceMin: Cap; storageGb: Cap };

// Minimal shape of the browser SpeechRecognition API (not in the TS DOM lib by default).
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

/**
 * Pick a system voice that matches the character's gender and language, so Dana sounds
 * female and Saud sounds male when the device offers gendered voices. Best-effort: the
 * Web Speech API doesn't expose gender, so we match on the voice name, then fall back to
 * any voice in the right language, then the browser default.
 */
function pickVoice(voices: SpeechSynthesisVoice[], gender: "male" | "female" | "" | undefined, lang: string): SpeechSynthesisVoice | undefined {
  if (!voices || voices.length === 0) return undefined;
  const base = (lang || "en").slice(0, 2).toLowerCase();
  const inLang = voices.filter((v) => v.lang?.toLowerCase().startsWith(base));
  const pool = inLang.length ? inLang : voices;

  const female = /female|woman|zira|samantha|karen|fiona|hoda|salma|amira|laila|zeina|susan|serena|tessa|moira|joana|luciana/i;
  const male = /male|man|david|daniel|fred|rishi|george|oliver|majed|tarik|maged|diego|jorge/i;
  // The good-sounding voices: Google's, Apple's Siri, and Microsoft's "Natural/Online" set.
  const quality = /google|natural|neural|enhanced|premium|siri|online|wavenet/i;

  const wantG = gender === "female" ? female : gender === "male" ? male : null;
  const avoidG = gender === "female" ? male : gender === "male" ? female : null;

  const score = (v: SpeechSynthesisVoice) => {
    let s = 0;
    if (quality.test(v.name)) s += 5;   // strongly prefer the natural-sounding voices
    if (!v.localService) s += 2;        // network voices generally sound better
    if (wantG && wantG.test(v.name)) s += 4; // right gender
    if (avoidG && avoidG.test(v.name)) s -= 6; // wrong gender — push it down hard
    return s;
  };
  return [...pool].sort((a, b) => score(b) - score(a))[0];
}

// Save a generated image/video (a data URL) to the device. Converting to a Blob first
// keeps large videos reliable, where a plain data-URL link can fail on some browsers.
function downloadMedia(url: string, filename: string): void {
  if (typeof window === "undefined") return;
  fetch(url).then((r) => r.blob()).then((b) => {
    const u = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = u; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 1500);
  }).catch(() => {});
}

// Does a typed message clearly ask the assistant to CREATE a picture? (English + Arabic)
function wantsImage(s: string): boolean {
  const media = /(image|images|picture|photo|photos|pic|pics|drawing|painting|wallpaper|logo|صورة|صوره|صور|رسمة|رسمه|رسم|شعار|خلفية)/i;
  const verb = /(create|make|generate|draw|paint|design|render|produce|show me|give me|make me|i want|i need|can you|اصنع|اعمل|ارسم|صمم|سوي|سو|ابغى|ابي|اريد|انشئ|اعملي|سويلي|ابغا)/i;
  return media.test(s) && verb.test(s);
}
// Does a typed message clearly ask for a short VIDEO/clip?
function wantsVideo(s: string): boolean {
  const media = /(video|videos|clip|clips|animation|movie|فيديو|فيديوهات|مقطع|مقاطع)/i;
  const verb = /(create|make|generate|render|produce|show me|give me|make me|i want|i need|can you|اصنع|اعمل|صمم|سوي|سو|ابغى|ابي|اريد|انشئ|اعملي|سويلي|ابغا)/i;
  return media.test(s) && verb.test(s);
}

// A tiny silent WAV — played during a tap to "unlock" audio playback on iOS, so the
// natural voice can start later even though it arrives after a network call.
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";

/** Strip markdown so it isn't read aloud as "star star bold star star". */
function cleanForSpeech(text: string): string {
  return text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/^\s*[*-]\s+/gm, "").replace(/[*_`#]/g, "").trim();
}

export default function AskScreen() {
  const router = useRouter();
  const { t, dir } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [err, setErr] = useState<string | null>(null);
  // live allowance ("how much is left") + the "you hit your limit" prompt
  const [usage, setUsage] = useState<Usage | null>(null);
  const [capHit, setCapHit] = useState<null | "messages" | "images" | "videos" | "voice">(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // chosen AI character (persona) — a name + optional gender, saved on the device
  const [persona, setPersona] = useState<Persona | null>(null);
  const [personaReady, setPersonaReady] = useState(false); // localStorage read done
  /** Characters this person has created before — shown on the picker next to Saud & Dana. */
  const [saved, setSaved] = useState<Persona[]>([]);
  const [customName, setCustomName] = useState("");
  const [customGender, setCustomGender] = useState<"male" | "female">("female"); // voice for a custom character
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false); // the plans & pricing sheet
  // Plan prices + per-tier limits for the plans sheet — pulled live from the dashboard settings.
  const [plan, setPlan] = useState({
    vipPrice: 10.99, basicPrice: 5.99, addonPrice: 1.99,
    vImages: 100, vVideos: 20, vMessages: 7500, vVoice: 480, vStorage: 50,
    gImages: 35, gVideos: 9, gMessages: 4000, gVoice: 2000, gStorage: 25,
  });
  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => {
      const s = d?.settings ?? {};
      const n = (x: unknown, def: number) => (typeof x === "number" ? x : def);
      setPlan({
        vipPrice: n(s.priceVip, 10.99), basicPrice: n(s.priceSubscription, 5.99), addonPrice: n(s.priceAddonMedia, 1.99),
        vImages: n(s.aiImagesVip, 100), vVideos: n(s.aiVideosVip, 20), vMessages: n(s.aiMessagesVip, 7500), vVoice: n(s.callMinutesVip, 480), vStorage: n(s.storageGbVip, 50),
        gImages: n(s.aiImagesBasic, 35), gVideos: n(s.aiVideosBasic, 9), gMessages: n(s.aiMessagesBasic, 4000), gVoice: n(s.callMinutesBasic, 2000), gStorage: n(s.storageGbBasic, 25),
      });
    }).catch(() => {});
  }, []);
  const fillPlan = (str: string, vars: Record<string, number | string>) =>
    Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), str);
  /**
   * One-time welcome video, shown before the character picker and NOT skippable — it has
   * to play to the end. Remembered per device, alongside the persona choice.
   */
  const [introDone, setIntroDone] = useState(false);
  const [introReady, setIntroReady] = useState(false); // localStorage read done
  useEffect(() => {
    try { setIntroDone(localStorage.getItem(INTRO_KEY) === "1"); } catch { setIntroDone(true); }
    setIntroReady(true);
  }, []);
  // Persist "seen" as soon as it STARTS (not only on end), so leaving mid-video never replays it (#10/#11).
  function markIntroSeen() {
    try { localStorage.setItem(INTRO_KEY, "1"); } catch { /* private mode — show once per session */ }
  }
  function finishIntro() {
    markIntroSeen();
    setIntroDone(true);
  }
  // voice: speak replies aloud + dictate questions (browser Web Speech API — free)
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  // Warm up the speech-synthesis voice list (some browsers load it asynchronously).
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.getVoices();
    const onChange = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", onChange);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", onChange);
  }, []);

  // Natural voice: a reusable <audio> for the Gemini TTS clip, plus a sequence counter so a
  // reply that was interrupted mid-fetch never plays late over a newer one.
  const ttsRef = useRef<HTMLAudioElement | null>(null);
  const audioPrimed = useRef(false);
  const speakSeq = useRef(0);
  function ensureAudio(): HTMLAudioElement | null {
    if (typeof window === "undefined") return null;
    if (!ttsRef.current) ttsRef.current = new Audio();
    return ttsRef.current;
  }
  /** Unlock speech + audio during a real tap (iOS blocks both otherwise). */
  function primeSpeech() {
    if (typeof window !== "undefined" && window.speechSynthesis && !audioPrimed.current) {
      try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; window.speechSynthesis.speak(u); } catch { /* ignore */ }
    }
    if (!audioPrimed.current) {
      const a = ensureAudio();
      if (a) { try { a.src = SILENT_WAV; const p = a.play(); if (p) p.then(() => a.pause()).catch(() => {}); } catch { /* ignore */ } }
      audioPrimed.current = true;
    }
  }
  /** Stop whatever is speaking (natural audio or the browser voice) and invalidate pending TTS. */
  function stopSpeaking() {
    speakSeq.current++;
    try { const a = ttsRef.current; if (a) { a.pause(); a.onended = null; } } catch { /* ignore */ }
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  }

  /** Browser text-to-speech — the fallback when the natural voice can't be fetched. */
  function browserSpeak(spoken: string, onDone?: () => void) {
    if (typeof window === "undefined" || !window.speechSynthesis) { onDone?.(); return; }
    try { window.speechSynthesis.resume(); } catch { /* ignore */ }
    const u = new SpeechSynthesisUtterance(spoken);
    u.lang = dir === "rtl" ? "ar-SA" : "en-US";
    const v = pickVoice(window.speechSynthesis.getVoices(), persona?.gender, u.lang);
    if (v) u.voice = v;
    u.onend = () => onDone?.();
    u.onerror = () => onDone?.();
    window.speechSynthesis.speak(u);
  }

  /**
   * Speak text in the natural Gemini voice. The reply is split into short sentence chunks
   * and each is synthesised + played in turn, so the FIRST words start almost immediately
   * (low latency) and a long reply never times out into the robotic browser voice — the
   * natural voice carries the whole message. A genuine failure on one chunk falls back to
   * the browser voice for that chunk only. Running out of monthly voice minutes stops
   * everything and shows the renew / add-ons prompt (no robotic fallback).
   */
  async function playTts(text: string, onDone?: () => void, opts?: { live?: boolean }) {
    const spoken = cleanForSpeech(text) || text;
    const seq = ++speakSeq.current;
    const chunks = splitForSpeech(spoken);
    const token = getAccessToken() || undefined;
    let i = 0;

    const playNext = async () => {
      if (seq !== speakSeq.current) return; // superseded / stopped
      if (i >= chunks.length) { onDone?.(); return; }
      const chunk = chunks[i++];
      try {
        const res = await apiPost<{ url?: string; error?: string }>("/api/ai/tts", {
          text: chunk,
          ...(persona?.gender ? { gender: persona.gender } : {}),
          ...(opts?.live ? { meter: false } : {}), // live mode meters time via the heartbeat instead
        }, token);
        if (seq !== speakSeq.current) return;
        if (res.data?.error === "voice_limit") {
          stopSpeaking(); stopLive(); setCapHit("voice"); refreshUsage();
          return;
        }
        if (res.ok && res.data?.url) {
          const a = ensureAudio();
          if (!a) { browserSpeak(chunk, playNext); return; }
          a.src = res.data.url;
          a.onended = () => { if (seq === speakSeq.current) playNext(); };
          a.onerror = () => { if (seq === speakSeq.current) browserSpeak(chunk, playNext); };
          const p = a.play();
          if (p) p.catch(() => { if (seq === speakSeq.current) browserSpeak(chunk, playNext); });
          return;
        }
      } catch { /* network/API failed for this chunk */ }
      if (seq === speakSeq.current) browserSpeak(chunk, playNext); // this chunk only
    };

    playNext();
  }

  function speak(m: Msg) {
    primeSpeech(); // this one IS a tap, so it doubles as the unlock
    if (speakingId === m.id) { stopSpeaking(); setSpeakingId(null); return; }
    stopSpeaking();
    setSpeakingId(m.id);
    playTts(m.body, () => setSpeakingId(null));
  }

  function toggleMic() {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) { setErr(t("ask.voiceUnsupported")); return; }
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const rec = new Ctor();
    rec.lang = dir === "rtl" ? "ar-SA" : "en-US";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const txt = e.results?.[0]?.[0]?.transcript || "";
      if (txt) setInput((v) => (v ? v + " " : "") + txt);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { setListening(false); }
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem("prfet.aiPersona");
      if (raw) setPersona(JSON.parse(raw));
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      if (raw) setSaved(JSON.parse(raw));
    } catch { /* ignore */ }
    setPersonaReady(true);
  }, []);

  /**
   * Remember a character the person made, so it appears alongside Saud and Dana next time
   * instead of being lost the moment they switch. Keyed by name (case-insensitive), so
   * generating a new face for an existing character updates it rather than duplicating.
   */
  function rememberCharacter(p: Persona) {
    if (!p.name.trim()) return; // the plain assistant isn't a character
    setSaved((list) => {
      const next = [p, ...list.filter((c) => c.name.trim().toLowerCase() !== p.name.trim().toLowerCase())]
        .slice(0, MAX_SAVED);
      try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function forgetCharacter(name: string) {
    setSaved((list) => {
      const next = list.filter((c) => c.name !== name);
      try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function choosePersona(p: Persona) {
    setPersona(p);
    try { localStorage.setItem("prfet.aiPersona", JSON.stringify(p)); } catch { /* ignore */ }
    // Only custom characters go in the library — Saud and Dana are always on the page.
    if (p.name && p.name !== t("ask.char.saud") && p.name !== t("ask.char.dana")) rememberCharacter(p);
  }

  // Generate a portrait face for the current character (paid image engine).
  async function genAvatar() {
    if (!persona || avatarBusy) return;
    setAvatarBusy(true);
    setErr(null);
    const g = persona.gender === "female" ? "woman" : persona.gender === "male" ? "man" : "person";
    const prompt = `A friendly, warm portrait headshot of a ${g} named ${persona.name || "assistant"}, soft studio lighting, centered face, professional avatar, high detail`;
    const token = getAccessToken() || undefined;
    const res = await apiPost<{ url?: string; error?: string }>("/api/ai/image", { prompt }, token);
    setAvatarBusy(false);
    if (res.ok && res.data?.url) {
      choosePersona({ ...persona, avatar: res.data.url });
    } else {
      setErr(t("ask.imgFailed"));
    }
  }

  // Make a character avatar that resembles an uploaded photo (paid image engine).
  const photoRef = useRef<HTMLInputElement>(null);
  function resizeToDataUrl(file: File, max = 512): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(max / img.width, max / img.height, 1);
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const ctx = c.getContext("2d");
        if (!ctx) { reject(new Error("no ctx")); return; }
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = url;
    });
  }
  async function avatarFromPhoto(file: File) {
    if (avatarBusy) return;
    setAvatarBusy(true);
    setErr(null);
    try {
      const dataUrl = await resizeToDataUrl(file);
      const name = customName.trim() || persona?.name || t("ask.char.custom");
      const token = getAccessToken() || undefined;

      /**
       * Match the framing of what they uploaded. A full-body photo used to come back as a
       * cropped headshot, which threw away exactly what they'd chosen to show. Portrait-ish
       * aspect ratios (clearly taller than wide) are treated as full-body shots.
       */
      const full = await isFullBody(dataUrl);
      const prompt = full
        ? "Create a friendly, warm FULL-BODY character portrait that clearly resembles the person in this photo — head to feet, whole figure visible, natural standing pose, keep their outfit and build. Clean soft background, high quality."
        : "Create a friendly, warm portrait avatar that clearly resembles the person in this photo. Clean soft background, centered face, high quality.";

      const res = await apiPost<{ url?: string }>("/api/ai/image", { prompt, image: dataUrl }, token);
      // Voice follows the gender chosen in the picker (male/female toggle above).
      if (res.ok && res.data?.url) choosePersona({ name, gender: persona?.gender || customGender, avatar: res.data.url, fullBody: full });
      else setErr(t("ask.imgFailed"));
    } catch { setErr(t("ask.imgFailed")); }
    setAvatarBusy(false);
  }

  /* ===== Live talk: full-screen avatar, hands-free back-and-forth =====
   *
   * A loop of: listen → send → speak the reply → listen again. Uses the browser's own
   * speech recognition and synthesis (free, no extra API), so the only cost is the normal
   * text request. Speaking and listening never overlap — otherwise the microphone hears
   * the assistant's own voice and answers itself.
   */
  const [live, setLive] = useState(false);
  const [liveState, setLiveState] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [liveText, setLiveText] = useState("");   // what the assistant just said
  const [liveHeard, setLiveHeard] = useState(""); // what we heard from the person
  const liveRef = useRef(false); // read inside callbacks, where `live` would be stale
  const voiceTickRef = useRef<ReturnType<typeof setInterval> | null>(null); // live-voice metering heartbeat

  function stopLive() {
    liveRef.current = false;
    setLive(false);
    setLiveState("idle");
    if (voiceTickRef.current) { clearInterval(voiceTickRef.current); voiceTickRef.current = null; }
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    stopSpeaking();
  }

  // Fix #3/#18: release the microphone whenever the screen is left or the app is backgrounded,
  // so recording never lingers. Covers leaving the AI page and the OS sending the app to background.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        stopLive();
        try { recRef.current?.stop(); } catch { /* already stopped */ }
        setListening(false);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stopLive();
      try { recRef.current?.stop(); } catch { /* already stopped */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Cut the assistant off and go straight back to listening (tap-to-interrupt). */
  function interruptLive() {
    if (!liveRef.current) return;
    stopSpeaking();
    setLiveText("");
    liveListen();
  }

  /** Listen for one utterance, then hand it to the assistant. */
  function liveListen() {
    if (!liveRef.current) return;
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) { setErr(t("ask.voiceUnsupported")); stopLive(); return; }

    const rec = new Ctor();
    rec.lang = dir === "rtl" ? "ar-SA" : "en-US";
    rec.interimResults = false;
    let heard = "";
    rec.onresult = (e) => { heard = e.results?.[0]?.[0]?.transcript || ""; };
    rec.onerror = () => { /* handled by onend */ };
    rec.onend = () => {
      if (!liveRef.current) return;
      if (!heard.trim()) { liveListen(); return; } // silence — just keep listening
      setLiveHeard(heard);
      liveAsk(heard);
    };
    recRef.current = rec;
    setLiveState("listening");
    try { rec.start(); } catch { stopLive(); }
  }

  /** Send what we heard, speak the answer, then listen again. */
  async function liveAsk(text: string) {
    setLiveState("thinking");
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", body: text }]);
    const token = getAccessToken() || undefined;
    const res = await apiPost<{ reply?: Msg; error?: string }>("/api/ai/chat", {
      message: text,
      ...(persona?.name ? { persona: persona.name, ...(persona.gender ? { personaGender: persona.gender } : {}) } : {}),
    }, token);

    if (!liveRef.current) return;
    if (!res.ok || !res.data?.reply) {
      if (res.data?.error === "premium_only") { stopLive(); setStatus("premium_only"); return; }
      if (res.data?.error === "msg_limit") { setCapHit("messages"); refreshUsage(); stopLive(); return; }
      // A transient failure (timeout, one bad turn, token hiccup) shouldn't drop the whole voice
      // session — skip this turn and go back to listening so the conversation keeps going.
      if (liveRef.current) { setLiveState("listening"); setTimeout(() => { if (liveRef.current) liveListen(); }, 500); }
      return;
    }

    const reply = res.data.reply;
    setMessages((m) => [...m, reply]);
    setLiveText(reply.body);
    setLiveState("speaking");
    // Speak the answer, then go back to listening. We deliberately do NOT open a second
    // microphone while speaking (barge-in): iOS Safari only allows one recogniser at a time
    // and the overlap left the mic hung. Tapping the screen still interrupts (interruptLive).
    playTts(reply.body, () => {
      if (liveRef.current) setTimeout(() => { if (liveRef.current) liveListen(); }, 350);
    }, { live: true });
  }

  function startLive() {
    if (status) return;
    primeSpeech(); // must happen inside the tap, before any await
    setErr(null);
    setLiveText("");
    setLiveHeard("");
    liveRef.current = true;
    setLive(true);
    // Heartbeat: charge the monthly voice cap for the TIME spent talking (see /api/ai/voice-tick).
    if (voiceTickRef.current) clearInterval(voiceTickRef.current);
    voiceTickRef.current = setInterval(() => {
      apiPost<{ error?: string }>("/api/ai/voice-tick", { seconds: 15 }, getAccessToken() || undefined)
        .then((res) => { if (!res.ok && res.data?.error === "voice_limit") { stopLive(); setCapHit("voice"); refreshUsage(); } })
        .catch(() => {});
    }, 15000);
    liveListen();
  }

  // Never leave the microphone or the voice running when the screen goes away.
  useEffect(() => () => { liveRef.current = false; stopSpeaking(); }, []);

  // one-tap starters — pure Gemini text, no extra services
  const quickKeys = ["cv", "ad", "survey", "translate", "advice"] as const;
  function useQuick(k: (typeof quickKeys)[number]) {
    setInput(t(`ask.q.${k}`));
    setErr(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  // Pull the member's remaining allowance so we can show "X left" and warn before they run out.
  async function refreshUsage() {
    const res = await apiGet<Usage>("/api/ai/usage", getAccessToken() || undefined);
    if (res.ok && res.data) setUsage(res.data);
  }

  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken() || undefined;
    apiGet<{ configured: boolean; messages: Msg[]; error?: string }>("/api/ai/chat", token).then((res) => {
      if (res.ok && res.data) {
        setMessages(res.data.messages || []);
        if (!res.data.configured) setStatus("unconfigured");
      } else if (res.data?.error === "disabled") setStatus("disabled");
      else if (res.data?.error === "premium_only") setStatus("premium_only");
    });
    refreshUsage();
  }, [ready]);

  /**
   * Arriving from a post's "Ask PRFET about this post" button (/ask?post=<id>).
   * Loads that post, then asks the model to evaluate it — automatically, so the person
   * lands straight on the answer instead of having to type anything.
   *
   * Read straight off window.location rather than useSearchParams(): that hook forces the
   * whole page into a Suspense boundary in the App Router, and this is a one-shot read.
   */
  const postAskedRef = useRef(false);
  useEffect(() => {
    if (!ready || status || postAskedRef.current) return;
    if (!personaReady) return;          // wait for the character to be resolved
    if (!introReady || !introDone) return; // let the welcome video finish first

    const id = new URLSearchParams(window.location.search).get("post");
    if (!id) return;
    postAskedRef.current = true;

    (async () => {
      const token = getAccessToken() || undefined;
      const res = await apiGet<{ post?: EvalPost }>(`/api/posts/${id}`, token);
      if (!res.ok || !res.data?.post) { setErr(t("ask.postGone")); return; }
      sendText(buildEvalPrompt(res.data.post, t));
      // Drop the query string so a refresh doesn't re-run the evaluation.
      window.history.replaceState({}, "", "/ask");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, status, personaReady, introReady, introDone]);

  // keep the view pinned to the newest message
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if ((!text && !pendingImg) || sending || status) return;
    // With an image attached we always chat (vision) — never trigger image/video generation.
    if (!pendingImg) {
      if (wantsVideo(text)) { setInput(""); genVideo(text); return; }
      if (wantsImage(text)) { setInput(""); genImage(text); return; }
    }
    const img = pendingImg;
    setInput("");
    setPendingImg(null);
    sendText(text, img || undefined);
  }

  /** Send a message that didn't come from the input box (e.g. a post evaluation). */
  async function sendText(text: string, image?: { data: string; mime: string; url: string }) {
    if ((!text && !image) || sending || status) return;
    setErr(null);
    const temp: Msg = { id: `tmp-${Date.now()}`, role: "user", body: text, ...(image ? { imageUrl: image.url } : {}) };
    setMessages((m) => [...m, temp]);
    setSending(true);
    const token = getAccessToken() || undefined;
    const res = await apiPost<{ reply?: Msg; error?: string }>("/api/ai/chat", {
      message: text || (dir === "rtl" ? "صف هذه الصورة من فضلك." : "Describe this image."),
      ...(persona?.name ? { persona: persona.name, ...(persona.gender ? { personaGender: persona.gender } : {}) } : {}),
      ...(image ? { image: { data: image.data, mime: image.mime } } : {}),
    }, token);
    setSending(false);
    if (res.ok && res.data?.reply) {
      setMessages((m) => [...m, res.data.reply as Msg]);
      refreshUsage();
    } else {
      const e = res.data?.error;
      // A free member hitting the paywall gets the subscribe screen, not an error line.
      if (e === "premium_only") { setStatus("premium_only"); return; }
      if (e === "msg_limit") { setCapHit("messages"); refreshUsage(); return; }
      setErr(e === "rate_limited" || e === "quota" ? t("ask.quota") : t("ask.error"));
    }
  }

  // Attach a photo to SEND to the AI so it can see it — multimodal vision (#9). Separate from
  // the image GENERATION below.
  const [pendingImg, setPendingImg] = useState<{ data: string; mime: string; url: string } | null>(null);
  const attachRef = useRef<HTMLInputElement | null>(null);
  function attachPhoto(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      const data = url.split(",")[1] || ""; // strip the "data:...;base64," prefix for the API
      if (data) setPendingImg({ data, mime: file.type || "image/jpeg", url });
    };
    reader.readAsDataURL(file);
  }

  // Generate an image from the current input (paid Imagen via Gemini).
  const [imgBusy, setImgBusy] = useState(false);
  async function genImage(promptArg?: string) {
    const prompt = (promptArg ?? input).trim();
    if (imgBusy || vidBusy || sending || status) return;
    if (!prompt) { setErr(t("ask.typeFirst")); inputRef.current?.focus(); return; }
    setErr(null);
    setInput("");
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", body: prompt }]);
    setImgBusy(true);
    const token = getAccessToken() || undefined;
    const res = await apiPost<{ url?: string; error?: string }>("/api/ai/image", { prompt }, token);
    setImgBusy(false);
    if (res.ok && res.data?.url) {
      setMessages((m) => [...m, { id: `img-${Date.now()}`, role: "model", body: "", imageUrl: res.data.url }]);
      refreshUsage();
    } else {
      const e = res.data?.error;
      if (e === "premium_only") { setStatus("premium_only"); return; }
      if (e === "limit_reached") { setCapHit("images"); refreshUsage(); return; }
      setErr(e === "rate_limited" || e === "quota" ? t("ask.quota") : t("ask.imgFailed"));
    }
  }

  // Generate a video from the current input (paid Veo — async, ~1–2 min).
  const [vidBusy, setVidBusy] = useState(false);
  async function genVideo(promptArg?: string) {
    const prompt = (promptArg ?? input).trim();
    if (vidBusy || imgBusy || sending || status) return;
    if (!prompt) { setErr(t("ask.typeFirst")); inputRef.current?.focus(); return; }
    setErr(null);
    setInput("");
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", body: prompt }]);
    setVidBusy(true);
    const token = getAccessToken() || undefined;
    const start = await apiPost<{ op?: string; error?: string }>("/api/ai/video", { prompt }, token);
    if (!start.ok || !start.data?.op) {
      setVidBusy(false);
      if (start.data?.error === "premium_only") { setStatus("premium_only"); return; }
      if (start.data?.error === "limit_reached") { setCapHit("videos"); refreshUsage(); return; }
      setErr(start.data?.error === "rate_limited" || start.data?.error === "quota" ? t("ask.quota") : t("ask.vidFailed"));
      return;
    }
    const op = start.data.op;
    let tries = 0;
    const poll = async () => {
      tries += 1;
      const p = await apiGet<{ done?: boolean; url?: string; error?: string }>(`/api/ai/video?op=${encodeURIComponent(op)}`, token);
      if (p.ok && p.data?.done && p.data.url) {
        setMessages((m) => [...m, { id: `vid-${Date.now()}`, role: "model", body: "", videoUrl: p.data!.url }]);
        setVidBusy(false);
        refreshUsage();
        return;
      }
      if (!p.ok || tries > 50) { setVidBusy(false); setErr(t("ask.vidFailed")); return; }
      setTimeout(poll, 6000);
    };
    setTimeout(poll, 6000);
  }

  async function clearChat() {
    if (!confirm(t("ask.clearConfirm"))) return;
    const token = getAccessToken() || undefined;
    await apiDelete("/api/ai/chat", token);
    setMessages([]);
    setErr(null);
  }

  if (!ready) return null;

  const gateMsg =
    status === "disabled" ? t("ask.disabled")
    : status === "premium_only" ? t("ask.premiumOnly")
    : status === "unconfigured" ? t("ask.unconfigured")
    : null;

  // The welcome video comes FIRST — only subscribers get this far, and it plays once.
  const needIntro = introReady && !introDone && !gateMsg;

  // ask the user who they want to talk to, before the first chat
  const needPicker = personaReady && !persona && !gateMsg && !needIntro;

  // ===== live talk — the avatar fills the screen and you just speak =====
  if (live) {
    return (
      <div dir={dir} className="fixed inset-0 z-[70] overflow-hidden bg-black">
        {/* The avatar IS the screen — edge to edge, behind everything else. */}
        {persona?.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={persona.avatar}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover ${liveState === "speaking" ? "avatar-talking" : "avatar-idle"}`}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-brand-900 to-black">
            <Sparkles className="h-24 w-24 text-brand-300" />
          </div>
        )}

        {/* Gradients top and bottom so the text stays readable over any photo. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-black/75 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/85 via-black/55 to-transparent" />

        {/* Tap anywhere while it's talking to cut it off and speak — a reliable interrupt
            that works even where voice barge-in can't (e.g. no echo cancellation). */}
        {liveState === "speaking" && (
          <button onClick={interruptLive} aria-label={t("ask.liveInterrupt")} className="absolute inset-0 z-0" />
        )}

        {/* name + what it's doing */}
        <div className="absolute inset-x-0 top-0 z-10 px-6 pt-[calc(env(safe-area-inset-top)+18px)] text-center">
          <p className="text-[17px] font-extrabold text-white drop-shadow">{persona?.name || t("ask.title")}</p>
          <p className="mt-0.5 flex items-center justify-center gap-1.5 text-[12.5px] font-bold text-white/75">
            {liveState === "listening" && <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />}
            {liveState === "speaking" && <span className="h-2 w-2 animate-pulse rounded-full bg-brand-300" />}
            {liveState === "listening" ? t("ask.liveListening")
              : liveState === "thinking" ? t("ask.liveThinking")
              : liveState === "speaking" ? t("ask.liveSpeaking")
              : ""}
          </p>
        </div>

        {/* transcript + end button */}
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center px-6 pb-[calc(env(safe-area-inset-bottom)+22px)]">
          {liveHeard && <p className="mb-1.5 text-center text-[12.5px] font-medium text-white/55">“{liveHeard}”</p>}
          {liveText && (
            <p className="mb-5 max-h-36 overflow-y-auto text-center text-[15px] font-bold leading-relaxed text-white drop-shadow">
              {liveText}
            </p>
          )}
          <button
            onClick={stopLive}
            aria-label={t("ask.liveEnd")}
            className="grid h-16 w-16 place-items-center rounded-full bg-red-500 text-white shadow-lg active:scale-95"
          >
            <X className="h-7 w-7" />
          </button>
        </div>
      </div>
    );
  }

  if (needIntro) {
    return (
      <div dir={dir} className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black">
        <video
          src={INTRO_VIDEO}
          autoPlay
          playsInline
          // No `controls` and no skip button: it must be watched to the end. When it
          // finishes (or can't play at all) we move straight on to the picker.
          onPlay={markIntroSeen}
          onEnded={finishIntro}
          onError={finishIntro}
          className="max-h-full max-w-full"
        />
        <p className="absolute bottom-[calc(env(safe-area-inset-bottom)+18px)] text-[12.5px] font-bold text-white/60">
          {t("ask.introWait")}
        </p>
      </div>
    );
  }

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      {/* header */}
      <div className="flex items-center gap-3 bg-gradient-to-b from-brand-700 to-brand-600 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+12px)]">
        <button onClick={() => router.push("/home")} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
          <Back className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <div className="flex flex-1 items-center gap-2">
          {persona?.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={persona.avatar} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-white/40" />
          ) : (
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white"><Sparkles className="h-5 w-5" /></span>
          )}
          <div>
            <p className="text-[15px] font-extrabold leading-tight text-white">{persona?.name || t("ask.title")}</p>
            <p className="text-[11.5px] font-medium text-white/70">{t("ask.subtitle")}</p>
          </div>
        </div>
        {!gateMsg && (
          <button onClick={() => setPlansOpen(true)} aria-label={t("ask.plansOpen")} title={t("ask.plansOpen")}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
            <CreditCard className="h-[18px] w-[18px]" />
          </button>
        )}
        {persona && !gateMsg && (
          <>
            {/* talk to the character out loud, face to face — hidden while VOICE_CHAT is off */}
            {VOICE_CHAT && (
              <button onClick={startLive} aria-label={t("ask.liveStart")} title={t("ask.liveStart")}
                className="me-1 grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
                <AudioLines className="h-[18px] w-[18px]" />
              </button>
            )}
            <button onClick={() => setPersona(null)} aria-label={t("ask.changeChar")} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
              <UserRound className="h-[18px] w-[18px]" />
            </button>
          </>
        )}
        {messages.length > 0 && (
          <button onClick={clearChat} aria-label={t("ask.clear")} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
            <Trash2 className="h-[18px] w-[18px]" />
          </button>
        )}
      </div>

      {/* plans & pricing sheet — available before and during chatting */}
      {plansOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50" onClick={() => setPlansOpen(false)}>
          <div dir={dir} onClick={(e) => e.stopPropagation()}
            className="max-h-[85dvh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl bg-white px-5 pb-[calc(env(safe-area-inset-bottom)+18px)] pt-5">
            <div className="mb-3 flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-brand-600" />
              <p className="flex-1 text-[16px] font-extrabold text-ink">{t("ask.plansTitle")}</p>
              <button onClick={() => setPlansOpen(false)} aria-label={t("ask.plansClose")} className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-slate-500 active:scale-95">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
              <div className="flex items-center gap-1.5">
                <Crown className="h-4 w-4 text-amber-500" />
                <p className="text-[14px] font-extrabold text-ink">{fillPlan(t("ask.plansVip"), { price: plan.vipPrice })}</p>
              </div>
              <p className="mt-1.5 text-[12.5px] font-medium leading-relaxed text-slate-600">{fillPlan(t("ask.plansVipFeats"), { img: plan.vImages, vid: plan.vVideos, min: plan.vVoice, msg: plan.vMessages, gb: plan.vStorage })}</p>
            </div>

            <div className="mt-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <p className="text-[14px] font-extrabold text-ink">{fillPlan(t("ask.plansBasic"), { price: plan.basicPrice })}</p>
              <p className="mt-1.5 text-[12.5px] font-medium leading-relaxed text-slate-600">{fillPlan(t("ask.plansBasicFeats"), { img: plan.gImages, vid: plan.gVideos, min: plan.gVoice, msg: plan.gMessages, gb: plan.gStorage })}</p>
            </div>

            <p className="mb-2 mt-4 text-[13px] font-extrabold text-ink">{fillPlan(t("ask.plansAddonsTitle"), { price: plan.addonPrice })}</p>
            <div className="flex flex-col gap-2">
              {[t("ask.plansAddon1"), t("ask.plansAddon2"), t("ask.plansAddon3")].map((line) => (
                <div key={line} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3.5 py-2.5 ring-1 ring-slate-200">
                  <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                  <span className="text-[12.5px] font-medium text-slate-700">{line}</span>
                </div>
              ))}
            </div>

            <p className="mt-4 text-[11.5px] font-medium leading-snug text-muted">{t("ask.plansNote")}</p>
            <button onClick={() => setPlansOpen(false)} className="mt-4 w-full rounded-2xl bg-brand-600 py-3 text-[14px] font-bold text-white active:scale-95">
              {t("ask.plansClose")}
            </button>
          </div>
        </div>
      )}

      {/* character picker — shown once, before the first chat */}
      {needPicker ? (
        <div className="no-scrollbar flex-1 overflow-y-auto px-6 py-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-3xl bg-brand-50 text-brand-500"><Sparkles className="h-8 w-8" /></span>
            <p className="text-[17px] font-extrabold text-ink">{t("ask.pickTitle")}</p>
            <p className="text-[13px] font-medium text-muted">{t("ask.pickHint")}</p>
            <button onClick={() => setPlansOpen(true)}
              className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3.5 py-1.5 text-[12.5px] font-bold text-brand-700 ring-1 ring-brand-200 active:scale-95">
              <CreditCard className="h-4 w-4" /> {t("ask.plansOpen")}
            </button>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {/*
              Portraits live in public/ as ai-saud.png and ai-dana.png, so they're served
              straight from /ai-saud.png. If a file is missing the <img> hides itself and
              the emoji underneath shows instead — the picker never ends up blank.
            */}
            <button onClick={() => choosePersona({ name: t("ask.char.saud"), gender: "male", avatar: CHAR_IMG.saud })}
              className="flex flex-col items-center gap-2 rounded-3xl bg-white p-5 ring-1 ring-slate-200 hover:ring-brand-300 active:scale-95">
              <span className="relative grid h-16 w-16 place-items-center overflow-hidden rounded-full bg-sky-100 text-[24px]">
                🧑🏻
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={CHAR_IMG.saud} alt="" className="absolute inset-0 h-full w-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = "none"; }} />
              </span>
              <span className="text-[14px] font-extrabold text-ink">{t("ask.char.saud")}</span>
            </button>
            <button onClick={() => choosePersona({ name: t("ask.char.dana"), gender: "female", avatar: CHAR_IMG.dana })}
              className="flex flex-col items-center gap-2 rounded-3xl bg-white p-5 ring-1 ring-slate-200 hover:ring-brand-300 active:scale-95">
              <span className="relative grid h-16 w-16 place-items-center overflow-hidden rounded-full bg-rose-100 text-[24px]">
                👩🏻
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={CHAR_IMG.dana} alt="" className="absolute inset-0 h-full w-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = "none"; }} />
              </span>
              <span className="text-[14px] font-extrabold text-ink">{t("ask.char.dana")}</span>
            </button>

            {/* Characters this person created before — pick one again, or remove it. */}
            {saved.map((c) => (
              <div key={c.name} className="relative">
                <button
                  onClick={() => choosePersona(c)}
                  className="flex w-full flex-col items-center gap-2 rounded-3xl bg-white p-5 ring-1 ring-slate-200 hover:ring-brand-300 active:scale-95"
                >
                  <span className="grid h-16 w-16 place-items-center overflow-hidden rounded-full bg-brand-50 text-[22px] font-extrabold text-brand-300">
                    {c.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.avatar} alt="" className="h-full w-full object-cover" />
                    ) : (
                      c.name.charAt(0).toUpperCase()
                    )}
                  </span>
                  <span className="max-w-full truncate text-[14px] font-extrabold text-ink">{c.name}</span>
                </button>
                <button
                  onClick={() => forgetCharacter(c.name)}
                  aria-label={t("ask.char.remove")}
                  className="absolute end-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/40 text-white backdrop-blur active:scale-90"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          {/* custom character name */}
          <div className="mt-4 rounded-3xl bg-white p-4 ring-1 ring-slate-200">
            <p className="mb-2 text-[13px] font-bold text-ink">{t("ask.char.custom")}</p>
            {/* voice gender — so a female character sounds female and a male one male */}
            <div className="mb-2 flex gap-2 rounded-2xl bg-slate-100 p-1">
              <button onClick={() => setCustomGender("female")}
                className={`flex-1 rounded-xl py-2 text-[12.5px] font-extrabold transition-all ${customGender === "female" ? "bg-white text-brand-700 shadow-sm" : "text-muted"}`}>
                {t("ask.char.female")}
              </button>
              <button onClick={() => setCustomGender("male")}
                className={`flex-1 rounded-xl py-2 text-[12.5px] font-extrabold transition-all ${customGender === "male" ? "bg-white text-brand-700 shadow-sm" : "text-muted"}`}>
                {t("ask.char.male")}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input value={customName} onChange={(e) => setCustomName(e.target.value)}
                placeholder={t("ask.char.customPh")} maxLength={40}
                className="h-11 flex-1 rounded-2xl border-2 border-slate-200 bg-slate-50 px-3.5 text-[14px] font-medium text-ink outline-none focus:border-brand-500 focus:bg-white" />
              <button onClick={() => customName.trim() && choosePersona({ name: customName.trim(), gender: customGender })}
                disabled={!customName.trim()}
                className="h-11 shrink-0 rounded-2xl bg-brand-600 px-4 text-[13px] font-bold text-white disabled:opacity-40 active:scale-95">
                {t("ask.char.start")}
              </button>
            </div>
            {/* make the character look like a photo */}
            <input ref={photoRef} type="file" accept="image/*" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) avatarFromPhoto(f); e.target.value = ""; }} />
            <button onClick={() => photoRef.current?.click()} disabled={avatarBusy}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl bg-amber-50 py-2.5 text-[12.5px] font-extrabold text-amber-600 ring-1 ring-amber-200 hover:bg-amber-100 disabled:opacity-50 active:scale-95">
              <ImagePlus className="h-4 w-4" /> {avatarBusy ? t("ask.imgWorking") : t("ask.char.fromPhoto")}
            </button>
          </div>
          <button onClick={() => choosePersona({ name: "", gender: "" })}
            className="mx-auto mt-5 block text-[12.5px] font-bold text-muted underline-offset-2 hover:underline">
            {t("ask.char.skip")}
          </button>
        </div>
      ) : (
      <>
      {/* messages */}
      <div ref={scrollRef} className="no-scrollbar flex-1 overflow-y-auto px-4 py-4">
        {status === "premium_only" ? (
          /* The paywall — a free member gets this the moment they try anything. */
          <div className="mt-10 flex flex-col items-center gap-3 px-5 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-3xl bg-gold-400/15 text-gold-500"><Crown className="h-8 w-8" /></span>
            <p className="text-[17px] font-extrabold text-ink">{t("ask.payTitle")}</p>
            <p className="text-[13px] font-medium leading-relaxed text-muted">{t("ask.payBody")}</p>

            <div className="mt-2 w-full rounded-3xl bg-white p-4 text-start ring-1 ring-slate-100">
              {[t("ask.payF1"), t("ask.payF2"), t("ask.payF3"), t("ask.payF4")].map((f) => (
                <p key={f} className="flex items-start gap-2 py-1 text-[13px] font-bold text-ink">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {f}
                </p>
              ))}
            </div>

            <button
              onClick={() => router.push("/subscribe")}
              className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-[14.5px] font-extrabold text-white active:scale-[0.99]"
            >
              <Crown className="h-5 w-5" /> {t("ask.paySubscribe")}
            </button>
            <p className="text-[11.5px] font-medium text-muted">{t("ask.payAddon")}</p>
          </div>
        ) : gateMsg ? (
          <div className="mt-16 flex flex-col items-center gap-3 px-6 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-3xl bg-brand-50 text-brand-500"><Sparkles className="h-8 w-8" /></span>
            <p className="text-[14px] font-bold text-muted">{gateMsg}</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="mt-14 flex flex-col items-center gap-3 px-6 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-3xl bg-brand-50 text-brand-500"><Sparkles className="h-8 w-8" /></span>
            <p className="text-[15px] font-extrabold text-ink">{persona?.name || t("ask.title")}</p>
            <p className="text-[13px] font-medium text-muted">{t("ask.empty")}</p>
            {/* give the chosen character a generated face */}
            {persona?.name && !persona.avatar && (
              <button onClick={genAvatar} disabled={avatarBusy}
                className="mt-1 flex items-center gap-1.5 rounded-full bg-amber-50 px-3.5 py-2 text-[12.5px] font-extrabold text-amber-600 ring-1 ring-amber-200 hover:bg-amber-100 disabled:opacity-50 active:scale-95">
                <ImagePlus className="h-4 w-4" /> {avatarBusy ? t("ask.imgWorking") : t("ask.makeFace")}
              </button>
            )}
            {/* one-tap AI helpers */}
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {quickKeys.map((k) => (
                <button key={k} onClick={() => useQuick(k)}
                  className="rounded-full bg-white px-3.5 py-2 text-[12.5px] font-bold text-brand-700 ring-1 ring-slate-200 hover:ring-brand-300 active:scale-95">
                  {t(`ask.chip.${k}`)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.videoUrl ? (
                  <div className="flex max-w-[82%] flex-col items-start gap-1.5">
                    <video src={m.videoUrl} controls playsInline className="w-full rounded-2xl bg-black ring-1 ring-slate-200" />
                    <button onClick={() => downloadMedia(m.videoUrl!, `prfet-video-${Date.now()}.mp4`)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-[12.5px] font-bold text-slate-600 active:scale-95 hover:bg-slate-200">
                      <Download className="h-3.5 w-3.5" /> {t("ask.download")}
                    </button>
                  </div>
                ) : m.imageUrl ? (
                  <div className="flex max-w-[82%] flex-col items-start gap-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.imageUrl} alt="" className="w-full rounded-2xl ring-1 ring-slate-200" />
                    <button onClick={() => downloadMedia(m.imageUrl!, `prfet-image-${Date.now()}.png`)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-[12.5px] font-bold text-slate-600 active:scale-95 hover:bg-slate-200">
                      <Download className="h-3.5 w-3.5" /> {t("ask.download")}
                    </button>
                  </div>
                ) : (
                  <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${
                    m.role === "user" ? "bg-brand-600 text-white" : "bg-white text-ink ring-1 ring-slate-200"
                  }`}>
                    <span className="whitespace-pre-wrap">{m.body}</span>
                    {VOICE_CHAT && m.role === "model" && m.body && (
                      <button onClick={() => speak(m)} aria-label={t("ask.listen")}
                        className={`ms-1.5 inline-grid h-6 w-6 place-items-center rounded-full align-middle ${speakingId === m.id ? "bg-brand-100 text-brand-700" : "text-muted hover:bg-slate-100"}`}>
                        <Volume2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {(sending || imgBusy || vidBusy) && (
              <div className="flex flex-col items-start gap-1">
                <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200">
                  <span className="flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.2s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.1s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300" />
                  </span>
                </div>
                {vidBusy && <span className="px-1 text-[11.5px] font-medium text-muted">{t("ask.vidWorking")}</span>}
              </div>
            )}
          </div>
        )}
        {err && <p className="mt-3 text-center text-[12.5px] font-medium text-red-500">{err}</p>}
      </div>

      {/* how much is left this month — only for subscribers with finite caps */}
      {!gateMsg && !status && usage && (() => {
        const items: { key: string; label: string; c: Cap; unit?: string }[] = [
          { key: "messages", label: t("ask.uMessages"), c: usage.messages },
          { key: "images", label: t("ask.uImages"), c: usage.images },
          { key: "videos", label: t("ask.uVideos"), c: usage.videos },
          { key: "voice", label: t("ask.uVoice"), c: usage.voiceMin, unit: t("ask.uMin") },
        ].filter((i) => !i.c.unlimited && (VOICE_CHAT || i.key !== "voice")); // hide voice while it's off
        if (!items.length) return null;
        return (
          <div className="no-scrollbar flex gap-2 overflow-x-auto border-t border-slate-100 bg-white px-3 py-2">
            {items.map((i) => {
              const low = i.c.remaining <= Math.max(3, Math.ceil(i.c.cap * 0.1));
              const out = i.c.remaining <= 0;
              return (
                <span key={i.key}
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                    out ? "bg-red-50 text-red-600" : low ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-500"
                  }`}>
                  {i.label}: {i.c.remaining}{i.unit ? ` ${i.unit}` : ""} {t("ask.uLeft")}
                </span>
              );
            })}
          </div>
        );
      })()}

      {/* input */}
      {!gateMsg && (
        <div className="flex items-end gap-2 border-t border-slate-100 bg-white px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2.5">
          {VOICE_CHAT && (
            <button
              onClick={toggleMic}
              aria-label={t("ask.dictate")}
              title={t("ask.dictate")}
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition-all active:scale-95 ${
                listening ? "bg-red-500 text-white" : "bg-slate-100 text-slate-500"
              }`}
            >
              <Mic className="h-5 w-5" />
            </button>
          )}
          <button
            onClick={() => genImage()}
            disabled={imgBusy || vidBusy || sending}
            aria-label={t("ask.makeImage")}
            title={t("ask.makeImage")}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition-all active:scale-95 ${
              !imgBusy && !vidBusy && !sending ? "bg-amber-50 text-amber-600 ring-1 ring-amber-200" : "cursor-not-allowed bg-slate-100 text-slate-400"
            }`}
          >
            <ImagePlus className="h-5 w-5" />
          </button>
          <button
            onClick={() => genVideo()}
            disabled={vidBusy || imgBusy || sending}
            aria-label={t("ask.makeVideo")}
            title={t("ask.makeVideo")}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition-all active:scale-95 ${
              !vidBusy && !imgBusy && !sending ? "bg-violet-50 text-violet-600 ring-1 ring-violet-200" : "cursor-not-allowed bg-slate-100 text-slate-400"
            }`}
          >
            <Clapperboard className="h-5 w-5" />
          </button>
          <input ref={attachRef} type="file" accept="image/*" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) attachPhoto(f); e.target.value = ""; }} />
          <button
            onClick={() => attachRef.current?.click()}
            disabled={imgBusy || vidBusy || sending}
            aria-label={dir === "rtl" ? "إرفاق صورة" : "Attach photo"}
            title={dir === "rtl" ? "إرفاق صورة" : "Attach photo"}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition-all active:scale-95 ${
              !imgBusy && !vidBusy && !sending ? "bg-slate-100 text-slate-500" : "cursor-not-allowed bg-slate-100 text-slate-400"
            }`}
          >
            <Paperclip className="h-5 w-5" />
          </button>
          {pendingImg && (
            <div className="relative h-11 w-11 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pendingImg.url} alt="" className="h-11 w-11 rounded-2xl object-cover ring-1 ring-slate-200" />
              <button onClick={() => setPendingImg(null)} aria-label="remove"
                className="absolute -end-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-slate-800 text-white">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={t("ask.placeholder")}
            rows={1}
            className="max-h-32 flex-1 resize-none rounded-2xl border-2 border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[14px] font-medium text-ink outline-none focus:border-brand-500 focus:bg-white"
          />
          <button
            onClick={send}
            disabled={(!input.trim() && !pendingImg) || sending}
            aria-label={t("ask.send")}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition-all ${
              (input.trim() || pendingImg) && !sending ? "bg-brand-600 text-white active:scale-95" : "cursor-not-allowed bg-slate-100 text-slate-400"
            }`}
          >
            <Send className="h-5 w-5" strokeWidth={2.4} />
          </button>
        </div>
      )}

      {/* limit reached — stop and offer renewal or an add-on pack */}
      {capHit && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setCapHit(null)}>
          <div className="w-full max-w-[420px] rounded-3xl bg-white p-6 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
            <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-500"><Crown className="h-8 w-8" /></span>
            <p className="text-[16px] font-extrabold text-ink">{t("ask.capTitle")}</p>
            <p className="mt-1 text-[13px] font-medium leading-relaxed text-muted">{t(`ask.cap.${capHit}`)}</p>
            <button onClick={() => { setCapHit(null); router.push("/subscribe"); }}
              className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-[14.5px] font-extrabold text-white active:scale-[0.99]">
              <Crown className="h-5 w-5" /> {t("ask.capRenew")}
            </button>
            <button onClick={() => setCapHit(null)} className="mt-2 text-[12.5px] font-bold text-muted">{t("ask.capLater")}</button>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
