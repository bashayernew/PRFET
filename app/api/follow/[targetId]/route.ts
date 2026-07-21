import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";

function auth(req: Request) {
  const token = bearerFromRequest(req);
  return token ? verifyAccessToken(token) : null;
}

async function followerCount(targetId: string) {
  return prisma.follow.count({ where: { targetId } });
}

// GET — is the current user following this target, and how many follow it.
export async function GET(req: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { targetId } = await params;

  const existing = await prisma.follow.findUnique({
    where: { userId_targetId: { userId: payload.sub, targetId } },
  });
  return NextResponse.json({ following: !!existing, followers: await followerCount(targetId) });
}

// POST — follow (idempotent).
export async function POST(req: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { targetId } = await params;

  const created = await prisma.follow.upsert({
    where: { userId_targetId: { userId: payload.sub, targetId } },
    create: { userId: payload.sub, targetId },
    update: {},
  });
  // notify the followed account (best-effort; ignores non-user targets)
  if (created) notify(targetId, "new_follower", { actorId: payload.sub }).catch(() => {});
  return NextResponse.json({ following: true, followers: await followerCount(targetId) });
}

// DELETE — unfollow (idempotent).
export async function DELETE(req: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { targetId } = await params;

  await prisma.follow.deleteMany({ where: { userId: payload.sub, targetId } });
  return NextResponse.json({ following: false, followers: await followerCount(targetId) });
}
