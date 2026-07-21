import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// GET /api/jobs/[id] — the full job, plus whether I already applied (and who applied, if it's mine).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = bearerFromRequest(req);
  const me = token ? verifyAccessToken(token)?.sub : undefined;

  const j = await prisma.job.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, displayName: true, avatarUrl: true, category: true, bio: true, isPremium: true, textColor: true } },
      _count: { select: { applications: true } },
    },
  });
  if (!j) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const mine = !!me && j.companyId === me;
  const applied = me
    ? !!(await prisma.jobApplication.findUnique({ where: { jobId_userId: { jobId: id, userId: me } } }))
    : false;

  // the company sees who applied
  let applicants: { id: string; displayName: string; avatarUrl: string | null; cvUrl: string | null; note: string | null; createdAt: string }[] = [];
  if (mine) {
    const rows = await prisma.jobApplication.findMany({
      where: { jobId: id },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
    });
    applicants = rows.map((r) => ({
      id: r.user.id,
      displayName: r.user.displayName,
      avatarUrl: r.user.avatarUrl,
      cvUrl: r.cvUrl,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  return NextResponse.json({
    job: {
      id: j.id,
      companyId: j.companyId,
      company: j.company,
      companyName: j.companyName ?? j.company?.displayName ?? "",
      imageUrl: j.imageUrl,
      title: j.title,
      typeKey: j.typeKey,
      degree: j.degree,
      experience: j.experience,
      salary: j.salary,
      nationality: j.nationality,
      gender: j.gender,
      country: j.country,
      location: j.location,
      birthFrom: j.birthFrom,
      birthTo: j.birthTo,
      createdAt: j.createdAt.toISOString(),
      applicantCount: j._count.applications,
      status: j.status,
      expiresAt: j.expiresAt?.toISOString() ?? null,
      mine,
      applied,
      applicants,
    },
  });
}

// DELETE /api/jobs/[id] — the company removes its own posting.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (job.companyId !== payload.sub) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await prisma.job.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
