import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

function auth(req: Request) {
  const token = bearerFromRequest(req);
  return token ? verifyAccessToken(token) : null;
}

export async function GET(req: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { targetId } = await params;
  const existing = await prisma.block.findUnique({ where: { userId_targetId: { userId: payload.sub, targetId } } });
  return NextResponse.json({ blocked: !!existing });
}

export async function POST(req: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { targetId } = await params;
  // Optional reason (stored for the moderation dashboard).
  let reason: string | null = null;
  try {
    const raw = (await req.json()) as { reason?: unknown };
    if (typeof raw?.reason === "string") reason = raw.reason.slice(0, 500).trim() || null;
  } catch { /* no body */ }
  await prisma.block.upsert({
    where: { userId_targetId: { userId: payload.sub, targetId } },
    create: { userId: payload.sub, targetId, reason },
    update: { reason: reason ?? undefined },
  });
  return NextResponse.json({ blocked: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { targetId } = await params;
  await prisma.block.deleteMany({ where: { userId: payload.sub, targetId } });
  return NextResponse.json({ blocked: false });
}
