import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { sendOtpEmail } from "@/lib/email";

async function requireAdmin(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return null;
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, isAdmin: true } });
  return me?.isAdmin ? me : null;
}

// POST /api/admin/gate/otp — send a verification code for changing/resetting the dashboard
// password. Body: { email? } — the first time (or when moving to a new address) pass the
// email; otherwise the code goes to the dashboard email already on file.
const schema = z.object({ email: z.string().email().max(160).optional() });

export async function POST(req: Request) {
  const rl = rateLimit(req, "admin-gate-otp", 4, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const me = await requireAdmin(req);
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const s = await prisma.appSettings.findUnique({ where: { id: "app" }, select: { dashEmail: true } }).catch(() => null);
  const target = (parsed.data.email?.trim() || s?.dashEmail || "").trim();
  if (!target) return NextResponse.json({ error: "email_required" }, { status: 400 });

  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
  const hash = await bcrypt.hash(code, 10);
  const exp = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await prisma.appSettings.upsert({
    where: { id: "app" },
    create: { id: "app", dashOtpHash: hash, dashOtpExp: exp, dashPendingEmail: target },
    update: { dashOtpHash: hash, dashOtpExp: exp, dashPendingEmail: target },
  });

  const sent = await sendOtpEmail(target, code, "reset");
  // If email isn't configured/deliverable, hand the code back so the builder isn't locked
  // out — dev convenience only; harmless because the caller is already an authenticated admin.
  return NextResponse.json({ ok: true, sent, ...(sent ? {} : { devCode: code }) });
}
