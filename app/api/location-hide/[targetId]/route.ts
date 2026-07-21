import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

function auth(req: Request) {
  const token = bearerFromRequest(req);
  return token ? verifyAccessToken(token) : null;
}

// Per-person location privacy: am I hiding my location from this user?
export async function GET(req: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { targetId } = await params;
  const existing = await prisma.locationHide.findUnique({ where: { userId_targetId: { userId: payload.sub, targetId } } });
  return NextResponse.json({ hidden: !!existing });
}

export async function POST(req: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { targetId } = await params;
  await prisma.locationHide.upsert({
    where: { userId_targetId: { userId: payload.sub, targetId } },
    create: { userId: payload.sub, targetId },
    update: {},
  });
  return NextResponse.json({ hidden: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { targetId } = await params;
  await prisma.locationHide.deleteMany({ where: { userId: payload.sub, targetId } });
  return NextResponse.json({ hidden: false });
}
