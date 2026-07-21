import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

const schema = z.object({
  kind: z.enum(["complaint", "inquiry", "suggestion", "call", "legal"]).default("suggestion"),
  subject: z.string().max(140).optional(),
  body: z.string().min(5).max(4000),
  contact: z.string().max(160).optional(),
});

// POST /api/support — send a complaint or an inquiry to the admin.
export async function POST(req: Request) {
  const rl = rateLimit(req, "support", 5, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const t = await prisma.supportTicket.create({
    data: {
      userId: payload?.sub ?? null,
      kind: parsed.data.kind,
      subject: parsed.data.subject?.trim() || "",
      body: parsed.data.body.trim(),
      contact: parsed.data.contact?.trim() || "",
    },
  });
  return NextResponse.json({ id: t.id }, { status: 201 });
}

// GET /api/support — the admin's inbox (dashboard).
export async function GET(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isAdmin: true } });
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") || undefined;
  const status = url.searchParams.get("status") || undefined;

  const rows = await prisma.supportTicket.findMany({
    where: { ...(kind ? { kind } : {}), ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { user: { select: { id: true, displayName: true, email: true, phone: true, avatarUrl: true } } },
  });

  return NextResponse.json({
    tickets: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      subject: r.subject,
      body: r.body,
      contact: r.contact,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      user: r.user,
    })),
  });
}
