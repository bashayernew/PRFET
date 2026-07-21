import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyRefreshToken, signAccessToken, sha256 } from "@/lib/auth";

const schema = z.object({ refreshToken: z.string().min(10) });

// POST /api/auth/refresh — exchange a valid refresh token for a fresh access token.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const payload = verifyRefreshToken(parsed.data.refreshToken);
  if (!payload) return NextResponse.json({ error: "invalid_token" }, { status: 401 });

  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(parsed.data.refreshToken) } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date() || stored.userId !== payload.sub) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  const accessToken = signAccessToken(payload.sub);
  return NextResponse.json({ accessToken });
}
