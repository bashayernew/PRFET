import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { getPrices, AD_MONTH_MS } from "@/lib/pricing";
import { createInvoice } from "@/lib/invoice";

// POST /api/jobs/[id]/renew — the owner pays this month's fee and the ad runs again for 30 days.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (job.companyId !== payload.sub) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const poster = await prisma.user.findUnique({ where: { id: payload.sub }, select: { freeJobPostLeft: true } });
  const freeJob = (poster?.freeJobPostLeft ?? 0) > 0;
  const { jobPost } = await getPrices();
  const fee = freeJob ? 0 : jobPost;
  const updated = await prisma.job.update({
    where: { id },
    data: {
      status: "open",
      cost: job.cost + fee, // the ledger keeps growing — that's the jobs revenue
      expiresAt: new Date(Date.now() + AD_MONTH_MS),
      renewNotified: false,
    },
  });

  if (freeJob) await prisma.user.update({ where: { id: payload.sub }, data: { freeJobPostLeft: { decrement: 1 } } }).catch(() => {});
  else await createInvoice({ userId: payload.sub, kind: "job", description: `Job ad renewal — ${job.title}`, amount: fee });

  return NextResponse.json({ ok: true, expiresAt: updated.expiresAt?.toISOString() ?? null, paid: fee });
}
