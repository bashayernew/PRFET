// Lightweight in-memory rate limiter (works because Herot runs as a single Node server).
// For multi-instance scale, back this with Redis.
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/** Returns { ok, retryAfter }. Allows `limit` requests per `windowMs` per key. */
export function rateLimit(req: Request, name: string, limit = 20, windowMs = 60_000): { ok: boolean; retryAfter: number } {
  const key = `${name}:${clientIp(req)}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  b.count += 1;
  if (b.count > limit) return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  return { ok: true, retryAfter: 0 };
}

// Occasionally clear stale buckets.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
}, 5 * 60_000).unref?.();
