/**
 * SMS delivery for phone OTP codes.
 *
 * Why this file exists: phone signup was silently broken. `register` generated a real
 * 4-digit code for phone users and stored its hash, but only ever CALLED sendOtpEmail — so
 * a code existed that was never delivered anywhere, and nobody registering with a phone
 * number could finish verifying.
 *
 * ── Routing ────────────────────────────────────────────────────────────────────────────
 * Two providers, chosen by destination, because no single one is both cheap and reliable
 * for this audience:
 *
 *   +965 (Kuwait) → kwtSMS. A local gateway with direct routes to Zain, Ooredoo, STC and
 *     Virgin, at roughly a sixth of Twilio's price. It matters beyond cost: Kuwaiti
 *     operators filter business SMS that doesn't originate from a Sender ID registered to
 *     a local company, so international routes get delayed or dropped — you pay for a
 *     message that never arrives.
 *
 *   everywhere else → Twilio. Genuinely global, and the fallback when kwtSMS isn't
 *     configured or rejects a send.
 *
 * Each provider is skipped when unconfigured, so partial setup degrades instead of
 * breaking: with only Twilio set, everything goes via Twilio exactly as before.
 *
 * ── Config (server .env) ───────────────────────────────────────────────────────────────
 *   KWTSMS_USERNAME / KWTSMS_PASSWORD   API credentials
 *   KWTSMS_SENDER                       registered Sender ID, e.g. PRFET
 *   KWTSMS_TEST=1                       queue without delivering or spending credits
 *
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN
 *   TWILIO_MESSAGING_SERVICE_SID        preferred — carries the registered Sender ID
 *   TWILIO_FROM                         a Twilio number in E.164, if no Messaging Service
 *
 *   SMS_DEFAULT_COUNTRY_CODE            digits, default 965 — assumed for bare local numbers
 */

type Purpose = "verify" | "reset" | "login";

function kwtConfigured(): boolean {
  return !!(process.env.KWTSMS_USERNAME && process.env.KWTSMS_PASSWORD && process.env.KWTSMS_SENDER);
}

function twilioConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID)
  );
}

export function smsConfigured(): boolean {
  return kwtConfigured() || twilioConfigured();
}

/** Digits only, with a country code. "99887766" → "96599887766", "+965 9988-7766" → same. */
function toDigits(raw: string): string {
  const cleaned = raw.trim().replace(/[\s()-]/g, "");
  if (cleaned.startsWith("+")) return cleaned.slice(1).replace(/\D/g, "");
  const digits = cleaned.replace(/\D/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  const cc = (process.env.SMS_DEFAULT_COUNTRY_CODE || "965").replace(/\D/g, "");
  return digits.startsWith(cc) ? digits : cc + digits;
}

/** Short on purpose: a long body silently becomes several billed segments. */
function bodyFor(code: string, purpose: Purpose): string {
  return purpose === "reset"
    ? `رمز استعادة كلمة المرور: ${code}\nPRFET password reset code: ${code}`
    : `رمز التحقق: ${code}\nYour PRFET code: ${code}`;
}

/** kwtSMS — JSON in, JSON out. `result: "OK"` means accepted. */
async function viaKwtSms(digits: string, body: string): Promise<boolean> {
  if (!kwtConfigured()) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch("https://www.kwtsms.com/API/send/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        username: process.env.KWTSMS_USERNAME,
        password: process.env.KWTSMS_PASSWORD,
        sender: process.env.KWTSMS_SENDER,
        mobile: digits, // no leading +
        message: body,
        // "1" queues the message without delivering it or spending credits.
        test: process.env.KWTSMS_TEST === "1" ? "1" : "0",
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.result === "OK") return true;
    // `code`/`description` carry the real reason — bad credentials, unregistered sender,
    // no credit left. Worth having in `docker compose logs app`.
    console.error("[kwtsms] send failed:", res.status, JSON.stringify(data ?? {}).slice(0, 300));
    return false;
  } catch (e) {
    console.error("[kwtsms] network/timeout:", String(e).slice(0, 200));
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Twilio Messages API (not the Verify product — the app owns and checks its own codes). */
async function viaTwilio(digits: string, body: string): Promise<boolean> {
  if (!twilioConfigured()) return false;
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const auth = process.env.TWILIO_AUTH_TOKEN!;

  const form = new URLSearchParams();
  form.set("To", "+" + digits);
  form.set("Body", body);
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    form.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
  } else {
    form.set("From", process.env.TWILIO_FROM!);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${auth}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: ctrl.signal,
    });
    if (res.ok) return true;
    // 21608 = unverified number on a trial account, 21211 = malformed number,
    // 21614 = not SMS-capable. Each needs a different fix.
    console.error("[twilio] send failed:", res.status, (await res.text().catch(() => "")).slice(0, 300));
    return false;
  } catch (e) {
    console.error("[twilio] network/timeout:", String(e).slice(0, 200));
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Text a verification code. Returns true only once a provider has accepted it — callers
 * fall back to other channels rather than dead-ending a signup on a misconfigured provider.
 *
 * Kuwaiti numbers try the local gateway first and fall back to Twilio; everything else goes
 * straight to Twilio. The fallback is deliberate: a provider outage shouldn't lock people
 * out of their own accounts.
 */
export async function sendOtpSms(to: string, code: string, purpose: Purpose = "verify"): Promise<boolean> {
  if (!smsConfigured()) return false;
  const digits = toDigits(to);
  const body = bodyFor(code, purpose);

  const order = digits.startsWith("965")
    ? [viaKwtSms, viaTwilio]
    : [viaTwilio, viaKwtSms]; // kwtSMS also covers 190+ countries, so it's a real fallback

  for (const send of order) {
    if (await send(digits, body)) return true;
  }
  console.error("[sms] every provider refused", digits.slice(0, 4) + "…");
  return false;
}
