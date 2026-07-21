import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { getPrices } from "@/lib/pricing";

const schema = z.object({ note: z.string().max(500).optional() });

// POST /api/jobs/[id]/apply — apply for a job. The CV from my seeker profile rides along.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  let raw: unknown = {};
  try { raw = await req.json(); } catch { /* no body is fine */ }
  const parsed = schema.safeParse(raw ?? {});
  const note = parsed.success ? parsed.data.note?.trim() || null : null;

  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (job.companyId === payload.sub) return NextResponse.json({ error: "own_job" }, { status: 400 });

  const already = await prisma.jobApplication.findUnique({ where: { jobId_userId: { jobId: id, userId: payload.sub } } });
  if (already) return NextResponse.json({ ok: true, already: true });

  const seeker = await prisma.jobSeeker.findUnique({ where: { userId: payload.sub } });

  // The application fee at this moment (0 = free) — recorded on the application,
  // which is exactly what the dashboard sums up as jobs revenue.
  const { jobApply } = await getPrices();

  await prisma.jobApplication.create({
    data: { jobId: id, userId: payload.sub, note, cvUrl: seeker?.cvUrl ?? null, cost: jobApply },
  });

  notify(job.companyId, "job_application", { actorId: payload.sub, targetId: id, text: job.title }).catch(() => {});

  return NextResponse.json({ ok: true }, { status: 201 });
}
