import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { geminiChat } from "@/lib/gemini";

// One-shot AI text generation (not stored). Powers the "Write with AI" buttons on
// the ad and job screens. Text only — no paid image/voice services.
const schema = z.object({
  kind: z.enum(["job_ad", "ad_caption", "cv", "generic"]),
  prompt: z.string().min(1).max(2000),
});

const INSTRUCTIONS: Record<string, string> = {
  job_ad: "Write a clear, attractive job-vacancy post from the details below. Concise, professional, ready to publish. Output ONLY the post text, no preamble.",
  ad_caption: "Write a short, catchy commercial ad caption from the details below. 1–3 sentences, ready to publish. Output ONLY the caption, no preamble.",
  cv: "Write a professional CV / experience summary from the details below. Output ONLY the text, no preamble.",
  generic: "Complete the request below. Output ONLY the result, no preamble.",
};

export async function POST(req: Request) {
  const rl = rateLimit(req, "ai-gen", 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { locale: true } });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const text = `${INSTRUCTIONS[parsed.data.kind]}\n\nDetails:\n${parsed.data.prompt}`;
  const result = await geminiChat([{ role: "user", text }], me?.locale || "ar");
  if (!result.ok) {
    const status = result.error === "quota" ? 429 : result.error === "not_configured" ? 503 : 502;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ text: result.text });
}
