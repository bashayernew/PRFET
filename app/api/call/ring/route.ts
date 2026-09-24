import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { pushCall } from "@/lib/fcm";
import { guard } from "@/lib/guard";

const schema = z.object({ peerId: z.string().min(1).max(40) });

// POST /api/call/ring — the caller dialled. Push an "incoming call" alert to the callee so
// they're notified even if the app is closed (the live ring only reaches an open app).
export async function POST(req: Request) {
  const g = await guard(req, "calls");
  if ("response" in g) return g.response;
  const payload = { sub: g.userId };

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // In-app notification (notification bell, and web-push while the app is open).
  await notify(parsed.data.peerId, "incoming_call", { actorId: payload.sub, targetId: payload.sub });

  /**
   * Only ring the phone NATIVELY when the app isn't already showing the call.
   *
   * The socket offer reaches an open app instantly and it draws its own incoming screen.
   * Pushing as well gave people a notification on top of the ringing screen they were
   * already looking at — two rings for one call, and tapping the notification then tried to
   * "resume" a call that was already in front of them.
   *
   * A live socket in the user's personal room is the test: that's the same room the offer
   * itself was just delivered to, so if it has members the app has the call.
   */
  const io = (globalThis as unknown as {
    __herotIo?: { sockets: { adapter: { rooms: Map<string, Set<string>> } } };
  }).__herotIo;
  const live = io?.sockets?.adapter?.rooms?.get(parsed.data.peerId)?.size ?? 0;

  if (live > 0) {
    console.log(`[call] ring ${payload.sub} -> ${parsed.data.peerId} | app is open (${live} socket(s)) — no push`);
    return NextResponse.json({ ok: true, pushed: false });
  }

  // App is closed: this is the only way to reach them. Data-only and high priority so
  // Android wakes our code and draws the full-screen call UI.
  const me = await prisma.user
    .findUnique({ where: { id: payload.sub }, select: { displayName: true, avatarUrl: true } })
    .catch(() => null);
  await pushCall(parsed.data.peerId, {
    id: payload.sub,
    name: me?.displayName || "PRFET",
    avatarUrl: me?.avatarUrl ?? null,
  });
  console.log(`[call] ring ${payload.sub} -> ${parsed.data.peerId} | app closed — pushed`);

  return NextResponse.json({ ok: true, pushed: true });
}
