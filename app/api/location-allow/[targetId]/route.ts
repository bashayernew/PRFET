import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

/**
 * Per-person location allow-list — the inverse of /api/location-hide.
 *
 * Used when `locationMode = "chosen"`: the member's precise location is visible only to
 * the people listed here. Hiding from everyone one at a time (LocationHide) does not
 * scale, and gets the default wrong: it shares by accident with anyone newly met.
 */
function auth(req: Request) {
  const token = bearerFromRequest(req);
  return token ? verifyAccessToken(token) : null;
}

export async function GET(req: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { targetId } = await params;
  const existing = await prisma.locationAllow.findUnique({
    where: { userId_targetId: { userId: payload.sub, targetId } },
  });
  return NextResponse.json({ allowed: !!existing });
}

export async function POST(req: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { targetId } = await params;
  if (targetId === payload.sub) return NextResponse.json({ allowed: true }); // self is implicit
  await prisma.locationAllow.upsert({
    where: { userId_targetId: { userId: payload.sub, targetId } },
    create: { userId: payload.sub, targetId },
    update: {},
  });
  return NextResponse.json({ allowed: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { targetId } = await params;
  await prisma.locationAllow.deleteMany({ where: { userId: payload.sub, targetId } });
  return NextResponse.json({ allowed: false });
}
