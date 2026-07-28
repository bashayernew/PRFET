import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { sendOwnerDM } from "@/lib/invoice";

/** Admin-only guard. */
async function requireAdmin(req: Request): Promise<string | null> {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return null;
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isAdmin: true } });
  return me?.isAdmin ? payload.sub : null;
}

const schema = z.object({
  scope: z.enum(["user", "countries", "all"]),
  userId: z.string().max(40).optional(),        // scope=user
  countries: z.array(z.string().max(4)).max(60).optional(), // scope=countries
  body: z.string().min(1).max(2000),
});

// POST /api/admin/broadcast — send a DM from the owner account to one person,
// to whole countries, or to everyone.
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const d = parsed.data;

  // resolve the recipient list
  let ids: string[] = [];
  if (d.scope === "user") {
    if (!d.userId) return NextResponse.json({ error: "no_user" }, { status: 400 });
    ids = [d.userId];
  } else if (d.scope === "countries") {
    if (!d.countries?.length) return NextResponse.json({ error: "no_countries" }, { status: 400 });
    const users = await prisma.user.findMany({ where: { country: { in: d.countries } }, select: { id: true } });
    ids = users.map((u) => u.id);
  } else {
    const users = await prisma.user.findMany({ select: { id: true } });
    ids = users.map((u) => u.id);
  }

  // deliver from the owner account (the helper skips the owner itself)
  let sent = 0;
  for (const uid of ids) {
    await sendOwnerDM(uid, d.body).then(() => { sent++; }).catch(() => {});
  }
  return NextResponse.json({ sent });
}
