import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

const schema = z.object({
  targetId: z.string().min(1).max(120),
  kind: z.enum(["user", "ad", "message", "story", "post"]).default("user"),
  reason: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  await prisma.report.create({
    data: { userId: payload.sub, targetId: parsed.data.targetId, kind: parsed.data.kind, reason: parsed.data.reason ?? null },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
