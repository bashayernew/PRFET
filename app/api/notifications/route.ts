import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

function auth(req: Request) {
  const token = bearerFromRequest(req);
  return token ? verifyAccessToken(token) : null;
}

// GET — list notifications + unread count.
export async function GET(req: Request) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: payload.sub }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.notification.count({ where: { userId: payload.sub, readAt: null } }),
  ]);

  // Attach whoever caused each notification, so the list can say "BESHOO liked your post".
  const actorIds = [...new Set(items.map((n) => n.actorId).filter((x): x is string => !!x))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true, avatarUrl: true, isPremium: true, textColor: true } })
    : [];
  const byId = new Map(actors.map((a) => [a.id, a]));

  function link(n: { kind: string; targetId: string | null; actorId: string | null }) {
    if (n.kind === "new_message") return n.actorId ? `/messages/${n.actorId}` : "/messages";
    if (n.kind.startsWith("post_")) return n.targetId ? `/post/${n.targetId}` : "/home";
    if (n.kind === "meeting_invite") return n.targetId ? `/meetings/${n.targetId}` : "/meetings";
    if (n.kind === "new_follower") return n.actorId ? `/business/${n.actorId}` : "";
    if (n.kind === "ad_review") return "/ads";
    if (n.kind === "job_expired") return n.targetId ? `/job/${n.targetId}` : "/jobs";
    if (n.kind === "seeker_expired") return "/jobs";
    if (n.kind === "ad_ending") return "/ads";
    if (n.kind === "job_ending") return n.targetId ? `/job/${n.targetId}` : "/jobs";
    if (n.kind === "seeker_ending") return "/jobs";
    if (n.kind === "sub_renewing" || n.kind === "sub_ending" || n.kind === "sub_renewed" || n.kind === "sub_ended") return "/settings";
    if (n.kind === "sponsor_appointed") return "/sponsor";
    if (n.kind === "branch_linked") return "/profile";
    if (n.kind === "admin_appointed") return "/profile";
    if (n.kind === "ad_removed") return "/ads";
    if (n.kind === "job_removed") return "/jobs";
    if (n.kind === "ai_checkin") return "/ask";
    if (n.kind === "job_application") return n.targetId ? `/job/${n.targetId}` : "/jobs";
    return "";
  }

  return NextResponse.json({
    unread,
    notifications: items.map((n) => ({
      id: n.id,
      kind: n.kind,
      data: n.data,
      actor: n.actorId ? byId.get(n.actorId) ?? null : null,
      href: link(n),
      read: !!n.readAt,
      createdAt: n.createdAt.toISOString(),
    })),
  });
}

// POST — mark all as read.
export async function POST(req: Request) {
  const payload = auth(req);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await prisma.notification.updateMany({
    where: { userId: payload.sub, readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
