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
 * Postmark server token. Set POSTMARK_TOKEN to make Postmark the primary sender —
 * it takes priority over Resend below, so switching providers is an env change only.
 */
function postmarkToken(): string | null {
  return process.env.POSTMARK_TOKEN?.trim() || null;
}

/**
 * Send through Postmark's HTTPS API (port 443, same reasoning as the Resend path).
 *
 * `MessageStream` matters: Postmark keeps transactional and broadcast traffic on separate
 * streams and judges their reputation separately, which is the whole reason OTP delivery
 * is reliable there. Codes must go out on the transactional stream ("outbound").
 */
async function postmarkSend(to: string, subject: string, text: string, replyTo?: string): Promise<boolean> {
  const token = postmarkToken();
  if (!token) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        From: `PRFET <${fromAddress()}>`,
        To: to,
        Subject: subject,
        TextBody: text,
        MessageStream: process.env.POSTMARK_STREAM || "outbound",
        ...(replyTo ? { ReplyTo: replyTo } : {}),
      }),
      signal: ctrl.signal,
    });
    if (res.ok) return true;
    // Postmark answers 422 with an ErrorCode worth seeing in `docker compose logs app`
    // — 300 is a bad From address, 400 means the server is still in pending approval.
    console.error("[postmark] send failed:", res.status, (await res.text().catch(() => "")).slice(0, 300));
    return false;
  } catch (e) {
    console.error("[postmark] network/timeout:", String(e).slice(0, 200));
    return false;
  } finally {
    clearTimeout(timer);
  }
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
  // Reply-to: the sender's own contact when they left one, otherwise the support inbox
  // itself. Never leave it as the From address — `noreply@` is not a real mailbox, so
  // hitting Reply on one of these would bounce with 550 RecipientNotFound.
  const replyTo = t.contact || to;
  // Postmark first (when configured), then Resend, then plain SMTP.
  if (await postmarkSend(to, subject, text, replyTo)) return;
  if (await resendSend(to, subject, text, replyTo)) return;
  await smtpSend(to, subject, text, replyTo);
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
  // Postmark first (when POSTMARK_TOKEN is set), then Resend, then SMTP. Each returns
  // false rather than throwing, so a dead provider silently falls through to the next.
  if (await postmarkSend(to, subject, text)) return true;
  if (await resendSend(to, subject, text)) return true;
  return smtpSend(to, subject, text);
}
