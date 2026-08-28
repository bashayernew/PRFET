import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { premiumLapsed } from "@/lib/premium";
import { geminiChat, geminiConfigured, type Turn } from "@/lib/gemini";
import { msgCapCheck, msgBump } from "@/lib/ai-usage";
import { cacheKey, cacheGet, cacheSet } from "@/lib/ai-cache";

/**
 * The AI assistant.
 *
 * History is kept, but only "to some extent": each exchange prunes the member's thread
 * back to the newest MAX_KEPT rows, so conversations survive reloads and give the model
 * context, while old ones age out instead of growing forever.
 */
const MAX_KEPT = 40;   // rows retained per member (~20 exchanges)
const CONTEXT = 20;    // rows actually sent to the model as context

async function me(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return null;
  return prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, locale: true, isPremium: true, premiumUntil: true, autoRenew: true, isAdmin: true },
  });
}

/** Master switches from the dashboard: off entirely, or Premium-only. */
async function gate(user: { isPremium: boolean; premiumUntil: Date | null; autoRenew: boolean; isAdmin: boolean }) {
  const s = await prisma.appSettings.findUnique({
    where: { id: "app" },
    select: { aiEnabled: true, aiPremiumOnly: true },
  }).catch(() => null);

  if (s && s.aiEnabled === false) return "disabled" as const;
  if (s?.aiPremiumOnly && !user.isAdmin) {
    const effPremium = user.isPremium && !premiumLapsed(user as never);
    if (!effPremium) return "premium_only" as const;
  }
  return null;
}

// GET /api/ai/chat — the member's stored thread.
export async function GET(req: Request) {
  const user = await me(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const blocked = await gate(user);
  if (blocked) return NextResponse.json({ error: blocked, messages: [] }, { status: 403 });

  const rows = await prisma.aiMessage.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    take: MAX_KEPT,
  });

  return NextResponse.json({
    configured: geminiConfigured(),
    messages: rows.map((r) => ({ id: r.id, role: r.role, body: r.body, createdAt: r.createdAt.toISOString() })),
  });
}

const sendSchema = z.object({
  message: z.string().min(1).max(4000),
  persona: z.string().max(40).optional(),
  personaGender: z.enum(["male", "female"]).optional(),
  // Optional attached image (base64 + mime) so the AI can SEE it — multimodal (fix #9).
  image: z.object({ data: z.string().max(8_000_000), mime: z.string().max(60) }).optional(),
});

// POST /api/ai/chat — ask something, get the reply.
export async function POST(req: Request) {
  const user = await me(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // No per-minute throttle on chat — the ONLY limit is the dashboard-editable monthly cap below.

  const blocked = await gate(user);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });

  // Monthly assistant-message cap (dashboard-editable). Admins are unlimited.
  const cap = await msgCapCheck(user.id);
  if (!cap.allowed) return NextResponse.json({ error: "msg_limit" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = sendSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const text = parsed.data.message.trim();
  const locale = user.locale || "ar";

  // Token saver: if this member already asked the exact same thing (same language/persona),
  // reuse the answer we generated last time instead of calling the model again. The cache is
  // keyed per user, so an answer is only ever returned to the person who asked it.
  const img = parsed.data.image;
  const ckey = cacheKey(user.id, locale, parsed.data.persona, text);
  let replyText = img ? null : cacheGet(ckey); // image-based answers are never cached

  if (replyText === null) {
    // Recent turns for context, oldest-first.
    const recent = await prisma.aiMessage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: CONTEXT,
    });
    const history: Turn[] = recent
      .reverse()
      .map((r) => ({ role: r.role === "model" ? "model" : "user", text: r.body }));
    history.push({ role: "user", text });

    // Live plan prices + limits from the dashboard, so the assistant never quotes stale numbers.
    const st = await prisma.appSettings.findUnique({
      where: { id: "app" },
      select: {
        priceSubscription: true, priceVip: true, priceAddonMedia: true, priceAddonStorage: true,
        aiImagesBasic: true, aiVideosBasic: true, aiMessagesBasic: true, storageGbBasic: true,
        aiImagesVip: true, aiVideosVip: true, aiMessagesVip: true, storageGbVip: true,
      },
    }).catch(() => null);
    const plans = st ? {
      golden: { price: st.priceSubscription, images: st.aiImagesBasic, videos: st.aiVideosBasic, messages: st.aiMessagesBasic, storageGb: st.storageGbBasic },
      vip: { price: st.priceVip, images: st.aiImagesVip, videos: st.aiVideosVip, messages: st.aiMessagesVip, storageGb: st.storageGbVip },
      addons: { media: st.priceAddonMedia, storage: st.priceAddonStorage },
    } : undefined;

    const result = await geminiChat(history, locale, parsed.data.persona ? { name: parsed.data.persona, gender: parsed.data.personaGender } : undefined, img, plans);
    if (!result.ok) {
      // Nothing is stored on failure, so the member can simply try again.
      const status = result.error === "quota" ? 429 : result.error === "not_configured" ? 503 : 502;
      return NextResponse.json({ error: result.error }, { status });
    }
    replyText = result.text;
    if (!img) cacheSet(ckey, replyText); // remember only text-only answers
  }

  // Store the exchange (whether it came fresh from the model or from cache).
  await prisma.aiMessage.create({ data: { userId: user.id, role: "user", body: text } });
  const reply = await prisma.aiMessage.create({ data: { userId: user.id, role: "model", body: replyText } });
  await msgBump(user.id); // count this message against the monthly cap

  // Trim the thread back to the newest MAX_KEPT rows.
  const total = await prisma.aiMessage.count({ where: { userId: user.id } });
  if (total > MAX_KEPT) {
    const stale = await prisma.aiMessage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      take: total - MAX_KEPT,
      select: { id: true },
    });
    await prisma.aiMessage.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }

  return NextResponse.json({
    reply: { id: reply.id, role: "model", body: replyText, createdAt: reply.createdAt.toISOString() },
  });
}

// DELETE /api/ai/chat — clear my thread.
export async function DELETE(req: Request) {
  const user = await me(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await prisma.aiMessage.deleteMany({ where: { userId: user.id } });
  return NextResponse.json({ ok: true });
}
