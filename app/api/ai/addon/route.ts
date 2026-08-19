import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken, identifierWhere } from "@/lib/auth";
import { aiGrantAddon, ADDON_PACKS } from "@/lib/ai-usage";

/**
 * Credit an AI add-on pack (extra images/videos) to a member for the current month.
 *
 * SAFE BY DEFAULT: only an admin may call this. It is the single place that grants
 * add-on credit, so when Google Play billing is wired up, the store's server-to-server
 * purchase notification should verify the receipt and then call aiGrantAddon() — never
 * trust the client to self-grant.
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
