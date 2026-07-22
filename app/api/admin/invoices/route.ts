import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

async function requireAdmin(req: Request): Promise<string | null> {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return null;
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isAdmin: true } });
  return me?.isAdmin ? payload.sub : null;
}

// GET /api/admin/invoices?q=&from=YYYY-MM-DD&to=YYYY-MM-DD — searchable invoice list + totals.
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const where: Record<string, unknown> = {};
  if (q) {
    where.OR = [
      { customerName: { contains: q, mode: "insensitive" } },
      { number: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }
  const createdAt: Record<string, Date> = {};
  if (from) { const d = new Date(from); if (!isNaN(d.getTime())) createdAt.gte = d; }
  if (to) { const d = new Date(to); if (!isNaN(d.getTime())) { d.setUTCHours(23, 59, 59, 999); createdAt.lte = d; } }
  if (Object.keys(createdAt).length) where.createdAt = createdAt;

  const [invoices, agg] = await Promise.all([
    prisma.invoice.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.invoice.aggregate({ _sum: { amount: true }, _count: true, where }),
  ]);

  return NextResponse.json({
    total: agg._sum.amount ?? 0,
    count: agg._count,
    invoices: invoices.map((i) => ({
      id: i.id, number: i.number, customerName: i.customerName, kind: i.kind,
      description: i.description, amount: i.amount, currency: i.currency,
      createdAt: i.createdAt.toISOString(),
    })),
  });
}
