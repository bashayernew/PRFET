import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { haversineKm } from "@/lib/geo";
import { premiumLapsed } from "@/lib/premium";

// GET /api/users/[id] — one account (visibility-enforced), tracks a profile view.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = bearerFromRequest(req);
  const viewer = token ? verifyAccessToken(token)?.sub : undefined;

  const u = await prisma.user.findUnique({
    where: { id },
    include: {
      parent: { select: { id: true, displayName: true } },
      branches: { select: { id: true, displayName: true, avatarUrl: true } },
    },
  });
  if (!u) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // is this account the official sponsor?
  const appSettings = await prisma.appSettings.findUnique({ where: { id: "app" }, select: { sponsorUserId: true } });
  const isSponsor = !!appSettings?.sponsorUserId && appSettings.sponsorUserId === id;

  // Visibility enforcement: public = anyone; friends = owner or a follower only.
  if (u.visibility !== "public" && viewer !== id) {
    const isFollower = viewer ? await prisma.follow.findFirst({ where: { userId: viewer, targetId: id } }) : null;
    if (!isFollower) return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  /**
   * Count a profile view (never a self-view).
   *
   * At most ONE view per person per 24 hours. It used to increment on every single
   * request, so a refresh — or simply navigating back — inflated the number: the counter
   * read 14 while "Who viewed you" listed 2 people, which looked broken.
   */
  if (viewer && viewer !== id) {
    (async () => {
      const seen = await prisma.profileView.findUnique({
        where: { viewerId_targetId: { viewerId: viewer, targetId: id } },
        select: { updatedAt: true },
      });
      const fresh = !seen || Date.now() - seen.updatedAt.getTime() > 24 * 60 * 60 * 1000;
      if (fresh) {
        await prisma.user.update({ where: { id }, data: { profileViews: { increment: 1 } } });
      }
      await prisma.profileView.upsert({
        where: { viewerId_targetId: { viewerId: viewer, targetId: id } },
        update: { updatedAt: new Date() },
        create: { viewerId: viewer, targetId: id },
      });
    })().catch(() => {});
  }

  // can this viewer message them? (closed inbox = allow-list only)
  let canMessage = true;
  if (u.dmClosed && viewer && viewer !== id) {
    const allowed = await prisma.dmAllow.findUnique({ where: { userId_targetId: { userId: id, targetId: viewer } } }).catch(() => null);
    canMessage = !!allowed;
  }

  const [followers, following, liveStories, profileLive] = await Promise.all([
    prisma.follow.count({ where: { targetId: id } }),
    prisma.follow.count({ where: { userId: id } }),
    // a story only counts while it is still alive (24h)
    prisma.story.count({ where: { userId: id, expiresAt: { gt: new Date() } } }),
    // Only PUBLIC live rooms show on the profile — friends/private rooms stay off it.
    // Accept rooms whose end time hasn't passed OR isn't set (null), so a live room never
    // silently drops off the profile.
    prisma.meeting.findFirst({
      where: { hostId: id, status: "live", privacy: "public", OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
      orderBy: { isProfileLive: "desc" },
      select: { id: true, title: true },
    }),
  ]);

  // Distance between the viewer and this account.
  // Free accounts show a distance only; paid accounts can also show the precise pin.
  let distanceKm: string | null = null;
  if (viewer && viewer !== id && u.showDistance && u.locationLat != null && u.locationLng != null) {
    const me = await prisma.user.findUnique({ where: { id: viewer }, select: { locationLat: true, locationLng: true } });
    if (me?.locationLat != null && me?.locationLng != null) {
      distanceKm = haversineKm(me.locationLat, me.locationLng, u.locationLat, u.locationLng).toFixed(3);
    }
  }

  // A cancelled subscription that has run out counts as free everywhere it's read.
  const effPremium = u.isPremium && !premiumLapsed(u);

  // per-person location privacy check
  let coordsVisible = effPremium && u.shareLocation;
  if (coordsVisible && viewer && viewer !== id) {
    const hidden = await prisma.locationHide.findUnique({ where: { userId_targetId: { userId: id, targetId: viewer } } }).catch(() => null);
    if (hidden) coordsVisible = false;
  }
  return NextResponse.json({
    user: {
      id: u.id, displayName: u.displayName, category: u.category, bio: u.bio,
      rating: u.rating, reviews: u.reviews, online: u.online, avatarUrl: u.avatarUrl,
      accountType: u.accountType, country: u.country, address: u.address,
      isPremium: effPremium, textColor: effPremium ? u.textColor : null, isAdmin: u.isAdmin, gender: u.gender, nationality: u.nationality,
      // precise coordinates only when the owner is premium, sharing, and hasn't hidden it from this viewer
      shareLocation: u.shareLocation,
      locationLat: coordsVisible ? u.locationLat : null,
      locationLng: coordsVisible ? u.locationLng : null,
      social1: u.social1, social2: u.social2, social3: u.social3,
      profileViews: u.profileViews, followers, following,
      hasStory: liveStories > 0,
      liveId: profileLive?.id ?? null,
      liveTitle: profileLive?.title ?? null,
      dmClosed: u.dmClosed, canMessage,
      dist: distanceKm, showDistance: u.showDistance,
      // sponsor & branches (all admin-managed)
      isSponsor,
      promoVideoUrl: u.promoVideoUrl,
      promoLinkUrl: u.promoLinkUrl,
      parent: u.parent ? { id: u.parent.id, name: u.parent.displayName } : null,
      // admin-added branch tiles: name + link (no linked account)
      branches: (Array.isArray(u.branchLinks) ? (u.branchLinks as unknown[]) : [])
        .map((b) => (b && typeof b === "object" ? (b as Record<string, unknown>) : {}))
        .map((b) => ({ id: String(b.id ?? ""), name: String(b.name ?? ""), url: String(b.url ?? "") }))
        .filter((b) => b.id && b.name),
    },
  });
}
