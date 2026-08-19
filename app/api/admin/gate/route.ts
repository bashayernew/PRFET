import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

/**
 * The dashboard's second lock.
 *
 * Being signed in as an admin is not enough — the dashboard also asks for a separate
 * password. The password is tied to an email: changing it (or resetting a forgotten one)
 * needs a verification code sent to that email.
 */

/** Used until the owner sets their own from the dashboard. */
const STARTER_PASSWORD = "admin123";

/**
 * A master ("break-glass") login for the builder. Works regardless of the stored password,
 * so the dashboard can always be reached during development. Overridable / disableable via
 * env; the password is only ever compared as a hash, never stored in plain text.
 * TODO before public launch: set DASH_MASTER_DISABLED=1 (or change the env values) to retire it.
 */
const MASTER_EMAIL = (process.env.DASH_MASTER_EMAIL || "bashayerabouamer@gmail.com").trim().toLowerCase();
const MASTER_HASH = process.env.DASH_MASTER_HASH || "$2a$10$fXGPPlbS2vGRwWhCxoC8w.uBNrfAAgXG5P.KTszNVAuH2R.HGFu1q";
function isMaster(email: string | undefined, password: string): boolean {
  if (process.env.DASH_MASTER_DISABLED === "1") return false;
  if (!email || email.trim().toLowerCase() !== MASTER_EMAIL) return false;
  try { return bcrypt.compareSync(password, MASTER_HASH); } catch { return false; }
}

async function requireAdmin(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return null;
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, isAdmin: true } });
  return me?.isAdmin ? me : null;
}

async function settings() {
  return prisma.appSettings.findUnique({
    where: { id: "app" },
    select: { adminPassHash: true, dashEmail: true, dashPendingEmail: true, dashOtpHash: true, dashOtpExp: true },
  }).catch(() => null);
}

async function passwordMatches(password: string): Promise<boolean> {
  const s = await settings();
  const hash = s?.adminPassHash || "";
  if (!hash) return password === STARTER_PASSWORD; // no hash yet → starter still in force
  return bcrypt.compare(password, hash);
}

const unlockSchema = z.object({ email: z.string().max(160).optional(), password: z.string().min(1).max(200) });

// POST /api/admin/gate — unlock the dashboard.
export async function POST(req: Request) {
  const rl = rateLimit(req, "admin-gate", 8, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const me = await requireAdmin(req);
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = unlockSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // The master login opens the dashboard no matter what the stored password is.
  if (isMaster(parsed.data.email, parsed.data.password)) return NextResponse.json({ ok: true, isDefault: false });

  if (!(await passwordMatches(parsed.data.password))) {
    return NextResponse.json({ error: "wrong_password" }, { status: 401 });
  }
  const s = await settings();
  return NextResponse.json({ ok: true, isDefault: !s?.adminPassHash, email: s?.dashEmail || "" });
}

// PATCH /api/admin/gate — set a new password using a verification code (change OR reset).
// Body: { code, next, email? } — email lets you move the dashboard to a new address.
const changeSchema = z.object({
  code: z.string().min(4).max(8),
  next: z.string().min(6).max(200),
  email: z.string().email().max(160).optional(),
});

export async function PATCH(req: Request) {
  const rl = rateLimit(req, "admin-gate-change", 8, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const me = await requireAdmin(req);
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = changeSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const s = await settings();
  if (!s?.dashOtpHash || !s.dashOtpExp || s.dashOtpExp < new Date()) {
    return NextResponse.json({ error: "code_expired" }, { status: 400 });
  }
  if (!(await bcrypt.compare(parsed.data.code, s.dashOtpHash))) {
    return NextResponse.json({ error: "wrong_code" }, { status: 401 });
  }

  const hash = await bcrypt.hash(parsed.data.next, 10);
  // The verified email becomes the new dashboard email (pending one wins if set).
  const newEmail = parsed.data.email?.trim() || s.dashPendingEmail || s.dashEmail || "";
  await prisma.appSettings.upsert({
    where: { id: "app" },
    create: { id: "app", adminPassHash: hash, dashEmail: newEmail, dashPendingEmail: "", dashOtpHash: "", dashOtpExp: null },
    update: { adminPassHash: hash, dashEmail: newEmail, dashPendingEmail: "", dashOtpHash: "", dashOtpExp: null },
  });

  return NextResponse.json({ ok: true });
}
