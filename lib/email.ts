import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";

/**
 * Where support messages land. Uses SUPPORT_EMAIL, else the dashboard's adminEmail,
 * else the app default (admin@prfet.com).
 */
async function inbox(): Promise<string> {
  if (process.env.SUPPORT_EMAIL) return process.env.SUPPORT_EMAIL;
  const s = await prisma.appSettings.findUnique({ where: { id: "app" }, select: { adminEmail: true } }).catch(() => null);
  return s?.adminEmail || "admin@prfet.com";
}

/** A configured SMTP transport, or null when the server has no mail credentials yet. */
function transport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null; // not configured — caller no-ops
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "1", // true for 465, false for 587/STARTTLS
    auth: { user, pass },
  });
}

/**
 * Email a support message to the app inbox (admin@prfet.com). Fire-and-forget:
 * the ticket is already saved in the DB, so mail failure never blocks the user.
 */
export async function sendSupportEmail(t: {
  kind: string; subject: string; body: string; contact: string; fromName?: string | null;
}): Promise<void> {
  const tx = transport();
  if (!tx) return; // SMTP not configured on this server yet

  const to = await inbox();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  const subject = `[PRFET · ${t.kind}] ${t.subject || "New message"}`;
  const text =
    `New ${t.kind} from PRFET\n\n` +
    (t.fromName ? `From: ${t.fromName}\n` : "") +
    (t.contact ? `Contact: ${t.contact}\n` : "") +
    `\n${t.body}\n`;

  await tx.sendMail({ from: `"PRFET" <${from}>`, to, replyTo: t.contact || undefined, subject, text }).catch(() => {});
}
