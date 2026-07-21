import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sha256, hashPassword, identifierWhere } from "@/lib/auth";

const schema = z.object({
  identifier: z.string().min(3),
  code: z.string().regex(/^\d{4}$/),
  password: z.string().min(8).max(128),
});

const MAX_ATTEMPTS = 5;

// POST /api/auth/reset — verify the reset code and set a new password.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const user = await prisma.user.findFirst({ where: identifierWhere(parsed.data.identifier) });
  if (!user) return NextResponse.json({ error: "invalid_code" }, { status: 400 });

  const otp = await prisma.otpCode.findFirst({
    where: { userId: user.id, purpose: "reset_password", consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!otp || otp.expiresAt < new Date()) {
    return NextResponse.json({ error: "code_expired" }, { status: 400 });
  }
  if (otp.attempts >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  }
  if (otp.codeHash !== sha256(parsed.data.code)) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  // success — consume code, set new password, revoke existing refresh tokens.
  await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.password) },
  });
  await prisma.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
