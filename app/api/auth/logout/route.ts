import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/auth";

// POST /api/auth/logout — revoke the presented refresh token server-side.
export async function POST(req: Request) {
  let body: { refreshToken?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: true }); }
  if (body?.refreshToken) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(body.refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  return NextResponse.json({ ok: true });
}
