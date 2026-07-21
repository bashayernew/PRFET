import { NextResponse } from "next/server";

// GET /api/push/key — the public VAPID key, read at runtime.
// (Reading it from the browser bundle doesn't work: NEXT_PUBLIC_* is frozen at build time,
// and the Docker build has no access to the server's .env.)
export async function GET() {
  const key = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
  if (!key) return NextResponse.json({ error: "push_not_configured" }, { status: 501 });
  return NextResponse.json({ key });
}
