import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";

async function requireAdmin(req: Request): Promise<string | null> {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return null;
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isAdmin: true } });
  return me?.isAdmin ? payload.sub : null;
}

// GET /api/admin/jobs?q= — every job post and job-seeker ad, newest first, searchable.
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const q = (new URL(req.url).searchParams.get("q") || "").trim();

  const jobs = await prisma.job.findMany({
    where: q
      ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { companyName: { contains: q, mode: "insensitive" } }, { company: { displayName: { contains: q, mode: "insensitive" } } }] }
      : {},
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { company: { select: { displayName: true } } },
  });

  const seekers = await prisma.jobSeeker.findMany({
    where: q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }, { user: { displayName: { contains: q, mode: "insensitive" } } }] }
      : {},
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { user: { select: { displayName: true } } },
  });

  const now = new Date();
  return NextResponse.json({
    jobs: jobs.map((j) => ({
      id: j.id, title: j.title, imageUrl: j.imageUrl, country: j.country,
      status: j.status, advertiser: j.companyName || j.company.displayName, userId: j.companyId,
      createdAt: j.createdAt.toISOString(),
    })),
    seekers: seekers.map((s) => ({
      id: s.id, title: s.title || s.name, imageUrl: s.imageUrl, country: null as string | null,
      // no status column — a past expiry means it's been pulled
      status: s.expiresAt && s.expiresAt < now ? "closed" : "open",
      advertiser: s.user.displayName, userId: s.userId,
      createdAt: s.createdAt.toISOString(),
    })),
  });
}

const schema = z.object({
  kind: z.enum(["job", "seeker"]),
  id: z.string().min(1).max(40),
  action: z.enum(["stop", "delete", "activate"]),
});
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

// POST /api/admin/jobs — stop, delete, or re-activate a job post or a seeker ad.
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const { kind, id, action } = parsed.data;

  if (kind === "job") {
    const job = await prisma.job.findUnique({ where: { id }, select: { id: true, companyId: true } });
    if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (action === "delete") {
      await prisma.job.delete({ where: { id } });
    } else if (action === "stop") {
      await prisma.job.update({ where: { id }, data: { status: "closed" } });
    } else {
      await prisma.job.update({ where: { id }, data: { status: "open" } });
    }
    notify(job.companyId, "job_removed", {}).catch(() => {});
  } else {
    const seeker = await prisma.jobSeeker.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!seeker) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (action === "delete") {
      await prisma.jobSeeker.delete({ where: { id } });
    } else if (action === "stop") {
      await prisma.jobSeeker.update({ where: { id }, data: { expiresAt: new Date() } });
    } else {
      await prisma.jobSeeker.update({ where: { id }, data: { expiresAt: new Date(Date.now() + THIRTY_DAYS) } });
    }
    notify(seeker.userId, "job_removed", {}).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
