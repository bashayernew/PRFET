/**
 * Thin wrapper over Google's Gemini REST API.
 *
 * Deliberately no SDK: one fetch call, no extra dependency to keep updated, and the model
 * name lives in an env var so moving from the free tier to a paid model (or to the image /
 * video models later) is a config change, not a code change.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Current fast model — the "-latest" alias won't get retired out from under us. */
const DEFAULT_MODEL = "gemini-flash-latest";

export type Turn = { role: "user" | "model"; text: string };

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
type PollResult = { ok: true; done: boolean; dataUrl?: string } | { ok: false; error: "failed"; detail?: string };

/** Kick off a video generation. Returns the long-running operation name to poll. */
export async function geminiVideoStart(prompt: string): Promise<StartResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "not_configured" };
  const model = process.env.GEMINI_VIDEO_MODEL || DEFAULT_VIDEO_MODEL;
  try {
    const res = await fetch(`${ENDPOINT}/${model}:predictLongRunning`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio: "16:9" } }),
    });
    if (res.status === 429) return { ok: false, error: "quota" };
    if (!res.ok) return { ok: false, error: "failed", detail: (await res.text().catch(() => "")).slice(0, 300) };
    const data = await res.json();
    if (!data?.name) return { ok: false, error: "failed", detail: "no operation name" };
    return { ok: true, op: data.name };
  } catch {
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
    if (!res.ok) return { ok: false, error: "failed", detail: (await res.text().catch(() => "")).slice(0, 300) };
    const data = await res.json();
    if (!data?.done) return { ok: true, done: false };
    const uri = findUri(data.response);
    if (!uri) return { ok: false, error: "failed", detail: "no video uri" };
    // Download the video bytes (the file URI needs the key too).
    const vres = await fetch(uri, { headers: { "x-goog-api-key": key } });
    if (!vres.ok) return { ok: false, error: "failed", detail: "download failed" };
    const buf = Buffer.from(await vres.arrayBuffer());
    const mime = vres.headers.get("content-type") || "video/mp4";
    return { ok: true, done: true, dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/** Generate one image from a text prompt (and optionally an input photo to base it on). */
export async function geminiImage(prompt: string, inputImage?: string): Promise<ImageResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "not_configured" };

  const model = process.env.GEMINI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  const reqParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: prompt }];
  if (inputImage) {
    const m = inputImage.match(/^data:([^;]+);base64,(.+)$/);
    if (m) reqParts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: ctrl.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: reqParts }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    });
    if (res.status === 429) return { ok: false, error: "quota" };
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: "failed", detail: detail.slice(0, 300) };
    }
    const data = await res.json();
    const parts: Array<{ inlineData?: { data?: string; mimeType?: string } }> = data?.candidates?.[0]?.content?.parts || [];
    const img = parts.find((p) => p.inlineData?.data);
    const b64 = img?.inlineData?.data;
    const mime = img?.inlineData?.mimeType || "image/png";
    if (!b64) return { ok: false, error: "blocked" };
    return { ok: true, dataUrl: `data:${mime};base64,${b64}` };
  } catch {
    return { ok: false, error: "failed" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The assistant's brief. It knows PRFET specifically AND answers general questions —
 * both, per the product decision.
 */
function systemPrompt(locale: string, persona?: { name?: string; gender?: string }): string {
  const name = (persona?.name || "").trim();
  const personaLine = name
    ? `Your name is ${name}. You are a friendly personal companion${persona?.gender === "female" ? " (speak as a female persona)" : persona?.gender === "male" ? " (speak as a male persona)" : ""}. Introduce yourself as ${name} when it fits, and keep a warm, personable tone.`
    : "";
  return [
    "You are the PRFET assistant, built into the PRFET app.",
    personaLine,
    "",
    "About PRFET: a location-based social and business app. People discover nearby",
    "businesses, services and other members, follow them, message and call them, post",
    "stories and posts, join audio meeting rooms, browse and post jobs, and buy ads.",
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
    "AI plans & limits — when the user asks about pricing, plans, limits, or 'how many",
    "images/videos can I make', explain these clearly:",
    "- VIP subscription ($9.99/month): 100 images, 20 videos, voice chat with your character",
    "  up to 360 minutes, storage for your info, unlimited text chat, and rating posts.",
    "- Basic subscription ($4.99/month): 35 images, 9 videos, voice chat up to 120 minutes,",
    "  storage for your info, and rating posts.",
    "- Top-up packs ($0.99 each): (a) 4 images + 2 videos, (b) 25 GB extra storage for 3",
    "  months, (c) 120 extra voice minutes with your character.",
    "- Text chat and basic voice are free. Image and video limits reset every month. When a",
    "  monthly limit is reached, the user can buy a top-up pack or upgrade their plan.",
    "Present these plainly and only when asked; do not push sales in normal conversation.",
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
export async function geminiChat(history: Turn[], locale: string, persona?: { name?: string; gender?: string }, image?: { data: string; mime: string }): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "not_configured" };

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);

  try {
    const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: ctrl.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt(locale, persona) }] },
        contents: history.map((h, idx) => {
          const parts: Array<Record<string, unknown>> = [{ text: h.text }];
          // Attach the uploaded image to the newest user turn so the AI can see it (fix #9).
          if (image && h.role === "user" && idx === history.length - 1) {
            parts.push({ inline_data: { mime_type: image.mime, data: image.data } });
          }
          return { role: h.role, parts };
        }),
        generationConfig: { temperature: 0.7, maxOutputTokens: 1200 },
      }),
    });

    if (res.status === 429) return { ok: false, error: "quota" };
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: "failed", detail: detail.slice(0, 300) };
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
  } catch {
    return { ok: false, error: "failed" };
  } finally {
    clearTimeout(timer);
  }
}
