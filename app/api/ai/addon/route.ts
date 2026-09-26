import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken, identifierWhere } from "@/lib/auth";
import { aiGrantAddon, ADDON_PACKS } from "@/lib/ai-usage";
import { spendCredits, toCents } from "@/lib/credits";
import { createInvoice, sendPurchaseNotice } from "@/lib/invoice";

/**
 * Buy an AI add-on pack (extra images/videos/storage) for the current month.
 *
 * ⚠️ This route used to grant a pack for FREE to anyone who asked. The comment called it
 * "a temporary stand-in until store billing is wired", which meant any member could call
 * it repeatedly and self-grant unlimited add-ons. It is now PAID, from the credit wallet.
 *
 * Why the wallet rather than a direct store purchase: ads and job posts already work this
 * way, because their prices are dynamic (base + per-country + per-day) and the stores only
 * allow fixed price points. Routing add-ons through the same balance means one top-up
 * covers everything, there are fewer store products to maintain, and a member who already
 * has credit can buy an add-on without another card transaction.
 *
 * Admin grants stay free — that is a deliberate comp, not a purchase.
 */
const schema = z.object({
  // Omit `user` to buy the pack for yourself; an admin may pass an email/phone to credit
  // someone else. (Self-serve is a temporary stand-in until store billing is wired.)
  user: z.string().min(1).max(160).optional(),
  pack: z.enum(["voice", "media", "storage"]), // the three buyable add-ons
  qty: z.number().int().min(1).max(50).optional(),
});

export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // Crediting another member requires admin. Buying for yourself does not.
  let targetId = payload.sub;
  let qty = parsed.data.qty ?? 1;
  if (parsed.data.user) {
    const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isAdmin: true } });
    if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const target = await prisma.user.findFirst({ where: identifierWhere(parsed.data.user.trim()), select: { id: true } });
    if (!target) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
    targetId = target.id;
  } else {
    qty = 1; // self-serve buys one pack at a time

    // Charge the wallet BEFORE granting, so a failed payment can't leave a granted pack.
    const s = await prisma.appSettings.findUnique({
      where: { id: "app" },
      select: { priceAddonVoice: true, priceAddonMedia: true, priceAddonStorage: true },
    });
    const price =
      parsed.data.pack === "voice" ? (s?.priceAddonVoice ?? 1.99)
      : parsed.data.pack === "media" ? (s?.priceAddonMedia ?? 1.99)
      : (s?.priceAddonStorage ?? 1.99);

    if (price > 0) {
      const paid = await spendCredits(targetId, toCents(price));
      if (!paid.ok) {
        // 402 with the shortfall so the app can offer a top-up of the right size.
        return NextResponse.json(
          { error: "insufficient_credits", price, needCents: paid.short, balanceCents: paid.balance },
          { status: 402 },
        );
      }
      await createInvoice({
        userId: targetId,
        kind: "addon",
        description: `Add-on pack — ${parsed.data.pack}`,
        amount: price,
      }).catch(() => {});
      sendPurchaseNotice(targetId, "addon", price, parsed.data.pack).catch(() => {});
    }
  }
  for (let i = 0; i < qty; i++) await aiGrantAddon(targetId, parsed.data.pack);

  const pack = ADDON_PACKS[parsed.data.pack];
  return NextResponse.json({
    ok: true,
    granted: {
      images: (pack.images ?? 0) * qty,
      videos: (pack.videos ?? 0) * qty,
      messages: (pack.messages ?? 0) * qty,
      minutes: (pack.minutes ?? 0) * qty,
      storageGb: (pack.storageGb ?? 0) * qty,
    },
  });
}
