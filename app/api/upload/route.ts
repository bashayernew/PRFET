import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { writeFile, mkdir, unlink } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import crypto from "crypto";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { storageCheck, storageBump } from "@/lib/ai-usage";

const run = promisify(execFile);

/**
 * Voice notes: iPhones record mp4/aac, Androids record webm/opus, and Safari cannot play
 * webm at all — so a voice note recorded on Android would be silent on an iPhone.
 * We re-encode every audio upload to .m4a (AAC), which both platforms play.
 * If ffmpeg isn't available we keep the original rather than losing the message.
 */
async function toM4a(dir: string, srcName: string): Promise<string> {
  const src = path.join(dir, srcName);
  if (srcName.endsWith(".m4a")) return srcName;
  const outName = `${srcName.replace(/\.[^.]+$/, "")}.m4a`;
  const out = path.join(dir, outName);
  try {
    await run("ffmpeg", ["-y", "-i", src, "-vn", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", out]);
    await unlink(src).catch(() => {});
    return outName;
  } catch {
    return srcName; // no ffmpeg — serve what we got
  }
}

export const runtime = "nodejs";

// Phone videos are big: a short reel off an iPhone is easily 40–80 MB, so a flat 20 MB
// cap meant every reel upload failed. Images/audio stay small; video gets real room.
const MAX_IMAGE = 25 * 1024 * 1024; // 25 MB
const MAX_AUDIO = 25 * 1024 * 1024; // 25 MB
const MAX_VIDEO = 120 * 1024 * 1024; // 120 MB

// POST /api/upload — self-hosted file storage (no third party).
// Saves to /public/uploads and returns the served URL.
export async function POST(req: Request) {
  const rl = rateLimit(req, "upload", 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });

  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  const isAudio = file.type.startsWith("audio/");
  if (!isImage && !isVideo && !isAudio) {
    return NextResponse.json({ error: "bad_type" }, { status: 415 });
  }
  const limit = isVideo ? MAX_VIDEO : isAudio ? MAX_AUDIO : MAX_IMAGE;
  if (file.size > limit) {
    return NextResponse.json({ error: "too_large", limitMb: Math.round(limit / (1024 * 1024)) }, { status: 413 });
  }

  // Per-tier storage cap (dashboard-editable). Admins are unlimited.
  const room = await storageCheck(payload.sub, file.size);
  if (!room.allowed) {
    return NextResponse.json({ error: "storage_full", capGb: Math.round(room.cap / (1024 * 1024 * 1024)) }, { status: 413 });
  }

  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
  const name = `${crypto.randomUUID()}.${ext}`;
  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));

  const finalName = file.type.startsWith("audio/") ? await toM4a(dir, name) : name;

  await storageBump(payload.sub, file.size); // count it against the user's storage cap

  return NextResponse.json({ url: `/uploads/${finalName}`, name: file.name, type: file.type });
}
