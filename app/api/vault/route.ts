import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { premiumLapsed } from "@/lib/premium";

/**
 * The personal vault — a subscriber's private box for anything they want to keep handy
 * (phone numbers, notes, codes). Only ever readable by its owner. Gated on an active
 * subscription and the dashboard's vaultEnabled switch; admins always have access.
 */
const MAX_ITEMS = 200; // a generous ceiling so the box can't be used as bulk storage

async function me(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return null;
  return prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, isPremium: true, premiumUntil: true, autoRenew: true, isAdmin: true },
  });
}

/** null = allowed. Otherwise an error string + HTTP status. */
async function gate(user: NonNullable<Awaited<ReturnType<typeof me>>>): Promise<{ error: string; status: number } | null> {
  const s = await prisma.appSettings.findUnique({ where: { id: "app" }, select: { vaultEnabled: true } }).catch(() => null);
  if (s && s.vaultEnabled === false && !user.isAdmin) return { error: "disabled", status: 403 };
  if (!user.isAdmin) {
    const effPremium = user.isPremium && !premiumLapsed(user);
    if (!effPremium) return { error: "premium_only", status: 403 };
  }
  return null;
}

// GET /api/vault — the owner's saved items, newest first.
export async function GET(req: Request) {
  const user = await me(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const blocked = await gate(user);
  if (blocked) return NextResponse.json({ error: blocked.error, items: [] }, { status: blocked.status });

  const rows = await prisma.vaultItem.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    items: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, createdAt: r.createdAt.toISOString() })),
  });
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
});

// POST /api/vault — save a new item.
export async function POST(req: Request) {
  const user = await me(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const blocked = await gate(user);
  if (blocked) return NextResponse.json({ error: blocked.error }, { status: blocked.status });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const count = await prisma.vaultItem.count({ where: { userId: user.id } });
  if (count >= MAX_ITEMS) return NextResponse.json({ error: "full" }, { status: 409 });

  const row = await prisma.vaultItem.create({
    data: { userId: user.id, title: parsed.data.title, body: parsed.data.body },
  });
  return NextResponse.json({ item: { id: row.id, title: row.title, body: row.body, createdAt: row.createdAt.toISOString() } });
}

// DELETE /api/vault?id=... — remove one of the owner's items.
export async function DELETE(req: Request) {
  const user = await me(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // Scope the delete to the owner so no one can touch another person's vault.
  await prisma.vaultItem.deleteMany({ where: { id, userId: user.id } });
  return NextResponse.json({ ok: true });
}
