import { NextResponse } from "next/server";
import { z } from "zod";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";

const schema = z.object({ peerId: z.string().min(1).max(40) });

// POST /api/call/missed — tell the caller their call went unanswered.
export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  await notify(parsed.data.peerId, "missed_call", { actorId: payload.sub, targetId: payload.sub });
  return NextResponse.json({ ok: true });
}
