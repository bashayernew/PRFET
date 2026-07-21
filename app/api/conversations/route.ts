import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// GET /api/conversations — list the current user's conversations with a preview.
export async function GET(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { dmClosed: true } });
  const allowIds = me?.dmClosed
    ? new Set((await prisma.dmAllow.findMany({ where: { userId: payload.sub }, select: { targetId: true } })).map((a) => a.targetId))
    : new Set<string>();

  const convos = await prisma.conversation.findMany({
    where: { userId: payload.sub },
    orderBy: { updatedAt: "desc" },
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  // Resolve peer display info in one query.
  const peerIds = convos.map((c) => c.peerId);
  const peers = await prisma.user.findMany({
    where: { id: { in: peerIds } },
    select: { id: true, displayName: true, avatarUrl: true, category: true, online: true, isPremium: true, textColor: true },
  });
  const pmap = new Map(peers.map((p) => [p.id, p]));

  const items = await Promise.all(
    convos.map(async (c) => {
      const unread = await prisma.message.count({
        where: {
          conversationId: c.id,
          fromMe: false,
          ...(c.lastReadAt ? { createdAt: { gt: c.lastReadAt } } : {}),
        },
      });
      const last = c.messages[0];
      const peer = pmap.get(c.peerId);
      return {
        peerId: c.peerId,
        peerName: peer?.displayName ?? null,
        peerAvatar: peer?.avatarUrl ?? null,
        peerAllowed: allowIds.has(c.peerId),
        peerIsPremium: peer?.isPremium ?? false,
        peerTextColor: peer?.textColor ?? null,
        peerCategory: peer?.category ?? null,
        peerOnline: peer?.online ?? false,
        lastBody: last?.body ?? null,
        lastKind: last?.kind ?? null,
        lastAt: (last?.createdAt ?? c.updatedAt).toISOString(),
        lastFromMe: last?.fromMe ?? true,
        unread,
      };
    })
  );

  return NextResponse.json({ conversations: items, dmClosed: !!me?.dmClosed });
}
