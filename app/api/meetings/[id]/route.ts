import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// GET /api/meetings/[id] — room detail, participants, and the viewer's access state.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  const viewer = payload?.sub;

  const m = await prisma.meeting.findUnique({
    where: { id },
    include: {
      participants: { include: { user: { select: { displayName: true, avatarUrl: true } } } },
      host: { select: { id: true, displayName: true, avatarUrl: true } },
    },
  });
  if (!m) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Viewer access: host / already inside / approved by the host / kicked / nothing yet.
  let access: "host" | "member" | "approved" | "kicked" | "none" = "none";
  if (viewer) {
    if (m.hostId === viewer) access = "host";
    else {
      const p = m.participants.find((x) => x.userId === viewer);
      if (p?.kicked) access = "kicked";
      else if (p) access = "member";
      else {
        const jr = await prisma.meetingJoinRequest.findUnique({ where: { meetingId_userId: { meetingId: id, userId: viewer } } });
        if (jr?.status === "approved") access = "approved";
      }
    }
  }

  // Pending join requests (host only).
  let pendingJoins: { userId: string; name: string; avatarUrl: string | null }[] = [];
  if (access === "host") {
    const rows = await prisma.meetingJoinRequest.findMany({
      where: { meetingId: id, status: "pending" },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { displayName: true, avatarUrl: true } } },
    });
    pendingJoins = rows.map((r) => ({ userId: r.userId, name: r.user?.displayName ?? "", avatarUrl: r.user?.avatarUrl ?? null }));
  }

  // Did I already ask to join?
  let myJoinStatus: string | null = null;
  if (viewer && access === "none") {
    const jr = await prisma.meetingJoinRequest.findUnique({ where: { meetingId_userId: { meetingId: id, userId: viewer } } });
    myJoinStatus = jr?.status ?? null;
  }

  return NextResponse.json({
    meeting: {
      id: m.id, title: m.title, hostId: m.hostId, maxSeats: m.maxSeats, status: m.status,
      hostName: m.host?.displayName ?? "", hostAvatar: m.host?.avatarUrl ?? null,
      allowAudio: m.allowAudio, allowText: m.allowText, allowVideo: m.allowVideo,
      allowRecording: m.allowRecording, followersOnly: m.followersOnly, privacy: m.privacy,
      access, myJoinStatus, pendingJoins,
      // The roster is only for people actually in the room — outsiders (incl. those still at
      // the gate of a private/hidden room) get the count but not who's inside.
      participants: (access === "host" || access === "member")
        ? m.participants
            .filter((p) => !p.kicked)
            .map((p) => ({
              id: p.userId, name: p.user?.displayName ?? "", avatarUrl: p.user?.avatarUrl ?? null,
              role: p.role, audioState: p.audioState, canAudio: p.canAudio, canText: p.canText, canVideo: p.canVideo,
              canScreen: p.canScreen, onStage: p.onStage, wants: p.wants, blocked: p.blocked,
            }))
        : [],
    },
  });
}
