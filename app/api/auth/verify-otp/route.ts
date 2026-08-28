import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import {
  sha256,
  signAccessToken,
  signRefreshToken,
  publicUser,
  identifierWhere,
} from "@/lib/auth";

const schema = z.object({
  identifier: z.string().min(3), // email or phone used at sign-up
  code: z.string().regex(/^\d{4}$/),
});

const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // --- App-store reviewer login -------------------------------------------------------
  // ONE designated email accepts ONE fixed code, so Google Play / App Store reviewers can
  // always sign in without receiving the emailed OTP. This affects ONLY the single address
  // in REVIEW_EMAIL — every other account still needs its own real, random, emailed code.
  // Configure REVIEW_EMAIL + REVIEW_OTP in the server .env. Keep it while the app is listed.
  const reviewEmail = process.env.REVIEW_EMAIL?.trim().toLowerCase();
  const reviewOtp = process.env.REVIEW_OTP?.trim();
  if (
    reviewEmail && reviewOtp &&
    parsed.data.identifier.trim().toLowerCase() === reviewEmail &&
    parsed.data.code === reviewOtp
  ) {
    const rUser = await prisma.user.findFirst({ where: identifierWhere(parsed.data.identifier) });
    if (rUser) {
      const verified = await prisma.user.update({ where: { id: rUser.id }, data: { isVerified: true } });
      const accessToken = signAccessToken(rUser.id);
      const { token: refreshToken, expiresAt } = signRefreshToken(rUser.id);
      await prisma.refreshToken.create({ data: { userId: rUser.id, tokenHash: sha256(refreshToken), expiresAt } });
      return NextResponse.json({ accessToken, refreshToken, user: publicUser(verified) });
    }
  }

  const user = await prisma.user.findFirst({ where: identifierWhere(parsed.data.identifier) });
  if (!user) return NextResponse.json({ error: "invalid_code" }, { status: 400 });

  const otp = await prisma.otpCode.findFirst({
    where: { userId: user.id, purpose: "verify_contact", consumedAt: null },
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

  // success
  await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  const verified = await prisma.user.update({
    where: { id: user.id },
    data: { isVerified: true },
  });

  // Suspended accounts stay out until their time is served.
  if (user.suspendedUntil && user.suspendedUntil > new Date()) {
    return NextResponse.json({ error: "suspended", until: user.suspendedUntil.toISOString() }, { status: 403 });
  }
  // Time served — clear the flag and welcome them back.
  if (user.suspendedUntil && user.suspendedUntil <= new Date()) {
    await prisma.user.update({ where: { id: user.id }, data: { suspendedUntil: null, suspendReason: null } }).catch(() => {});
    notify(user.id, "unsuspended", {}).catch(() => {});
  }

  const accessToken = signAccessToken(user.id);
  const { token: refreshToken, expiresAt } = signRefreshToken(user.id);
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt },
  });

  return NextResponse.json({ accessToken, refreshToken, user: publicUser(verified) });
}
