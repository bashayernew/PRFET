import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateOtp, randomOtp, sha256, identifierWhere } from "@/lib/auth";
import { sendOtpEmail } from "@/lib/email";
import { otpGuard, otpSent } from "@/lib/otp-guard";

const schema = z.object({ identifier: z.string().min(3) });
const OTP_TTL_MIN = 10;

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
  // Always respond ok (don't leak which accounts exist).
  if (!user) return NextResponse.json({ ok: true });

  // Throttle BEFORE issuing a code. Unlimited resends here is what made the email
  // provider read our traffic as spam; see lib/otp-guard.ts.
  if (user.email) {
    const guard = otpGuard(req, user.email);
    if (!guard.ok) {
      return NextResponse.json({ error: "rate_limited", retryAfter: guard.retryAfter }, { status: 429 });
    }
  }

  const code = user.email ? randomOtp() : generateOtp();
  await prisma.otpCode.create({
    data: {
      userId: user.id,
      codeHash: sha256(code),
      purpose: "verify_contact",
      expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60 * 1000),
    },
  });
  if (user.email) {
    await sendOtpEmail(user.email, code, "verify");
    otpSent(req, user.email);
  }
  return NextResponse.json({ ok: true });
}
