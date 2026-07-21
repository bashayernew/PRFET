import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

const schema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

/**
 * POST /api/location — store where I am.
 * This is for DISTANCE only: coordinates are never sent to other users unless the
 * account is premium AND has "share location" on. Everyone (free or paid) can store
 * them, otherwise no distance could ever be calculated.
 */
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  await prisma.user.update({
    where: { id: payload.sub },
    data: { locationLat: parsed.data.lat, locationLng: parsed.data.lng },
  });
  return NextResponse.json({ ok: true });
}
