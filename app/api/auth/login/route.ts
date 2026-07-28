import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { notify } from "@/lib/notify";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { expireIfLapsed } from "@/lib/premium";
import {
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  sha256,
  publicUser,
  identifierWhere,
} from "@/lib/auth";
import { isCountryClosed } from "@/lib/closed";

const schema = z.object({
  identifier: z.string().min(3), // email or phone
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const rl = rateLimit(req, "login", 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const user = await prisma.user.findFirst({ where: identifierWhere(parsed.data.identifier) });
  if (!user || !user.passwordHash) {
    // No password set on this account — must sign in with a one-time code.
    return NextResponse.json({ error: user && !user.passwordHash ? "no_password" : "invalid_credentials" }, { status: 401 });
  }
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  // Members of a closed country are locked out until the admin reopens it.
  if (!user.isAdmin && (await isCountryClosed(user.country))) {
    return NextResponse.json({ error: "country_closed" }, { status: 403 });
  }

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

  const fresh = await expireIfLapsed(user);
  return NextResponse.json({ accessToken, refreshToken, user: publicUser(fresh) });
}
