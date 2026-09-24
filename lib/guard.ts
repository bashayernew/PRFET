import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { MODERATION_SELECT, featureDenial, type Feature, type ModerationState } from "@/lib/moderation";

/**
 * Authenticate a request AND check the caller isn't blocked from the feature it's for.
 *
 * Every write route that a member can be restricted from should start with this. Hiding a
 * button in the UI is presentation; this is the enforcement. Returns either a ready-made
 * error response or the caller's id.
 *
 * Usage:
 *   const g = await guard(req, "posts");
 *   if ("response" in g) return g.response;
 *   // g.userId is safe to use
 */
export async function guard(
  req: Request,
  feature: Feature,
): Promise<{ response: NextResponse } | { userId: string }> {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) {
    return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const me = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, isAdmin: true, ...MODERATION_SELECT },
  });
  if (!me) {
    return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  // Admins are exempt — otherwise a mis-click could lock the moderators out of the tools
  // they need to undo it.
  if (me.isAdmin) return { userId: me.id };

  const denial = featureDenial(me as ModerationState, feature);
  if (denial) return { response: NextResponse.json(denial, { status: 403 }) };

  return { userId: me.id };
}
