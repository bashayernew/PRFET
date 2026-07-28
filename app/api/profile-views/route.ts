import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// GET /api/profile-views — the people who viewed MY profile, most recent first.
export async function GET(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await prisma.profileView.findMany({
    where: { targetId: payload.sub },
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: { viewer: { select: { id: true, displayName: true, avatarUrl: true, country: true, accountType: true } } },
  });

  return NextResponse.json({
    viewers: rows.map((r) => ({
      id: r.viewer.id,
      name: r.viewer.displayName,
      avatarUrl: r.viewer.avatarUrl,
      country: r.viewer.country,
      accountType: r.viewer.accountType,
      at: r.updatedAt.toISOString(),
    })),
  });
}
