/**
 * Thin wrapper over Google's Gemini REST API.
 *
 * Deliberately no SDK: one fetch call, no extra dependency to keep updated, and the model
 * name lives in an env var so moving from the free tier to a paid model (or to the image /
 * video models later) is a config change, not a code change.
 */

import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Log the REAL reason a Gemini call failed so it shows up in `docker logs app`
 *  (the API routes only surface a generic "failed"/502 to the browser). */
function logGeminiFail(where: string, detail?: string) {
  console.error(`[gemini] ${where} failed:`, (detail || "unknown").slice(0, 500));
}

/** Current fast model — the "-latest" alias won't get retired out from under us. */
const DEFAULT_MODEL = "gemini-flash-latest";

export type Turn = { role: "user" | "model"; text: string };

/** Live plan pricing + monthly limits, read from the dashboard and passed into the chat so
 *  the assistant always quotes current numbers (0 = unlimited). */
export type Plans = {
  golden: { price: number; images: number; videos: number; messages: number; storageGb: number; radarMin: number };
  vip: { price: number; images: number; videos: number; messages: number; storageGb: number; radarMin: number };
  addons: { media: number; storage: number };
};

export function geminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

/** Image model (Gemini flash image generation). Override with GEMINI_IMAGE_MODEL. */
const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";

export type ImageResult =
  | { ok: true; dataUrl: string }
  | { ok: false; error: "not_configured" | "quota" | "blocked" | "failed"; detail?: string };

/** Video model (Veo via the Gemini API). Override with GEMINI_VIDEO_MODEL. */
const DEFAULT_VIDEO_MODEL = "veo-3.1-fast-generate-preview";

/** Text-to-speech model — natural voices, far better than the browser's built-in speech. */
const DEFAULT_TTS_MODEL = "gemini-2.5-flash-preview-tts";

export type TtsResult =
  | { ok: true; dataUrl: string; seconds: number }
  | { ok: false; error: "not_configured" | "quota" | "failed"; detail?: string };

/** Wrap raw PCM16 mono audio (what Gemini TTS returns) in a WAV header so browsers can play it. */
function pcmToWavDataUrl(pcmB64: string, sampleRate: number): string {
  const pcm = Buffer.from(pcmB64, "base64");
  const numChannels = 1, bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(numChannels, 22); h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(byteRate, 28);
  h.writeUInt16LE(blockAlign, 32); h.writeUInt16LE(bitsPerSample, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return `data:audio/wav;base64,${Buffer.concat([h, pcm]).toString("base64")}`;
}

/**
 * Speak `text` in a natural voice. `gender` picks a matching prebuilt voice; both are
 * overridable with GEMINI_TTS_MALE / GEMINI_TTS_FEMALE.
 */
export async function geminiTTS(text: string, gender?: "male" | "female" | ""): Promise<TtsResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "not_configured" };
  const model = process.env.GEMINI_TTS_MODEL || DEFAULT_TTS_MODEL;
  const voice = gender === "male"
    ? (process.env.GEMINI_TTS_MALE || "Puck")
    : (process.env.GEMINI_TTS_FEMALE || "Kore");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: ctrl.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    });
    if (res.status === 429) return { ok: false, error: "quota" };
    if (!res.ok) return { ok: false, error: "failed", detail: (await res.text().catch(() => "")).slice(0, 300) };
    const data = await res.json();
    const part = (data?.candidates?.[0]?.content?.parts || []).find((p: { inlineData?: { data?: string } }) => p.inlineData?.data);
    const b64 = part?.inlineData?.data as string | undefined;
    if (!b64) return { ok: false, error: "failed", detail: "no audio" };
    const mime: string = part?.inlineData?.mimeType || "audio/L16;rate=24000";
    const rate = parseInt(mime.match(/rate=(\d+)/)?.[1] || "24000", 10) || 24000;
    // PCM16 mono: duration = samples / rate = (bytes / 2) / rate. Used to meter AI-voice time.
    const seconds = Buffer.from(b64, "base64").length / 2 / rate;
    return { ok: true, dataUrl: pcmToWavDataUrl(b64, rate), seconds };
  } catch {
    return { ok: false, error: "failed" };
  } finally {
    clearTimeout(timer);
  }
}

