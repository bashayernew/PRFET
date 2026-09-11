import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

/**
 * GET /api/search/ble-self — the caller's own short Bluetooth broadcast code.
 * 8 hex chars (= 4 bytes) so it fits inside a BLE advertisement packet. Generated once and
 * stored, so it stays stable; other phones read it over the air and the server maps it back
 * to this user (see /api/search/ble-discovered).
 */
export async function GET(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const u = await prisma.user.findUnique({ where: { id: payload.sub }, select: { bleCode: true } });
  if (u?.bleCode) return NextResponse.json({ code: u.bleCode });

  // Make a unique 8-hex code (retry a few times on the tiny chance of a clash).
  let code = "";
  for (let i = 0; i < 5; i++) {
    const candidate = crypto.randomBytes(4).toString("hex");
    const clash = await prisma.user.findUnique({ where: { bleCode: candidate }, select: { id: true } }).catch(() => null);
    if (!clash) { code = candidate; break; }
  }
  if (!code) code = crypto.randomBytes(4).toString("hex");

  await prisma.user.update({ where: { id: payload.sub }, data: { bleCode: code } }).catch(() => {});
  return NextResponse.json({ code });
}
