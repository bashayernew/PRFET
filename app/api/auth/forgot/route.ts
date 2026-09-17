import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateOtp, randomOtp, sha256, identifierWhere } from "@/lib/auth";
import { sendOtpEmail } from "@/lib/email";
import { otpGuard, otpSent } from "@/lib/otp-guard";

const schema = z.object({ identifier: z.string().min(3) });
const OTP_TTL_MIN = 10;

// POST /api/auth/forgot — issue a password-reset code to the account's email or phone.
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
  // Always respond ok so we don't leak which accounts exist.
  if (!user) return NextResponse.json({ ok: true });

  // Throttle BEFORE issuing a code — this endpoint mails anyone who knows an address.
  // Keep answering 200 so we still don't leak which accounts exist; the client just
  // won't get another mail until the cooldown passes.
  if (user.email) {
    const guard = otpGuard(req, user.email);
    if (!guard.ok) return NextResponse.json({ ok: true, retryAfter: guard.retryAfter });
  }

  const code = user.email ? randomOtp() : generateOtp();
  await prisma.otpCode.create({
    data: {
      userId: user.id,
      codeHash: sha256(code),
      purpose: "reset_password",
      expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60 * 1000),
    },
  });
  if (user.email) {
    await sendOtpEmail(user.email, code, "reset");
    otpSent(req, user.email);
  }
  return NextResponse.json({ ok: true });
}
