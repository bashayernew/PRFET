import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { getPrices, AD_MONTH_MS } from "@/lib/pricing";
import { createInvoice } from "@/lib/invoice";

const schema = z.object({
  name: z.string().min(2).max(80),
  imageUrl: z.string().max(500).optional(),
  birthDate: z.string().max(20).optional(),
  degree: z.string().max(120).optional(),
  nationality: z.string().max(4).optional(),
  gender: z.enum(["male", "female"]),
  experience: z.string().max(200).optional(),
  title: z.string().max(120).optional(), // the role they want
  countries: z.array(z.string().max(4)).min(1).max(20), // where they'd work
  cvUrl: z.string().max(500).optional(),
});

// GET /api/job-seekers — CV profiles, with filters (companies looking for employees).
// `location` (where the person can work) and `gender` are the required filters.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const title = url.searchParams.get("title")?.trim();
  const nationality = url.searchParams.get("nationality")?.trim();
  const degree = url.searchParams.get("degree")?.trim();
  const gender = url.searchParams.get("gender")?.trim();
  const location = url.searchParams.get("location")?.trim(); // country code they can work in
  const experience = url.searchParams.get("experience")?.trim();
  const mine = url.searchParams.get("mine") === "1";

  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;

  if (mine) {
    if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const me = await prisma.jobSeeker.findUnique({ where: { userId: payload.sub } });
    return NextResponse.json({ seekers: me ? [shape(me)] : [] });
  }

  const rows = await prisma.jobSeeker.findMany({
    where: {
      // only listings whose month is still running (NOT-form keeps null-expiry legacy rows visible)
      NOT: { expiresAt: { lte: new Date() } },
      ...(title ? { title: { contains: title, mode: "insensitive" } } : {}),
      ...(nationality ? { nationality } : {}),
      ...(degree ? { degree: { contains: degree, mode: "insensitive" } } : {}),
      ...(gender ? { gender } : {}),
      ...(experience ? { experience: { contains: experience, mode: "insensitive" } } : {}),
      // countries is a CSV — "KW" matches "KW,SA"
      ...(location ? { countries: { contains: location } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // People who can work in the country the company cares about come first.
  const me = payload ? await prisma.user.findUnique({ where: { id: payload.sub }, select: { country: true } }) : null;
  const priority = (location || me?.country || "").toUpperCase();
  if (priority) {
    rows.sort((a, b) => {
      const am = (a.countries || "").toUpperCase().includes(priority) ? 0 : 1;
      const bm = (b.countries || "").toUpperCase().includes(priority) ? 0 : 1;
      return am - bm || b.createdAt.getTime() - a.createdAt.getTime();
    });
  }

  return NextResponse.json({ seekers: rows.map(shape) });
}

// POST /api/job-seekers — create or update my CV profile.
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // master switch: when jobs are paused from the dashboard, seeker ads still work but are FREE.
  const feat = await prisma.appSettings.findUnique({ where: { id: "app" }, select: { jobsEnabled: true } });
  const jobsPaid = feat?.jobsEnabled !== false;

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const d = parsed.data;

  const data = {
    name: d.name.trim(),
    imageUrl: d.imageUrl ?? null,
    birthDate: d.birthDate ?? null,
    degree: d.degree?.trim() || null,
    nationality: d.nationality ?? null,
    gender: d.gender,
    experience: d.experience?.trim() || null,
    title: d.title?.trim() || null,
    countries: [...new Set(d.countries)].join(","),
    cvUrl: d.cvUrl ?? null,
  };

  // A seeker listing costs its monthly fee. Creating pays it; editing is free while the
  // month runs; saving after expiry counts as the renewal and pays it again.
  // Users with admin-gifted free seeker ads get it for nothing (one credit spent on charge).
  const poster = await prisma.user.findUnique({ where: { id: payload.sub }, select: { freeSeekerLeft: true } });
  const freeSeeker = (poster?.freeSeekerLeft ?? 0) > 0 || !jobsPaid;
  const { seekerAd: seekerPrice } = await getPrices();
  const seekerAd = freeSeeker ? 0 : seekerPrice;
  const existing = await prisma.jobSeeker.findUnique({ where: { userId: payload.sub } });
  const now = new Date();
  const expired = !existing || !existing.expiresAt || existing.expiresAt <= now;

  const seeker = await prisma.jobSeeker.upsert({
    where: { userId: payload.sub },
    create: {
      userId: payload.sub, ...data,
      cost: seekerAd, expiresAt: new Date(now.getTime() + AD_MONTH_MS),
    },
    update: {
      ...data,
      ...(expired
        ? { cost: (existing?.cost ?? 0) + seekerAd, expiresAt: new Date(now.getTime() + AD_MONTH_MS), renewNotified: false }
        : {}),
    },
  });

  // a fresh listing or a post-expiry renewal: spend a free credit if used, else invoice
  if (expired) {
    if (freeSeeker) {
      await prisma.user.update({ where: { id: payload.sub }, data: { freeSeekerLeft: { decrement: 1 } } }).catch(() => {});
    } else if (seekerAd > 0) {
      await createInvoice({ userId: payload.sub, kind: "seeker", description: "Job-seeker ad — 30 days", amount: seekerAd });
    }
  }

  return NextResponse.json({ id: seeker.id, renewed: expired }, { status: 201 });
}

function shape(s: {
  id: string; userId: string; imageUrl: string | null; name: string; birthDate: string | null;
  degree: string | null; nationality: string | null; gender: string; experience: string | null;
  title: string | null; countries: string; cvUrl: string | null; createdAt: Date;
}) {
  return {
    id: s.id,
    userId: s.userId,
    imageUrl: s.imageUrl,
    name: s.name,
    birthDate: s.birthDate,
    degree: s.degree,
    nationality: s.nationality,
    gender: s.gender,
    experience: s.experience,
    title: s.title,
    countries: s.countries ? s.countries.split(",") : [],
    cvUrl: s.cvUrl,
    createdAt: s.createdAt.toISOString(),
  };
}
