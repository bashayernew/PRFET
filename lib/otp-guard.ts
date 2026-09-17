/**
 * Abuse guard for endpoints that SEND an email.
 *
 * Why this exists: `resend-otp` and `forgot` used to have no limit whatsoever. Anyone —
 * a tester leaning on the "resend" button, or a bot that found the endpoint — could make
 * the server email an unlimited stream of codes to any registered address. Email providers
 * read that pattern as spam: it is what got the Resend account suspended for "unusual
 * activity", and it is what would get a Postmark account suspended too.
 *
 * Two independent ceilings, because they catch different things:
 *   - per ADDRESS: stops one mailbox being flooded (the bounce/complaint risk).
 *   - per IP: stops one client walking a list of addresses (the volume risk).
 *
 * In-memory, like `lib/rate-limit.ts` — the app runs as a single Node process. Counters
 * reset if the container restarts, which is fine: this is an abuse brake, not a quota.
 */

import { clientIp } from "@/lib/rate-limit";

type Hits = { times: number[] };

const byAddress = new Map<string, Hits>();
const byIp = new Map<string, Hits>();

/** Minimum gap between two codes to the SAME address. */
const COOLDOWN_MS = 60_000;
/** Per address: at most this many in an hour, and this many in a day. */
const PER_ADDRESS_HOUR = 5;
const PER_ADDRESS_DAY = 15;
/** Per IP: at most this many in an hour (covers all addresses it asks for). */
const PER_IP_HOUR = 15;

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

function recent(map: Map<string, Hits>, key: string, windowMs: number, now: number): number[] {
  const h = map.get(key);
  if (!h) return [];
  return h.times.filter((t) => now - t < windowMs);
}

export type OtpGuardResult = { ok: true } | { ok: false; retryAfter: number };

/**
 * Check whether we're allowed to email `address` for this request. Call it BEFORE
 * generating the code, and return 429 with `retryAfter` when it says no.
 *
 * Does NOT record the send — call `otpSent()` once the email actually goes out, so a
 * failed lookup (unknown account) doesn't burn the caller's allowance.
 */
export function otpGuard(req: Request, address: string): OtpGuardResult {
  const now = Date.now();
  const addr = address.trim().toLowerCase();
  const ip = clientIp(req);

  const addrHour = recent(byAddress, addr, HOUR, now);
  const addrDay = recent(byAddress, addr, DAY, now);
  const ipHour = recent(byIp, ip, HOUR, now);

  const last = addrDay.length ? Math.max(...addrDay) : 0;
  if (last && now - last < COOLDOWN_MS) {
    return { ok: false, retryAfter: Math.ceil((COOLDOWN_MS - (now - last)) / 1000) };
  }
  if (addrHour.length >= PER_ADDRESS_HOUR) {
    return { ok: false, retryAfter: Math.ceil((HOUR - (now - Math.min(...addrHour))) / 1000) };
  }
  if (addrDay.length >= PER_ADDRESS_DAY) {
    return { ok: false, retryAfter: Math.ceil((DAY - (now - Math.min(...addrDay))) / 1000) };
  }
  if (ipHour.length >= PER_IP_HOUR) {
    return { ok: false, retryAfter: Math.ceil((HOUR - (now - Math.min(...ipHour))) / 1000) };
  }
  return { ok: true };
}

/** Record that a code was actually emailed to `address` from this request. */
export function otpSent(req: Request, address: string): void {
  const now = Date.now();
  const addr = address.trim().toLowerCase();
  const ip = clientIp(req);

  const a = byAddress.get(addr) ?? { times: [] };
  a.times = a.times.filter((t) => now - t < DAY).concat(now);
  byAddress.set(addr, a);

  const i = byIp.get(ip) ?? { times: [] };
  i.times = i.times.filter((t) => now - t < HOUR).concat(now);
  byIp.set(ip, i);
}

// Drop entries nobody has touched in a day, so the maps can't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of byAddress) if (v.times.every((t) => now - t >= DAY)) byAddress.delete(k);
  for (const [k, v] of byIp) if (v.times.every((t) => now - t >= HOUR)) byIp.delete(k);
}, 30 * 60_000).unref?.();
