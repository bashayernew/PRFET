"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowRight, ArrowLeft, ImagePlus, CircleDashed,
  UploadCloud, Repeat2, Bookmark, MessageCircle, X, Sparkles, Video,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, apiPost, apiUpload, getAccessToken } from "@/lib/api";
import BottomNav from "@/components/bottom-nav";

type Mode = "hub" | "post";

/** The + tab: publish a post, a reel or a story — and the rules that come with it. */
export default function CreateScreen() {
  const router = useRouter();
  const { t, dir } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [mode, setMode] = useState<Mode>("hub");
  const [toast, setToast] = useState<string | null>(null);
  const storyRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  // Story straight from the hub — 24h, no rules needed.
  async function postStory(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    const token = getAccessToken() || undefined;
    const up = await apiUpload<{ url: string }>("/api/upload", file, token);
    if (up.ok && up.data?.url) {
      const kind = file.type.startsWith("video") ? "video" : "image";
      const res = await apiPost("/api/stories", { kind, mediaUrl: up.data.url }, token);
      setBusy(false);
      if (res.ok) { flash(t("create.storyPosted")); return; }
    }
    setBusy(false);
    flash(t("create.failed"));
  }

  if (!ready) return null;

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      <div className="shrink-0 bg-gradient-to-b from-brand-700 to-brand-600 px-5 pb-5 pt-[calc(env(safe-area-inset-top)+16px)]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => (mode === "hub" ? router.push("/home") : setMode("hub"))}
            aria-label={t("back")}
            className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white active:scale-95"
          >
            <Back className="h-5 w-5" strokeWidth={2.4} />
          </button>
          <h1 className="text-[18px] font-extrabold text-white">
            {t(mode === "post" ? "create.post" : "create.title")}
          </h1>
        </div>
        {mode === "hub" && <p className="mt-1.5 ps-[52px] text-[12.5px] font-medium text-white/75">{t("create.subtitle")}</p>}
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-6 pt-5">
        {mode === "hub" ? (
          <div className="flex flex-col gap-4">
            <HubCard
              icon={<ImagePlus className="h-6 w-6" />}
              title={t("create.post")}
              sub={t("create.postSub")}
              tint="from-brand-700 to-brand-500"
              onClick={() => setMode("post")}
            />
            <HubCard
              icon={<CircleDashed className="h-6 w-6" />}
              title={t("create.story")}
              sub={t("create.storySub")}
              tint="from-amber-600 to-rose-500"
              onClick={() => storyRef.current?.click()}
            />
            {/* Reel removed, and ads are a subscription feature reached from their own tab (per client) */}
            <input ref={storyRef} type="file" accept="image/*,video/*" hidden onChange={postStory} />
            {busy && <p className="text-center text-[13px] font-bold text-muted">{t("create.uploading")}</p>}
          </div>
        ) : (
          <Composer
            t={t}
            onDone={(msg) => { flash(msg); setMode("hub"); router.push("/feed"); }}
            onFail={(msg) => flash(msg)}
          />
        )}
      </div>

      {toast && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="pointer-events-none absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white shadow-lg">
          {toast}
        </motion.div>
      )}

      <BottomNav active="create" />
    </div>
  );
}

function HubCard({ icon, title, sub, tint, onClick }: { icon: React.ReactNode; title: string; sub: string; tint: string; onClick: () => void }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={`flex items-center gap-4 rounded-3xl bg-gradient-to-l ${tint} p-5 text-start shadow-sm active:scale-[0.99]`}
    >
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/20 text-white">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-extrabold text-white">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-white/80">{sub}</span>
      </span>
    </motion.button>
  );
}

