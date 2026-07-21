import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken } from "@/lib/auth";

async function requireAdmin(req: Request): Promise<string | null> {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return null;
  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isAdmin: true } });
  return me?.isAdmin ? payload.sub : null;
}

const userSel = { id: true, displayName: true, email: true, avatarUrl: true, country: true, suspendedUntil: true } as const;
type Target = { id: string; displayName: string; email: string | null; avatarUrl: string | null; country: string | null; suspendedUntil: Date | null };

// GET /api/admin/reports?country=KW&q=word — the moderation queue.
// Newest first, open on top. Every report resolves to the PERSON responsible plus
// the evidence: the image (ad/story/post) or the chat message text that was reported.
// The country chips and the search bar both filter here, and old reports are searchable too.
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const country = (url.searchParams.get("country") || "").trim().toUpperCase();
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();

  const reports = await prisma.report.findMany({
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { user: { select: userSel } }, // the reporter
  });

  const out = [];
  for (const r of reports) {
    let target: Target | null = null;
    let mediaUrl: string | null = null;
    let contentText: string | null = null; // the reported chat message / caption

    if (r.kind === "ad") {
      const ad = await prisma.ad.findUnique({ where: { id: r.targetId }, include: { user: { select: userSel } } });
      if (ad) { target = ad.user; mediaUrl = ad.mediaUrl; contentText = ad.caption; }
    } else if (r.kind === "story") {
      const story = await prisma.story.findUnique({ where: { id: r.targetId }, include: { user: { select: userSel } } });
      if (story) { target = story.user; mediaUrl = story.mediaUrl; contentText = story.caption; }
    } else if (r.kind === "post") {
      const post = await prisma.post.findUnique({ where: { id: r.targetId }, include: { user: { select: userSel } } });
      if (post) { target = post.user; mediaUrl = post.mediaUrl; contentText = post.caption; }
    } else if (r.kind === "message") {
      // a reported chat message — show its text/media, and pin down the sender
      const msg = await prisma.message.findUnique({ where: { id: r.targetId }, include: { conversation: true } });
      if (msg) {
        contentText = msg.body || null;
        mediaUrl = msg.mediaUrl;
        // the reporter holds the conversation; the OTHER side wrote the message they're reporting
        const senderId = msg.fromMe ? msg.conversation.userId : msg.conversation.peerId;
        target = await prisma.user.findUnique({ where: { id: senderId }, select: userSel });
      }
    } else {
      target = await prisma.user.findUnique({ where: { id: r.targetId }, select: userSel });
    }

    out.push({
      id: r.id,
      kind: r.kind,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      reporter: r.user ? { id: r.user.id, name: r.user.displayName } : null,
      target: target
        ? {
            id: target.id,
            name: target.displayName,
            email: target.email,
            avatarUrl: target.avatarUrl,
            country: target.country,
            suspendedUntil: target.suspendedUntil && target.suspendedUntil > new Date() ? target.suspendedUntil.toISOString() : null,
          }
        : null,
      mediaUrl,
      contentText,
    });
  }

  // Per-country counts (before filtering) — feeds the chips row.
  const counts: Record<string, number> = {};
  for (const r of out) {
    const c = r.target?.country || "??";
    counts[c] = (counts[c] || 0) + 1;
  }

  // Country filter + free-text search over names, emails, reasons and message text.
  let filtered = out;
  if (country && country !== "ALL") filtered = filtered.filter((r) => (r.target?.country || "??") === country);
  if (q) {
    filtered = filtered.filter((r) =>
      [r.target?.name, r.target?.email, r.reporter?.name, r.reason, r.contentText]
        .some((v) => v && v.toLowerCase().includes(q))
    );
  }

  filtered.sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1));
  return NextResponse.json({
    reports: filtered,
    countries: Object.entries(counts).map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
    total: out.length,
  });
}

// PATCH /api/admin/reports — update a report's state (open / reviewed / actioned).
export async function PATCH(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: { id?: string; status?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  if (!body.id || !["open", "reviewed", "actioned"].includes(body.status || "")) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  await prisma.report.update({ where: { id: body.id }, data: { status: body.status } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
