import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";

async function requireAdmin(req: Request): Promise<string | null> {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return null;
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isAdmin: true } });
  return me?.isAdmin ? payload.sub : null;
}

// GET /api/admin/ads?q= — every ad, newest first, searchable by advertiser/caption.
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  const ads = await prisma.ad.findMany({
    where: q
      ? { OR: [{ caption: { contains: q, mode: "insensitive" } }, { user: { displayName: { contains: q, mode: "insensitive" } } }] }
      : {},
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { user: { select: { displayName: true } } },
  });
  return NextResponse.json({
    ads: ads.map((a) => ({
      id: a.id, caption: a.caption, mediaUrl: a.mediaUrl, country: a.country,
      status: a.status, views: a.views, advertiser: a.user.displayName, userId: a.userId,
      createdAt: a.createdAt.toISOString(),
    })),
  });
}

const schema = z.object({ id: z.string().min(1).max(40), action: z.enum(["stop", "delete", "activate"]) });

// POST /api/admin/ads — stop (pull it), delete (remove it), or re-activate an ad.
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const ad = await prisma.ad.findUnique({ where: { id: parsed.data.id }, select: { id: true, userId: true } });
  if (!ad) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (parsed.data.action === "delete") {
    await prisma.ad.delete({ where: { id: ad.id } });
    notify(ad.userId, "ad_removed", {}).catch(() => {});
  } else if (parsed.data.action === "stop") {
    await prisma.ad.update({ where: { id: ad.id }, data: { status: "rejected" } });
    notify(ad.userId, "ad_removed", {}).catch(() => {});
  } else {
    await prisma.ad.update({ where: { id: ad.id }, data: { status: "active" } });
  }
  return NextResponse.json({ ok: true });
}
