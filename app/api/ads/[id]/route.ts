import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// GET /api/ads/[id] — one ad, for the full-screen ad view.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ad = await prisma.ad.findUnique({
    where: { id },
    include: { user: { select: { id: true, displayName: true, avatarUrl: true, category: true, bio: true, isPremium: true, textColor: true } } },
  });
  if (!ad) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    ad: {
      id: ad.id,
      caption: ad.caption,
      mediaUrl: ad.mediaUrl,
      country: ad.country,
      status: ad.status,
      views: ad.views,
      createdAt: ad.createdAt.toISOString(),
      advertiser: ad.user,
    },
  });
}

// DELETE /api/ads/[id] — remove one of my own ads.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const ad = await prisma.ad.findUnique({ where: { id } });
  if (!ad) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (ad.userId !== payload.sub) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await prisma.ad.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
