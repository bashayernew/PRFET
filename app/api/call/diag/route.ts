import { NextResponse } from "next/server";
import { z } from "zod";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/call/diag — the phone tells the server why a call failed.
 *
 * Calls fail on the DEVICE, before anything is transmitted: a refused microphone, a
 * peer connection that never reaches "connected", an offer that is never created. All of
 * that lands in the WebView's console, which nobody can read on a phone in another country.
 * The server log shows only what arrived — which for these failures is nothing at all.
 *
 * So the client reports its own failures here and they appear in `docker compose logs app`
 * alongside the [call] lines, turning "it doesn't work" into a specific cause.
 *
 * Diagnostics only: it stores nothing and changes nothing.
 */
const schema = z.object({
  stage: z.string().max(40),          // getUserMedia | offer | answer | ice | connect
  detail: z.string().max(300).optional(),
  peerId: z.string().max(40).optional(),
});

export async function POST(req: Request) {
  const rl = rateLimit(req, "call-diag", 30, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: true }); // never let diagnostics cause errors

  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;

  // An unauthenticated report used to be dropped in silence. That hid the one case worth
  // seeing: a device that cannot reach a feature BECAUSE its session is not what we think
  // it is. It is rate-limited above and stores nothing, so logging it anonymously is safe
  // and far more useful than saying nothing.
  if (!payload) {
    let stage = "?";
    try {
      const body = (await req.clone().json()) as { stage?: string; detail?: string };
      stage = `${body?.stage ?? "?"} | ${body?.detail ?? ""}`.slice(0, 300);
    } catch { /* body unreadable — still worth recording the attempt */ }
    console.log(`[call] DEVICE (no auth) | ${stage} | ${(req.headers.get("user-agent") || "").slice(0, 80)}`);
    return NextResponse.json({ ok: true });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ ok: true }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ ok: true });

  const { stage, detail, peerId } = parsed.data;
  const ua = (req.headers.get("user-agent") || "").slice(0, 80);
  console.log(`[call] DEVICE ${payload.sub}${peerId ? ` -> ${peerId}` : ""} | stage: ${stage} | ${detail || "no detail"} | ${ua}`);

  return NextResponse.json({ ok: true });
}
