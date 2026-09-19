import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";

const createSchema = z.object({
  title: z.string().min(2).max(120),
  durationMin: z.number().int().min(15).max(480).default(60),
  pricePerHour: z.number().min(0).max(1000).default(5),
  maxSeats: z.number().int().min(2).max(20).default(20), // hard cap 20
  allowAudio: z.boolean().default(true),
  allowText: z.boolean().default(true),
  allowVideo: z.boolean().default(false),
  inviteIds: z.array(z.string().max(40)).max(20).optional(), // people to notify about the room
  joinCode: z.string().min(4).max(8).optional(), // legacy; entry is host-approved now
  followersOnly: z.boolean().default(true),
  privacy: z.enum(["public", "announced", "hidden"]).default("public"),
  allowRecording: z.boolean().default(true),
  profileLive: z.boolean().default(false), // premium: show this room as a LIVE on my profile (45 min)
});

const PROFILE_LIVE_MINUTES = 45;

// GET /api/meetings — live rooms. Follower-only rooms are listed to the host's followers only.
export async function GET(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  const viewer = payload?.sub;

  const iFollow = viewer
    ? (await prisma.follow.findMany({ where: { userId: viewer }, select: { targetId: true } })).map((f) => f.targetId)
    : [];

  /**
   * Rooms this person was personally invited to.
   *
   * The followers rule below only reveals a followers-only room to people who FOLLOW the
   * host — so someone the host hand-picked in the invite list never saw the room at all
   * unless they happened to already follow them. They got a notification pointing at a room
   * that wasn't in their list.
   *
   * There's no invite table; `inviteIds` only ever created notifications. That row is a
   * perfectly good record of the invite, so it's used as one here rather than adding a
   * model (schema.prisma has unrelated in-progress work that must not ship).
   *
   * An explicit invitation outranks privacy — including "hidden", because the host chose
   * this person by hand.
   */
  const invitedTo = viewer
    ? (await prisma.notification
        .findMany({
          where: { userId: viewer, kind: "meeting_invite", targetId: { not: null } },
          select: { targetId: true },
          orderBy: { createdAt: "desc" },
          take: 200,
        })
        .catch(() => []))
        .map((n: { targetId: string | null }) => n.targetId)
        .filter((x): x is string => !!x)
    : [];

  const meetings = await prisma.meeting.findMany({
    where: {
      status: "live",
      // rooms whose time ran out stay out of the list
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }],
      // hidden rooms exist only for their host; the rest follow the followers rule
      ...(viewer
        ? {
            OR: [
              { hostId: viewer },
              { privacy: { not: "hidden" }, followersOnly: false },
              { privacy: { not: "hidden" }, followersOnly: true, hostId: { in: iFollow } },
              // personally invited — see it whatever the privacy setting
              ...(invitedTo.length ? [{ id: { in: invitedTo } }] : []),
            ],
          }
        : { privacy: { not: "hidden" }, followersOnly: false }),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      host: { select: { id: true, displayName: true, avatarUrl: true } },
      _count: { select: { participants: true } },
    },
  });
  return NextResponse.json({
    meetings: meetings.map((m) => ({
      id: m.id,
      title: m.title,
      host: m.host?.displayName ?? "",
      hostId: m.hostId,
      hostAvatar: m.host?.avatarUrl ?? null,
      seats: m.maxSeats,
      taken: m._count.participants,
      pricePerHour: m.pricePerHour,
      followersOnly: m.followersOnly,
      privacy: m.privacy,
      allowRecording: m.allowRecording,
      mine: m.hostId === viewer,
    })),
  });
}

// POST /api/meetings — create a room; host joins as participant.
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const d = parsed.data;

  // A profile live is a premium perk, and it always runs 45 minutes, then closes itself.
  if (d.profileLive) {
    const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isPremium: true } });
    if (!me?.isPremium) return NextResponse.json({ error: "premium_required" }, { status: 403 });
    d.durationMin = PROFILE_LIVE_MINUTES;
    // one live at a time — close any older profile lives still marked open
    await prisma.meeting.updateMany({
      where: { hostId: payload.sub, isProfileLive: true, status: "live" },
      data: { status: "ended" },
    });
  }

  const meeting = await prisma.meeting.create({
    data: {
      hostId: payload.sub,
      title: d.title.trim(),
      durationMin: d.durationMin,
      pricePerHour: d.pricePerHour,
      maxSeats: Math.min(d.maxSeats, 20),
      allowAudio: d.allowAudio,
      allowText: d.allowText,
      allowVideo: d.allowVideo,
      joinCode: (d.joinCode?.trim() || Math.random().toString(36).slice(2, 8)).toUpperCase(),
      // public rooms are for everyone; an announced room shows its title to friends only
      followersOnly: d.privacy === "public" ? false : d.privacy === "announced" ? true : d.followersOnly,
      privacy: d.privacy,
      allowRecording: d.allowRecording,
      isProfileLive: d.profileLive,
      endsAt: new Date(Date.now() + d.durationMin * 60 * 1000),
      participants: {
        create: { userId: payload.sub, role: "host", audioState: "talking", canAudio: true, canText: true, canVideo: d.allowVideo },
      },
    },
  });
  // Tell the host's followers they've gone live: a stored notification (shows in their
  // activity list and the badge count) plus a live socket ping so anyone currently in the
  // app sees it right away. Hidden rooms are private and never announce.
  if (d.privacy !== "hidden") {
    const followers = await prisma.follow.findMany({ where: { targetId: payload.sub }, select: { userId: true } });
    if (followers.length) {
      // notify() rather than notification.createMany(): createMany only writes the in-app
      // row, so the badge updated but no phone ever buzzed. notify() writes the same row AND
      // sends the FCM + web pushes, which is what "tell my followers I'm live" has to mean
      // for anyone who isn't already staring at the app.
      await Promise.all(
        followers.map((f: { userId: string }) =>
          notify(f.userId, "went_live", { actorId: payload.sub, targetId: meeting.id, text: meeting.title })
        )
      ).catch(() => {});
      try {
        const io = (globalThis as unknown as { __herotIo?: { to: (r: string) => { emit: (e: string, p: unknown) => void } } }).__herotIo;
        if (io) followers.forEach((f) => io.to(f.userId).emit("user:live", { hostId: payload.sub, meetingId: meeting.id, title: meeting.title }));
      } catch { /* socket optional — the stored notification is the reliable path */ }
    }
  }

  // Notify invited users (deduped, host excluded).
  if (d.inviteIds?.length) {
    const inviteIds = [...new Set(d.inviteIds)].filter((uid) => uid !== payload.sub).slice(0, 20);
    if (inviteIds.length) {
      // Same reason as above — an invite nobody is pushed is an invite nobody sees.
      await Promise.all(
        inviteIds.map((uid) =>
          notify(uid, "meeting_invite", { actorId: payload.sub, targetId: meeting.id, text: meeting.title })
        )
      ).catch(() => {});
    }
  }

  return NextResponse.json({ id: meeting.id }, { status: 201 });
}
