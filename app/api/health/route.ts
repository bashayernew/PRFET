import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — is this instance actually able to serve requests?
 *
 * Deliberately queries the User table rather than running `SELECT 1`. Both outages so far
 * were cases where the process was alive and Postgres was reachable, but reads of User
 * failed — once because the disk was full, once because a column in the schema didn't
 * exist in the database. A connection-only check reports "healthy" in both, which is what
 * let a broken site run for a day.
 *
 * `count()` touches the real table and the real columns, so a schema mismatch fails here
 * exactly as it fails for a member signing in.
 *
 * Point an uptime monitor at this and it will catch the next one within five minutes
 * instead of waiting for the client to call.
 */
export async function GET() {
  const started = Date.now();
  try {
    const users = await prisma.user.count();
    return NextResponse.json({
      ok: true,
      users,
      ms: Date.now() - started,
      at: new Date().toISOString(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[health] FAILED:", message);
    return NextResponse.json(
      {
        ok: false,
        // The first line only: Prisma's full error carries the query and column names,
        // which shouldn't be exposed on a public endpoint. The full text is in the log.
        error: message.split("\n")[0].slice(0, 200),
        at: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
