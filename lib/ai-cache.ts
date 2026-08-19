/**
 * Tiny in-memory cache for the AI assistant.
 *
 * Goal: don't spend model tokens answering the exact same question twice. When a member
 * repeats a message, we return the answer we already generated for them instead of calling
 * Gemini again.
 *
 * Safety: the key includes the userId, so a cached answer is only ever returned to the same
 * person who asked it — one user can never receive another user's answer. Entries expire after
 * TTL and the whole map is LRU-capped so memory can't grow without bound. It lives in process
 * memory (fine for a single-instance deploy) and simply repopulates after a restart.
 */

type Entry = { text: string; at: number };

const store = new Map<string, Entry>();
const MAX = 2000; // total cached answers kept across all members
const TTL = 24 * 60 * 60 * 1000; // 24 hours

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Build the cache key. Same user + language + persona + (normalized) text → same answer. */
export function cacheKey(userId: string, locale: string, persona: string | undefined, message: string): string {
  return `${userId}|${locale}|${persona || ""}|${norm(message)}`;
}

/** Return the cached answer for this key, or null if absent/expired. */
export function cacheGet(key: string): string | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() - e.at > TTL) { store.delete(key); return null; }
  // Touch it so it's treated as most-recently-used.
  store.delete(key);
  store.set(key, e);
  return e.text;
}

/** Remember an answer for a key, evicting the oldest entry when over capacity. */
export function cacheSet(key: string, text: string): void {
  store.set(key, { text, at: Date.now() });
  if (store.size > MAX) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
}

/* ------------------------------------------------------------------ *
 * Text-to-speech cache. The audio for a given sentence + voice is the *
 * same no matter who asks, so this one is shared across all members    *
 * (it holds no personal content). Kept smaller since audio is heavier. *
 * ------------------------------------------------------------------ */

type Audio = { url: string; seconds: number; at: number };
const audio = new Map<string, Audio>();
const AUDIO_MAX = 300; // fewer entries — each holds base64 audio

/** Same spoken text + same voice → same audio. */
export function ttsKey(gender: string | undefined, text: string): string {
  return `${gender || ""}|${norm(text)}`;
}

/** Return cached audio (url + duration) for this key, or null if absent/expired. */
export function ttsGet(key: string): { url: string; seconds: number } | null {
  const e = audio.get(key);
  if (!e) return null;
  if (Date.now() - e.at > TTL) { audio.delete(key); return null; }
  audio.delete(key);
  audio.set(key, e);
  return { url: e.url, seconds: e.seconds };
}

/** Remember generated audio, evicting the oldest when over capacity. */
export function ttsSet(key: string, url: string, seconds: number): void {
  audio.set(key, { url, seconds, at: Date.now() });
  if (audio.size > AUDIO_MAX) {
    const oldest = audio.keys().next().value;
    if (oldest !== undefined) audio.delete(oldest);
  }
}