type StartResult = { ok: true; op: string } | { ok: false; error: "not_configured" | "quota" | "failed"; detail?: string };
type PollResult = { ok: true; done: boolean; url?: string } | { ok: false; error: "failed"; detail?: string };

/** Kick off a video generation. Returns the long-running operation name to poll. */
export async function geminiVideoStart(prompt: string): Promise<StartResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "not_configured" };
  // Try the pinned video model, then a fallback (set GEMINI_VIDEO_MODEL / GEMINI_VIDEO_MODEL_FALLBACK)
  // so a retired preview model (404) doesn't kill video generation.
  const primary = process.env.GEMINI_VIDEO_MODEL || DEFAULT_VIDEO_MODEL;
  const fallback = process.env.GEMINI_VIDEO_MODEL_FALLBACK || DEFAULT_VIDEO_MODEL;
  const models = fallback && fallback !== primary ? [primary, fallback] : [primary];
  let lastDetail = "";
  try {
    for (const model of models) {
      const res = await fetch(`${ENDPOINT}/${model}:predictLongRunning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio: "16:9" } }),
      });
      if (res.status === 429) return { ok: false, error: "quota" };
      if (!res.ok) {
        lastDetail = (await res.text().catch(() => "")).slice(0, 300);
        logGeminiFail(`video start (${model}) HTTP ${res.status}`, lastDetail);
        continue; // 404 retired / overloaded → try the next model
      }
      const data = await res.json();
      if (!data?.name) { lastDetail = "no operation name"; continue; }
      return { ok: true, op: data.name };
    }
    return { ok: false, error: "failed", detail: lastDetail };
  } catch (e) {
    logGeminiFail("video start (network/timeout)", String(e));
    return { ok: false, error: "failed" };
  }
}

/** Find the first http(s) URL anywhere in a nested object (the finished video's file URI). */
function findUri(o: unknown): string | null {
  if (typeof o === "string") return /^https?:\/\//.test(o) ? o : null;
  if (Array.isArray(o)) { for (const v of o) { const u = findUri(v); if (u) return u; } return null; }
  if (o && typeof o === "object") { for (const v of Object.values(o)) { const u = findUri(v); if (u) return u; } }
  return null;
}

/** Poll a video operation. When done, downloads the clip and returns a data URL. */
export async function geminiVideoPoll(op: string): Promise<PollResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "failed" };
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${op}`, {
      headers: { "x-goog-api-key": key },
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      logGeminiFail(`video poll HTTP ${res.status}`, detail);
      return { ok: false, error: "failed", detail };
    }
    const data = await res.json();
    if (!data?.done) return { ok: true, done: false };
    // A finished operation can still carry an error (e.g. safety, quota) instead of a video.
    if (data.error) {
      logGeminiFail("video poll operation-error", JSON.stringify(data.error));
      return { ok: false, error: "failed", detail: JSON.stringify(data.error).slice(0, 300) };
    }
    const uri = findUri(data.response);
    if (!uri) {
      logGeminiFail("video poll", "done but no video uri: " + JSON.stringify(data.response || {}).slice(0, 300));
      return { ok: false, error: "failed", detail: "no video uri" };
    }
    // Download the video bytes (the file URI needs the key too).
    const vres = await fetch(uri, { headers: { "x-goog-api-key": key } });
    if (!vres.ok) {
      logGeminiFail(`video download HTTP ${vres.status}`, uri);
      return { ok: false, error: "failed", detail: "download failed" };
    }
    const buf = Buffer.from(await vres.arrayBuffer());
    // Save the clip to /public/uploads and return a NORMAL URL. Returning multi-MB base64
    // through the API response is what choked the 1 GB box; a real URL is tiny and plays
    // directly as post/ad/chat media.
    const dir = path.join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    const name = `${crypto.randomUUID()}.mp4`;
    await writeFile(path.join(dir, name), buf);
    return { ok: true, done: true, url: `/uploads/${name}` };
  } catch (e) {
    logGeminiFail("video poll (network/timeout)", String(e));
    return { ok: false, error: "failed" };
  }
}

/** Generate one image from a text prompt (and optionally an input photo to base it on). */
export async function geminiImage(prompt: string, inputImage?: string): Promise<ImageResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "not_configured" };

  const reqParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: prompt }];
  if (inputImage) {
    const m = inputImage.match(/^data:([^;]+);base64,(.+)$/);
    if (m) reqParts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }
  const body = JSON.stringify({
    contents: [{ role: "user", parts: reqParts }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  });

  // Same self-healing model selection as chat: try the pinned image model, then a fallback
  // (set GEMINI_IMAGE_MODEL / GEMINI_IMAGE_MODEL_FALLBACK). Survives retirement (404) + overload (503).
  const primary = process.env.GEMINI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  const fallback = process.env.GEMINI_IMAGE_MODEL_FALLBACK || DEFAULT_IMAGE_MODEL;
  const models = fallback && fallback !== primary ? [primary, fallback] : [primary];

  const MAX_ATTEMPTS = 3;
  let lastDetail = "";
  for (const model of models) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000);
      try {
        const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          signal: ctrl.signal,
          body,
        });
        if (res.status === 429) return { ok: false, error: "quota" };
        if (!res.ok) {
          lastDetail = await res.text().catch(() => "");
          if ((res.status === 503 || res.status === 500 || res.status === 502) && attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, 900 * attempt));
            continue;
          }
          logGeminiFail(`image (${model}) HTTP ${res.status}`, lastDetail);
          break; // 404 retired or overload exhausted → try the next model
        }
        const data = await res.json();
        const parts: Array<{ inlineData?: { data?: string; mimeType?: string } }> = data?.candidates?.[0]?.content?.parts || [];
        const img = parts.find((p) => p.inlineData?.data);
        const b64 = img?.inlineData?.data;
        const mime = img?.inlineData?.mimeType || "image/png";
        if (!b64) return { ok: false, error: "blocked" };
        return { ok: true, dataUrl: `data:${mime};base64,${b64}` };
      } catch (e) {
        lastDetail = String(e);
        logGeminiFail(`image (${model}) network/timeout`, lastDetail);
        break; // try the next model
      } finally {
        clearTimeout(timer);
      }
    }
  }
  logGeminiFail(`image all models failed (${models.join(", ")})`, lastDetail);
  return { ok: false, error: "failed" };
}

