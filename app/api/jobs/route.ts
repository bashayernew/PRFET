import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { getPrices, AD_MONTH_MS } from "@/lib/pricing";
import { createInvoice } from "@/lib/invoice";

const schema = z.object({
  title: z.string().min(2).max(120),
  companyName: z.string().max(120).optional(),
  imageUrl: z.string().max(500).optional(),
  catKey: z.string().max(40).optional(),
  typeKey: z.enum(["full", "part", "remote"]).default("full"),
  degree: z.string().max(120).optional(),
  experience: z.string().max(120).optional(),
  salary: z.string().max(60).optional(),
  nationality: z.string().max(120).optional(), // CSV — a job can accept several nationalities
  gender: z.enum(["male", "female", "any"]).optional(),
  country: z.string().max(120).optional(), // CSV — the employee may be in any of these countries
  location: z.string().max(120).optional(), // city / area
  birthFrom: z.number().int().min(1940).max(2030).optional(),
  birthTo: z.number().int().min(1940).max(2030).optional(),
});

// GET /api/jobs — open roles with optional filters (people searching for work).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const title = url.searchParams.get("title")?.trim();
  const country = url.searchParams.get("country")?.trim(); // CSV of country codes
  const degree = url.searchParams.get("degree")?.trim();
  const gender = url.searchParams.get("gender")?.trim();
  const mine = url.searchParams.get("mine") === "1";

  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  const countries = country ? country.split(",").filter(Boolean) : [];

  const jobs = await prisma.job.findMany({
    where: {
      // the public feed only shows live ads; owners still see all of theirs (incl. expired, to renew).
      // NOT (rather than OR) so it can't collide with the country OR-filter below.
      ...(mine && payload
        ? { companyId: payload.sub }
        : { status: "open", NOT: { expiresAt: { lte: new Date() } } }),
      ...(title ? { title: { contains: title, mode: "insensitive" } } : {}),
      // country is a CSV ("KW,SA") — match if ANY of the wanted codes appears
      ...(countries.length ? { OR: countries.map((c) => ({ country: { contains: c } })) } : {}),
      ...(degree ? { degree: { contains: degree, mode: "insensitive" } } : {}),
      ...(gender && gender !== "any" ? { AND: [{ OR: [{ gender }, { gender: "any" }, { gender: null }] }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { company: { select: { id: true, displayName: true, avatarUrl: true, category: true } } },
  });

  // Roles in the country the viewer cares about come first.
  const me = payload ? await prisma.user.findUnique({ where: { id: payload.sub }, select: { country: true } }) : null;
  const priority = (countries[0] || me?.country || "").toUpperCase();
  if (priority) {
    jobs.sort((a, b) => {
      const am = (a.country || "").toUpperCase().includes(priority) ? 0 : 1;
      const bm = (b.country || "").toUpperCase().includes(priority) ? 0 : 1;
      return am - bm || b.createdAt.getTime() - a.createdAt.getTime();
    });
  }

  return NextResponse.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      companyId: j.companyId,
      company: j.company,
      companyName: j.companyName ?? j.company?.displayName ?? "",
      imageUrl: j.imageUrl,
      title: j.title,
      catKey: j.catKey,
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
    })),
  });
}

// POST /api/jobs — publish a job opening.
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const d = parsed.data;

  // A job ad costs its posting fee and runs for 30 days, then waits for renewal.
  // Users the admin marked as free job posters pay nothing.
  const poster = await prisma.user.findUnique({ where: { id: payload.sub }, select: { freeJobPost: true } });
  const { jobPost } = await getPrices();

  const job = await prisma.job.create({
    data: {
      cost: poster?.freeJobPost ? 0 : jobPost,
      expiresAt: new Date(Date.now() + AD_MONTH_MS),
      companyId: payload.sub,
      title: d.title.trim(),
      companyName: d.companyName?.trim() || null,
      imageUrl: d.imageUrl ?? null,
      catKey: d.catKey ?? null,
      typeKey: d.typeKey,
      degree: d.degree?.trim() || null,
      experience: d.experience?.trim() || null,
      salary: d.salary?.trim() || null,
      nationality: d.nationality ?? null,
      gender: d.gender ?? null,
      country: d.country ?? null,
      location: d.location?.trim() || null,
      birthFrom: d.birthFrom ?? null,
      birthTo: d.birthTo ?? null,
    },
  });
  await createInvoice({ userId: payload.sub, kind: "job", description: `Job ad — ${job.title}`, amount: poster?.freeJobPost ? 0 : jobPost });

  return NextResponse.json({ id: job.id }, { status: 201 });
}