/** Media + caption + the three publishing rules. */
function Composer({
  t,
  onDone,
  onFail,
}: {
  t: (k: string) => string;
  onDone: (msg: string) => void;
  onFail: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<"image" | "video">("image"); // photo or video post
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [allowRepost, setAllowRepost] = useState(true);
  const [allowSave, setAllowSave] = useState(true);
  const [allowComment, setAllowComment] = useState(true);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMediaBusy, setAiMediaBusy] = useState<null | "image" | "video">(null);

  const kind = media;
  const MAX_MB = kind === "video" ? 120 : 25;

  // Switch between a photo post and a video post; clear any chosen media so types don't cross.
  function switchType(next: "image" | "video") {
    if (next === media) return;
    setMedia(next);
    setFile(null);
    setPreview(null);
  }

  // Turn a base64 data-URL (what the AI endpoints return) into a real File we can upload normally.
  async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], name, { type: blob.type || "application/octet-stream" });
  }

  // "Generate with AI" (image or video): describe it, the AI makes it, and it drops into the composer.
  async function generateMedia() {
    if (aiMediaBusy) return;
    const isVideo = media === "video";
    const idea = typeof window !== "undefined"
      ? (window.prompt(t(isVideo ? "create.aiVideoPrompt" : "create.aiImagePrompt")) || "")
      : "";
    if (!idea.trim()) return;
    setAiMediaBusy(isVideo ? "video" : "image");
    const token = getAccessToken() || undefined;
    try {
      let dataUrl: string | undefined;
      if (!isVideo) {
        const res = await apiPost<{ url?: string; error?: string }>("/api/ai/image", { prompt: idea.trim() }, token);
        if (!res.ok || !res.data?.url) throw new Error(res.data?.error || "failed");
        dataUrl = res.data.url;
      } else {
        // video is async: start the job, then poll until it's rendered.
        const start = await apiPost<{ op?: string; error?: string }>("/api/ai/video", { prompt: `${idea.trim()}. With natural ambient sound and fitting background music. Any spoken narration, dialogue, or on-screen text must be in the SAME language as this description.` }, token);
        if (!start.ok || !start.data?.op) throw new Error(start.data?.error || "failed");
        const op = start.data.op;
        for (let i = 0; i < 40; i++) { // ~40 × 5s = up to ~3.5 min
          await new Promise((r) => setTimeout(r, 5000));
          const poll = await apiGet<{ done?: boolean; url?: string; error?: string }>(`/api/ai/video?op=${encodeURIComponent(op)}`, token);
          if (poll.ok && poll.data?.done && poll.data.url) { dataUrl = poll.data.url; break; }
          if (!poll.ok) throw new Error(poll.data?.error || "failed");
        }
        if (!dataUrl) throw new Error("timeout");
      }
      const f = await dataUrlToFile(dataUrl, isVideo ? "ai-video.mp4" : "ai-image.png");
      setFile(f);
      setPreview(URL.createObjectURL(f));
    } catch {
      onFail(t("create.aiMediaFailed"));
    } finally {
      setAiMediaBusy(null);
    }
  }

  // "Write with AI" (#17): turn a short idea (or the current caption) into a ready-to-post caption.
  async function generateCaption() {
    if (aiBusy) return;
    const idea = caption.trim() || (typeof window !== "undefined" ? window.prompt(t("create.aiPrompt")) || "" : "");
    if (!idea.trim()) return;
    setAiBusy(true);
    const token = getAccessToken() || undefined;
    const res = await apiPost<{ text?: string; error?: string }>("/api/ai/generate", { kind: "post", prompt: idea }, token);
    setAiBusy(false);
    if (res.ok && res.data?.text) setCaption(res.data.text);
    else onFail(t("create.aiFailed"));
  }

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) { onFail(t("create.tooLarge").replace("{mb}", String(MAX_MB))); return; }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function publish() {
    if (!file || busy) return;
    setBusy(true);
    const token = getAccessToken() || undefined;

    const up = await apiUpload<{ url: string; error?: string; limitMb?: number }>("/api/upload", file, token);
    if (!up.ok || !up.data?.url) {
      setBusy(false);
      // say what actually went wrong instead of a blanket "try again"
      const err = up.data?.error;
      if (up.status === 413 || err === "too_large") {
        onFail(t("create.tooLarge").replace("{mb}", String(up.data?.limitMb ?? (kind === "video" ? 120 : 25))));
      } else if (err === "bad_type") {
        onFail(t("create.badType"));
      } else if (up.status === 429) {
        onFail(t("create.tooMany"));
      } else if (up.status === 401) {
        onFail(t("create.signedOut"));
      } else {
        onFail(t("create.uploadFailed"));
      }
      return;
    }

    const res = await apiPost("/api/posts", {
      kind,
      mediaUrl: up.data.url,
      caption: caption.trim() || undefined,
      allowRepost,
      allowSave,
      allowComment,
    }, token);
    setBusy(false);
    if (res.ok) onDone(t("create.posted"));
    else onFail(t("create.failed"));
  }

  return (
    <div>
      {/* photo / video toggle */}
      <div className="mb-3 flex gap-1 rounded-2xl bg-white p-1 ring-1 ring-slate-200">
        <TypeTab active={media === "image"} icon={<ImagePlus className="h-4 w-4" />} label={t("create.typePhoto")} onClick={() => switchType("image")} />
        <TypeTab active={media === "video"} icon={<Video className="h-4 w-4" />} label={t("create.typeVideo")} onClick={() => switchType("video")} />
      </div>

      {/* media */}
      {preview ? (
        <div className="relative overflow-hidden rounded-3xl bg-black">
          {kind === "video" ? (
            <video src={preview} controls playsInline className="max-h-[42dvh] w-full object-contain" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="max-h-[42dvh] w-full object-contain" />
          )}
          <button
            onClick={() => { setFile(null); setPreview(null); }}
            aria-label={t("close")}
            className="absolute end-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!!aiMediaBusy}
            className="flex h-44 w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-slate-300 bg-white text-muted active:scale-[0.99] disabled:opacity-60"
          >
            <UploadCloud className="h-8 w-8" />
            <span className="text-[13.5px] font-bold">{t(kind === "video" ? "create.pickVideo" : "create.pickImage")}</span>
            <span className="text-[11px] font-medium text-slate-400">{t("create.maxSize").replace("{mb}", String(MAX_MB))}</span>
          </button>
          {/* let the AI make the media from a description */}
          <button
            type="button"
            onClick={generateMedia}
            disabled={!!aiMediaBusy}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-50 py-3 text-[13.5px] font-bold text-brand-700 ring-1 ring-brand-200 active:scale-[0.99] disabled:opacity-60"
          >
            <Sparkles className="h-4 w-4" />
            {aiMediaBusy
              ? t(aiMediaBusy === "video" ? "create.aiMakingVideo" : "create.aiMaking")
              : t(kind === "video" ? "create.aiMakeVideo" : "create.aiMakeImage")}
          </button>
        </>
      )}
      <input ref={fileRef} type="file" accept={kind === "video" ? "video/*" : "image/*"} hidden onChange={pick} />

      {/* caption */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[12.5px] font-bold text-ink">{t("create.caption")}</span>
          <button
            type="button"
            onClick={generateCaption}
            disabled={aiBusy}
            className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[11.5px] font-bold text-brand-700 ring-1 ring-brand-200 active:scale-95 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" /> {aiBusy ? t("create.aiWriting") : t("create.aiWrite")}
          </button>
        </div>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={3}
          placeholder={t("create.captionHint")}
          className="w-full resize-none rounded-2xl border-2 border-slate-200 bg-white p-3.5 text-[14px] font-medium text-ink outline-none focus:border-brand-500"
        />
      </div>

      {/* rules */}
      <div className="mt-2 rounded-3xl bg-white p-4 ring-1 ring-slate-100">
        <p className="mb-1 text-[13px] font-extrabold text-ink">{t("create.rules")}</p>
        <p className="mb-3 text-[11.5px] font-medium leading-snug text-muted">{t("create.rulesHint")}</p>
        <Rule icon={<Repeat2 className="h-[18px] w-[18px]" />} label={t("create.allowRepost")} on={allowRepost} onToggle={() => setAllowRepost((v) => !v)} />
        <Rule icon={<Bookmark className="h-[18px] w-[18px]" />} label={t("create.allowSave")} on={allowSave} onToggle={() => setAllowSave((v) => !v)} />
        <Rule icon={<MessageCircle className="h-[18px] w-[18px]" />} label={t("create.allowComment")} on={allowComment} onToggle={() => setAllowComment((v) => !v)} last />
      </div>

      <button
        onClick={publish}
        disabled={!file || busy}
        className="mt-5 h-12 w-full rounded-2xl bg-brand-600 text-[15px] font-extrabold text-white disabled:opacity-40 active:scale-[0.99]"
      >
        {busy ? t("create.uploading") : t("create.publish")}
      </button>
    </div>
  );
}

function TypeTab({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-bold transition-colors ${active ? "bg-brand-600 text-white" : "text-muted"}`}
    >
      {icon}{label}
    </button>
  );
}

function Rule({ icon, label, on, onToggle, last }: { icon: React.ReactNode; label: string; on: boolean; onToggle: () => void; last?: boolean }) {
  return (
    <button
      onClick={onToggle}
      className={`flex w-full items-center gap-3 py-3 ${last ? "" : "border-b border-slate-100"}`}
    >
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${on ? "bg-brand-50 text-brand-600" : "bg-slate-100 text-muted"}`}>{icon}</span>
      <span className="flex-1 text-start text-[13.5px] font-bold text-ink">{label}</span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-brand-600" : "bg-slate-200"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "start-[22px]" : "start-0.5"}`} />
      </span>
    </button>
  );
}
