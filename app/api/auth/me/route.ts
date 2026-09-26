import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isReservedRed, NAME_COLORS } from "@/lib/vip";
import { bearerFromRequest, verifyAccessToken, publicUser, normalizePhone, hashPassword } from "@/lib/auth";
import { isCountryClosed } from "@/lib/closed";
import { expireIfLapsed } from "@/lib/premium";
import { moderationSummary } from "@/lib/moderation";

export async function GET(req: Request) {
  const token = bearerFromRequest(req);
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = verifyAccessToken(token);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const found = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!found) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // A cancelled subscription that ran out drops the account back to free.
  const user = await expireIfLapsed(found);

  // Heartbeat for the AI absence check-ins: they're here now, so clear any pending pings.
  if (found.checkin8Sent || found.checkin24Sent || !found.lastSeenAt) {
    prisma.user.update({ where: { id: found.id }, data: { lastSeenAt: new Date(), checkin8Sent: false, checkin24Sent: false } }).catch(() => {});
  } else {
    prisma.user.update({ where: { id: found.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }

  // A soft-deleted account behaves as if it no longer exists.
  if (found.disabledAt) {
    return NextResponse.json({ error: "account_disabled" }, { status: 403 });
  }

  // Country switched off while they were signed in — lock the session out too.
  if (!user.isAdmin && (await isCountryClosed(user.country))) {
    return NextResponse.json({ error: "country_closed" }, { status: 403 });
  }

  // A blocked member is deliberately NOT refused here. They need a valid session to see
  // the screen explaining why they're blocked and how long is left — refusing /me would
  // just bounce them to the login page with no explanation. Individual features are what
  // enforce the block; this payload is what lets the app render it.
  return NextResponse.json({ user: publicUser(user), moderation: moderationSummary(found) });
}

const patchSchema = z.object({
  displayName: z.string().min(4).max(80).optional(),
  realName: z.string().max(80).nullable().optional(),
  avatarUrl: z.string().max(2000000).nullable().optional(),
  nationality: z.string().max(4).nullable().optional(),
  gender: z.enum(["male", "female"]).nullable().optional(),
  email: z.string().email().max(120).optional(),
  phone: z.string().max(20).optional(),
  password: z.string().min(8).max(128).optional(), // set or change the account password
  country: z.string().max(4).nullable().optional(),
  browseCountries: z.string().max(200).optional(), // CSV, "" = everywhere
  bio: z.string().max(200).nullable().optional(),
  dateOfBirth: z.string().nullable().optional(),
  address: z.string().max(160).nullable().optional(),
  visibility: z.enum(["public", "friends"]).optional(),
  showDistance: z.boolean().optional(),
  allowSaveMedia: z.boolean().optional(),
  deleteMediaAfterView: z.boolean().optional(),
  showAddress: z.boolean().optional(),
  dmClosed: z.boolean().optional(), // "لا أستقبل رسائل" — allow-list only
  hideTop: z.boolean().optional(), // parental lock on the "most viewed" doorway
  bleDiscoverable: z.boolean().optional(), // broadcast over Bluetooth so nearby people can find me
  locale: z.enum(["ar", "en"]).optional(),
  // premium-gated
  textColor: z.string().max(20).nullable().optional(), // red is rejected below — it is the app's alert colour
  shareLocation: z.boolean().optional(),
  // "everyone" (minus the hide-list) or "chosen" (allow-list only). See /api/users/[id].
  locationMode: z.enum(["everyone", "chosen"]).optional(),
  locationLat: z.number().nullable().optional(),
  locationLng: z.number().nullable().optional(),
  social1: z.string().max(200).nullable().optional(),
  social2: z.string().max(200).nullable().optional(),
  social3: z.string().max(200).nullable().optional(),
});

// Coordinates are NOT premium: everyone may store them so the distance number can be
// computed. The precise pin stays premium — /api/users/[id] only reveals coordinates
// when the account is premium AND sharing (effPremium && shareLocation).
const PREMIUM_FIELDS = ["textColor", "social1", "social2", "social3"] as const;

export async function PATCH(req: Request) {
  const token = bearerFromRequest(req);
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = verifyAccessToken(token);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const data: Record<string, unknown> = { ...parsed.data };

  // Only the preset palette is allowed. Red is exclusive to the owner (admin) —
  // for everyone else it stays the app's alert colour.
  if (typeof data.textColor === "string") {
    const color = data.textColor as string;
    if (!NAME_COLORS.includes(color)) {
      const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isAdmin: true } });
      const ownerTakingRed = !!me?.isAdmin && isReservedRed(color);
      if (!ownerTakingRed) return NextResponse.json({ error: "color_reserved" }, { status: 400 });
    }
  }
  if (typeof data.displayName === "string") data.displayName = data.displayName.trim();
  if (typeof data.realName === "string") data.realName = (data.realName as string).trim() || null;

  // email / phone: normalize + ensure not taken by another account
  if (typeof data.email === "string") {
    data.email = data.email.trim().toLowerCase();
    const taken = await prisma.user.findFirst({ where: { email: data.email as string, NOT: { id: payload.sub } } });
    if (taken) return NextResponse.json({ error: "identifier_taken" }, { status: 409 });
  }
  if (typeof data.phone === "string") {
    data.phone = normalizePhone(data.phone);
    const taken = await prisma.user.findFirst({ where: { phone: data.phone as string, NOT: { id: payload.sub } } });
    if (taken) return NextResponse.json({ error: "identifier_taken" }, { status: 409 });
  }
  // Set or change the account password (hashed; the plaintext is never stored).
  if (typeof data.password === "string" && (data.password as string).length >= 8) {
    data.passwordHash = await hashPassword(data.password as string);
  }
  delete data.password;

  // Date of birth and nationality are locked after signup — they can never be edited (per client).
  delete data.dateOfBirth;
  delete data.nationality;
  if (typeof data.address === "string") data.address = (data.address as string).trim() || null;

  // Nobody can move themselves into a closed country.
  if (typeof data.country === "string" && (await isCountryClosed(data.country))) {
    return NextResponse.json({ error: "country_closed" }, { status: 403 });
  }

  // Premium-only fields require an active subscription.
  const current = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!current?.isPremium) {
    for (const f of PREMIUM_FIELDS) delete data[f];
  }

  const user = await prisma.user.update({ where: { id: payload.sub }, data });
  return NextResponse.json({ user: publicUser(user) });
}
