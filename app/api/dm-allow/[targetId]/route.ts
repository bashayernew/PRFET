import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

function auth(req: Request) {
  const token = bearerFromRequest(req);
  return token ? verifyAccessToken(token) : null;
}

// GET /api/dm-allow/[targetId] — may this person message me while my inbox is closed?
export async function GET(req: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { targetId } = await params;

  const row = await prisma.dmAllow.findUnique({
    where: { userId_targetId: { userId: payload.sub, targetId } },
  });
  return NextResponse.json({ allowed: !!row });
}

// POST — let this person through.
export async function POST(req: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { targetId } = await params;
  if (targetId === payload.sub) return NextResponse.json({ error: "self" }, { status: 400 });

  await prisma.dmAllow.upsert({
    where: { userId_targetId: { userId: payload.sub, targetId } },
    create: { userId: payload.sub, targetId },
    update: {},
  });
  return NextResponse.json({ allowed: true });
}

// DELETE — take the permission back.
export async function DELETE(req: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { targetId } = await params;

  await prisma.dmAllow.deleteMany({ where: { userId: payload.sub, targetId } });
  return NextResponse.json({ allowed: false });
}
