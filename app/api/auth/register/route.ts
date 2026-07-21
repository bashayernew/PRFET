import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, generateOtp, sha256, normalizePhone } from "@/lib/auth";
import { isCountryClosed } from "@/lib/closed";

const phoneRe = /^\+?[0-9]{7,15}$/;

const schema = z
  .object({
    accountType: z.enum(["personal", "business"]).default("personal"),
    contactMethod: z.enum(["email", "phone"]).default("email"),
    email: z.string().email().max(120).optional(),
    phone: z.string().max(20).optional(),
    password: z.string().min(8).max(128).optional(), // optional account password
    displayName: z.string().min(2).max(80), // public name shown in the app
    realName: z.string().max(80).optional(), // personal real name / business owner name
    avatarUrl: z.string().max(2000000).optional(), // profile photo (path or data URL)
    nationality: z.string().max(4).optional(),
    gender: z.enum(["male", "female"]).optional(),
    dateOfBirth: z.string().optional(),
    address: z.string().max(160).optional(),
    country: z.string().max(4).optional(),
    locale: z.enum(["ar", "en"]).optional(),
    visibility: z.enum(["public", "friends"]).default("public"),
    showDistance: z.boolean().default(true),
    allowSaveMedia: z.boolean().default(false),
    deleteMediaAfterView: z.boolean().default(false),
    showAddress: z.boolean().default(true),
    hideTop: z.boolean().default(false), // opt out of "most viewed" from day one (parental)
  })
  .superRefine((d, ctx) => {
    if (d.contactMethod === "email" && !d.email) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "email_required" });
    }
    if (d.contactMethod === "phone" && !(d.phone && phoneRe.test(normalizePhone(d.phone)))) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "phone_required" });
    }
  });

const OTP_TTL_MIN = 10;

export async function POST(req: Request) {
  const rl = rateLimit(req, "register", 8, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // A closed country accepts no new members.
  if (await isCountryClosed(d.country)) {
    return NextResponse.json({ error: "country_closed" }, { status: 403 });
  }

  const email = d.contactMethod === "email" && d.email ? d.email.trim().toLowerCase() : null;
  const phone = d.contactMethod === "phone" && d.phone ? normalizePhone(d.phone) : null;

  const existing = await prisma.user.findFirst({ where: email ? { email } : { phone: phone! } });
  if (existing) {
    return NextResponse.json({ error: "identifier_taken" }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: {
      email,
      phone,
      contactMethod: d.contactMethod,
      passwordHash: d.password ? await hashPassword(d.password) : null, // optional password
      displayName: d.displayName.trim(),
      realName: d.realName?.trim() || null,
      avatarUrl: d.avatarUrl || null,
      nationality: d.nationality || null,
      gender: d.gender || null,
      accountType: d.accountType,
      country: d.country ?? null,
      locale: d.locale ?? "ar",
      dateOfBirth: d.accountType === "personal" && d.dateOfBirth ? new Date(d.dateOfBirth) : null,
      address: d.accountType === "business" && d.address ? d.address.trim() : null,
      visibility: d.visibility,
      showDistance: d.showDistance,
      allowSaveMedia: d.allowSaveMedia,
      deleteMediaAfterView: d.deleteMediaAfterView,
      showAddress: d.accountType === "business" ? d.showAddress : true,
      hideTop: d.hideTop,
    },
  });

  await prisma.notification.create({ data: { userId: user.id, kind: "welcome" } });

  const code = generateOtp();
  await prisma.otpCode.create({
    data: {
      userId: user.id,
      codeHash: sha256(code),
      purpose: "verify_contact",
      expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60 * 1000),
    },
  });

  console.log(`[PRFET] OTP for ${email ?? phone}: ${code}`);
  const isDev = process.env.NODE_ENV !== "production";
  return NextResponse.json({ ok: true, ...(isDev ? { devCode: code } : {}) }, { status: 201 });
}