/**
 * The assistant's brief. It knows PRFET specifically AND answers general questions —
 * both, per the product decision.
 */
function systemPrompt(locale: string, persona?: { name?: string; gender?: string }, plans?: Plans): string {
  const name = (persona?.name || "").trim();
  const personaLine = name
    ? `Your name is ${name}. You are a friendly personal companion${persona?.gender === "female" ? " (speak as a female persona)" : persona?.gender === "male" ? " (speak as a male persona)" : ""}. Introduce yourself as ${name} when it fits, and keep a warm, personable tone.`
    : "";
  // Pricing/limits are LIVE from the dashboard (passed in as `plans`) so the assistant never
  // quotes stale numbers. If not provided, point the user to the in-app Plans page.
  const cap = (n: number) => (n === 0 ? "unlimited" : String(n));
  const pricingLines = plans
    ? [
        "AI plans & limits — when the user asks about pricing, plans, or limits, use THESE exact",
        "current numbers (do not invent or use any other figures):",
        `- Golden subscription ($${plans.golden.price}/month): ${cap(plans.golden.images)} images, ${cap(plans.golden.videos)} videos, ${cap(plans.golden.messages)} assistant messages, ${cap(plans.golden.storageGb)} GB storage, and ${cap(plans.golden.radarMin)} Bluetooth radar minutes — per month.`,
        `- VIP subscription ($${plans.vip.price}/month): ${cap(plans.vip.images)} images, ${cap(plans.vip.videos)} videos, ${cap(plans.vip.messages)} assistant messages, ${cap(plans.vip.storageGb)} GB storage, and ${cap(plans.vip.radarMin)} Bluetooth radar minutes — per month.`,
        `- Top-up packs: extra media pack $${plans.addons.media}, extra storage pack $${plans.addons.storage}.`,
        "- \"Bluetooth radar minutes\" power AI Radar (subscribers only): it keeps scanning nearby and",
        "  reports everyone who passed close to you, even after they left. Manual Bluetooth discovery",
        "  is free for everyone; only the auto-radar spends radar minutes.",
        "- Text chat is free. Image/video limits reset every month. When a limit is reached, the",
        "  user can buy a top-up pack or upgrade their plan.",
        "Present these plainly and only when asked; do not push sales in normal conversation.",
      ]
    : [
        "For current subscription prices and limits, tell the user to open the Plans/Subscribe page",
        "in the app, where the live pricing and limits are shown. Do not guess specific numbers.",
      ];
  return [
    "You are the PRFET assistant, built into the PRFET app.",
    personaLine,
    "",
    "BLUETOOTH SEARCH — you can actually RUN a Bluetooth scan for the user when they ask to",
    "find people or businesses physically near them (e.g. 'search bluetooth', 'who is around",
    "me', 'ابحث بالبلوتوث', 'مين حولي', 'دور على الناس حولي'). Follow these steps exactly:",
    "1) If the user has NOT said who they want, ask only whether they're looking for",
    "   businesses, individuals, or both — then stop; do NOT emit the directive yet.",
    "2) Once the type is known, reply with a short natural line (e.g. 'تمام، جاري البحث",
    "   بالبلوتوث…') and, on its OWN line, output the directive token EXACTLY:",
    "   [[BLE_SEARCH:both]] — replacing both with business, individual, or both. The app",
    "   detects this token, performs the real scan, and shows the results itself; do NOT",
    "   invent or list any names yourself.",
    "3) It's a paid feature using the subscriber 'radar minutes'. If the user isn't subscribed",
    "   or is out of minutes, the app tells them — you don't need to check or mention it.",
    "Only ever output [[BLE_SEARCH:...]] when the user clearly asked to find nearby people.",
    "",
    "About PRFET: a location-based social and business app. People discover nearby",
    "businesses, services and other members — including nearby discovery over Bluetooth,",
    "which finds people and businesses physically around you (free for everyone, opt-in on",
    "both sides). They follow each other, message and call, post stories and posts, join",
    "audio meeting rooms, browse and post jobs, and buy ads.",
    "Premium is a paid subscription unlocking a custom name colour, precise location",
    "sharing, social links and other perks. There is a jobs section for companies posting",
    "vacancies and individuals advertising that they are looking for work.",
    "",
    "Help with two kinds of question:",
    "1. Anything about PRFET itself — how features work, where to find them, pricing,",
    "   accounts, Premium, jobs, ads.",
    "2. General questions on any subject, like a normal helpful assistant.",
    "",
    "IMPORTANT — this app CAN generate images and videos for the user, right here.",
    "Just below the message box there are three buttons: a microphone (voice), an image",
    "button (to create a picture), and a video button (to create a short clip). So when",
    "someone asks you to make/create/generate an image, photo, picture or video:",
    "- NEVER say you are 'just a text assistant' or that you cannot make images/videos.",
    "- NEVER tell them to use outside tools like Bing, Midjourney, Canva or DALL-E.",
    "- Instead tell them warmly to type what they want and tap the image button (to the",
    "  left of the box) for a picture, or the video button for a clip. You can also help",
    "  them word a good description first.",
    "",
    "Travel & hotels: you can help members plan trips — suggest destinations, compare",
    "areas to stay, outline rough itineraries and typical price ranges, and list what to",
    "check when booking. You cannot make real bookings or pull live prices; say so and",
    "point them to a booking site for the final step.",
    "",
    "Emotional awareness: read the tone behind each message. If someone seems stressed,",
    "sad, excited or frustrated, acknowledge it briefly and warmly before helping. Never",
    "be clinical or robotic. Keep it natural — one short empathetic touch, then the help.",
    "Do not diagnose or claim to detect emotions with certainty.",
    "",
    ...pricingLines,
    "",
    "Guidelines:",
    `- Reply in the user's language. The app is currently set to ${locale === "ar" ? "Arabic" : "English"}; match whatever language they write in.`,
    "- Be concise and practical. Short paragraphs, no filler.",
    "- Never invent PRFET features, prices, or policies. If you are unsure about something",
    "  specific to PRFET, say so and suggest contacting the admin from the Contact page.",
    "- You cannot perform actions in the app (you cannot send messages, place calls, or",
    "  change settings for the user) — explain how they can do it themselves.",
    "- Never claim to be a human.",
  ].join("\n");
}

