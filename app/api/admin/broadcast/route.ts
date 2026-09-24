import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { channelAccount, sendChannelDM, type ChannelKey } from "@/lib/broadcast";
import { premiumLapsed } from "@/lib/premium";

/** Admin-only guard. */
async function requireAdmin(req: Request): Promise<string | null> {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return null;
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isAdmin: true } });
  return me?.isAdmin ? payload.sub : null;
}

const schema = z.object({
  /** Which identity it arrives from. Defaults to admin so older callers keep working. */
  channel: z.enum(["admin", "news"]).default("admin"),
  scope: z.enum(["user", "countries", "all"]),
  /** Audience filter, applied to countries and all. Ignored for a single person. */
  tier: z.enum(["all", "premium", "free"]).default("all"),
  userId: z.string().max(40).optional(),
  countries: z.array(z.string().max(4)).max(60).optional(),
  body: z.string().min(1).max(2000),
  mediaUrl: z.string().max(500).optional(),
  mediaKind: z.enum(["image", "video"]).optional(),
  linkUrl: z.string().max(500).optional(),
});

// GET /api/admin/broadcast — the channel identities, so the dashboard can show and rename them.
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [adminCh, newsCh] = await Promise.all([channelAccount("admin"), channelAccount("news")]);
  return NextResponse.json({ channels: { admin: adminCh, news: newsCh } });
}

// PATCH /api/admin/broadcast — rename a channel (or set its avatar).
export async function PATCH(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const patch = z.object({
    channel: z.enum(["admin", "news"]),
    displayName: z.string().trim().min(1).max(80).optional(),
    avatarUrl: z.string().max(2000000).nullable().optional(),
  });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = patch.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const ch = await channelAccount(parsed.data.channel as ChannelKey);
  const updated = await prisma.user.update({
    where: { id: ch.id },
    data: {
      ...(parsed.data.displayName ? { displayName: parsed.data.displayName } : {}),
      ...(parsed.data.avatarUrl !== undefined ? { avatarUrl: parsed.data.avatarUrl } : {}),
    },
    select: { id: true, displayName: true, avatarUrl: true },
  });
  return NextResponse.json({ ok: true, channel: updated });
}

// POST /api/admin/broadcast — send from a channel to one person, to countries, or to everyone.
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const d = parsed.data;

  const channel = await channelAccount(d.channel as ChannelKey);

  // Resolve the recipient list.
  let ids: string[] = [];
  if (d.scope === "user") {
    if (!d.userId) return NextResponse.json({ error: "no_user" }, { status: 400 });
    ids = [d.userId];
  } else {
    if (d.scope === "countries" && !d.countries?.length) {
      return NextResponse.json({ error: "no_countries" }, { status: 400 });
    }

    // Premium is checked in code rather than SQL because an expired-but-not-yet-swept
    // subscription still has isPremium=true in the row; premiumLapsed is the real test,
    // and the same one the rest of the app uses.
    const rows = await prisma.user.findMany({
      where: {
        ...(d.scope === "countries" ? { country: { in: d.countries! } } : {}),
        // Never broadcast to soft-deleted accounts.
        disabledAt: null,
        // Nor to the channel identities themselves.
        systemKey: null,
      },
      select: { id: true, isPremium: true, premiumUntil: true, autoRenew: true },
    });

    const wanted = rows.filter((u) => {
      if (d.tier === "all") return true;
      const active = u.isPremium && !premiumLapsed(u as never);
      return d.tier === "premium" ? active : !active;
    });
    ids = wanted.map((u) => u.id);
  }

  // Sent sequentially: a few thousand parallel writes would bury the single small
  // Postgres instance. Slower, but it finishes.
  let sent = 0;
  for (const uid of ids) {
    if (await sendChannelDM(channel.id, uid, {
      body: d.body,
      mediaUrl: d.mediaUrl ?? null,
      mediaKind: d.mediaKind ?? null,
      linkUrl: d.linkUrl ?? null,
    })) sent++;
  }

  console.log(`[broadcast] ${d.channel} -> ${d.scope}/${d.tier} | ${sent}/${ids.length} delivered`);
  return NextResponse.json({ sent, total: ids.length, from: channel.displayName });
}
