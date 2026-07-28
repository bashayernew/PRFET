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

/** The verified sender address (must be on the Resend-verified domain). */
function fromAddress(): string {
  return process.env.SMTP_FROM || process.env.RESEND_FROM || "noreply@prfet.com";
}

/** Resend API key — from RESEND_API_KEY, or an SMTP_PASS that is itself a Resend key. */
function resendKey(): string | null {
  const k = process.env.RESEND_API_KEY || process.env.SMTP_PASS || "";
  return k.startsWith("re_") ? k : null;
}

/**
 * Send through Resend's HTTPS API (port 443 — never blocked by host SMTP throttling).
 * Hard 8s timeout so a slow network can never hang the request. Returns true on success.
 */
async function resendSend(to: string, subject: string, text: string, replyTo?: string): Promise<boolean> {
  const key = resendKey();
  if (!key) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `PRFET <${fromAddress()}>`,
        to: [to],
        subject,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** A configured SMTP transport (fallback), with short timeouts so it can never hang a request. */
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
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  });
}

/** SMTP fallback send. Returns true on success. */
async function smtpSend(to: string, subject: string, text: string, replyTo?: string): Promise<boolean> {
  const tx = transport();
  if (!tx) return false;
  try {
    await tx.sendMail({ from: `"PRFET" <${fromAddress()}>`, to, subject, text, replyTo });
    return true;
  } catch {
    return false;
  }
}

/**
 * Email a support message to the app inbox (admin@prfet.com). Fire-and-forget:
 * the ticket is already saved in the DB, so mail failure never blocks the user.
 */
export async function sendSupportEmail(t: {
  kind: string; subject: string; body: string; contact: string; fromName?: string | null;
}): Promise<void> {
  const to = await inbox();
  const subject = `[PRFET · ${t.kind}] ${t.subject || "New message"}`;
  const text =
    `New ${t.kind} from PRFET\n\n` +
    (t.fromName ? `From: ${t.fromName}\n` : "") +
    (t.contact ? `Contact: ${t.contact}\n` : "") +
    `\n${t.body}\n`;
  // Prefer the HTTPS API; fall back to SMTP if no Resend key is set.
  if (await resendSend(to, subject, text, t.contact || undefined)) return;
  await smtpSend(to, subject, text, t.contact || undefined);
}

/**
 * Email a verification/reset code to a member. Returns true only if it was actually
 * sent — callers fall back to showing the code on-screen when this returns false,
 * so signup is never blocked.
 */
export async function sendOtpEmail(to: string, code: string, purpose: "verify" | "reset" | "login" = "verify"): Promise<boolean> {
  const subject =
    purpose === "reset" ? "PRFET — رمز استعادة كلمة المرور / Password reset code"
    : purpose === "login" ? "PRFET — رمز الدخول / Login code"
    : "PRFET — رمز التحقق / Verification code";
  const text =
    `رمز التحقق الخاص بك هو: ${code}\nصالح لمدة 10 دقائق.\n\n` +
    `Your PRFET code is: ${code}\nIt is valid for 10 minutes.\n\n` +
    `PRFET`;
  // Prefer the HTTPS API (fast, unblockable); fall back to SMTP.
  if (await resendSend(to, subject, text)) return true;
  return smtpSend(to, subject, text);
}
