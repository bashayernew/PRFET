import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

// DELETE /api/account — the signed-in user permanently deletes their OWN account and all
// associated data (posts, messages, media rows, memberships, etc. cascade with the user).
// Required by Google Play / App Store for any app with account creation.
export async function DELETE(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    await prisma.user.delete({ where: { id: payload.sub } });
  } catch {
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