export type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; error: "not_configured" | "quota" | "blocked" | "failed"; detail?: string };

/**
 * Send the conversation and get the next reply.
 * `history` should be oldest-first and already trimmed to a sane length.
 */
export async function geminiChat(history: Turn[], locale: string, persona?: { name?: string; gender?: string }, image?: { data: string; mime: string }, plans?: Plans): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "not_configured" };

  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt(locale, persona, plans) }] },
    contents: history.map((h, idx) => {
      const parts: Array<Record<string, unknown>> = [{ text: h.text }];
      // Attach the uploaded image to the newest user turn so the AI can see it (fix #9).
      if (image && h.role === "user" && idx === history.length - 1) {
        parts.push({ inline_data: { mime_type: image.mime, data: image.data } });
      }
      return { role: h.role, parts };
    }),
    generationConfig: { temperature: 0.7, maxOutputTokens: 1200 },
  });

  // Self-healing model selection: try the pinned/fast model first, then fall back to the
  // never-retired "-latest" alias. This survives BOTH failure modes without any manual fix:
  //   • the pinned model gets RETIRED (404) → we drop to the alias, which always resolves.
  //   • the pinned model is OVERLOADED (503) → after quick retries we try the alias too.
  // Set GEMINI_MODEL (fast, current) and optionally GEMINI_MODEL_FALLBACK in .env.
  const primary = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const fallback = process.env.GEMINI_MODEL_FALLBACK || DEFAULT_MODEL; // DEFAULT is the "-latest" alias
  const models = fallback && fallback !== primary ? [primary, fallback] : [primary];

  const MAX_ATTEMPTS = 3;
  let lastDetail = "";
  for (const model of models) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30_000);
      try {
        const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          signal: ctrl.signal,
          body,
        });

        if (res.status === 429) return { ok: false, error: "quota" }; // real quota — don't retry/fallback
        if (!res.ok) {
          lastDetail = await res.text().catch(() => "");
          // transient overload → retry the SAME model a couple of times (fast responses)
          if ((res.status === 503 || res.status === 500 || res.status === 502) && attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, 700 * attempt)); // 0.7s, 1.4s backoff
            continue;
          }
          logGeminiFail(`chat (${model}) HTTP ${res.status}`, lastDetail);
          break; // 404 retired, or overload exhausted → fall through to the next model
        }

        const data = await res.json();
        const cand = data?.candidates?.[0];
        // Gemini returns no text when its safety filters stop the answer.
        if (!cand || cand.finishReason === "SAFETY") return { ok: false, error: "blocked" };

        const text: string = (cand.content?.parts || [])
          .map((p: { text?: string }) => p.text || "")
          .join("")
          .trim();

        if (!text) return { ok: false, error: "blocked" };
        return { ok: true, text };
      } catch (e) {
        lastDetail = String(e);
        logGeminiFail(`chat (${model}) network/timeout`, lastDetail);
        break; // network/timeout on this model → try the next one
      } finally {
        clearTimeout(timer);
      }
    }
  }
  logGeminiFail(`chat all models failed (${models.join(", ")})`, lastDetail);
  return { ok: false, error: "failed" };
}
