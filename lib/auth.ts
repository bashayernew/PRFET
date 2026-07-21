import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "dev-access-secret-change-me";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "dev-refresh-secret-change-me";

const ACCESS_TTL = "15m";
const REFRESH_TTL_DAYS = 30;

/** Password hashing (bcrypt). Upgrade to Argon2id before production scale if desired. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** One-time codes. In development we use a fixed code (1234) for easy testing.
 *  Set OTP_DEV_CODE=1 in the server .env to keep the fixed code in production
 *  (testing phase only — remove it once real email delivery is wired). */
export const DEV_OTP = "1234";
export function generateOtp(): string {
  if (process.env.NODE_ENV !== "production" || process.env.OTP_DEV_CODE === "1") return DEV_OTP;
  // 4-digit, leading zeros allowed
  return crypto.randomInt(0, 10_000).toString().padStart(4, "0");
}
export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** JWTs. */
export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId, type: "access" }, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}
export function signRefreshToken(userId: string): { token: string; expiresAt: Date } {
  const token = jwt.sign({ sub: userId, type: "refresh" }, REFRESH_SECRET, {
    expiresIn: `${REFRESH_TTL_DAYS}d`,
  });
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { token, expiresAt };
}
export function verifyAccessToken(token: string): { sub: string } | null {
  try {
    const decoded = jwt.verify(token, ACCESS_SECRET) as { sub: string; type?: string };
    if (decoded.type !== "access") return null;
    return { sub: decoded.sub };
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): { sub: string } | null {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET) as { sub: string; type?: string };
    if (decoded.type !== "refresh") return null;
    return { sub: decoded.sub };
  } catch {
    return null;
  }
}

/** Pull a Bearer token out of a request's Authorization header. */
export function bearerFromRequest(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const [scheme, token] = h.split(" ");
  return scheme === "Bearer" && token ? token : null;
}

/** Public-safe user shape returned to the client. */
export function publicUser(u: {
  id: string;
  email: string | null;
  phone: string | null;
  contactMethod: string;
  displayName: string;
  realName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  nationality: string | null;
  browseCountries: string;
  gender: string | null;
  accountType: string;
  country: string | null;
  locale: string;
  dateOfBirth: Date | null;
  address: string | null;
  visibility: string;
  showDistance: boolean;
  allowSaveMedia: boolean;
  deleteMediaAfterView: boolean;
  showAddress: boolean;
  dmClosed: boolean;
  hideTop: boolean;
  isPremium: boolean;
  premiumUntil: Date | null;
  autoRenew: boolean;
  renewMonths: number;
  promoVideoUrl: string | null;
  promoLinkUrl: string | null;
  textColor: string | null;
  shareLocation: boolean;
  locationLat: number | null;
  locationLng: number | null;
  social1: string | null;
  social2: string | null;
  social3: string | null;
  isVerified: boolean;
  isAdmin: boolean;
  isOwner: boolean;
}) {
  return {
    id: u.id,
    email: u.email,
    phone: u.phone,
    contactMethod: u.contactMethod,
    displayName: u.displayName,
    realName: u.realName,
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    nationality: u.nationality,
    browseCountries: u.browseCountries ?? "",
    gender: u.gender,
    accountType: u.accountType,
    country: u.country,
    locale: u.locale,
    dateOfBirth: u.dateOfBirth,
    address: u.address,
    visibility: u.visibility,
    showDistance: u.showDistance,
    allowSaveMedia: u.allowSaveMedia,
    deleteMediaAfterView: u.deleteMediaAfterView,
    showAddress: u.showAddress,
    dmClosed: u.dmClosed,
    hideTop: u.hideTop,
    isPremium: u.isPremium,
    premiumUntil: u.premiumUntil,
    autoRenew: u.autoRenew,
    renewMonths: u.renewMonths,
    promoVideoUrl: u.promoVideoUrl,
    promoLinkUrl: u.promoLinkUrl,
    textColor: u.textColor,
    shareLocation: u.shareLocation,
    locationLat: u.locationLat,
    locationLng: u.locationLng,
    social1: u.social1,
    social2: u.social2,
    social3: u.social3,
    isVerified: u.isVerified,
    isAdmin: u.isAdmin,
    isOwner: u.isOwner,
  };
}

/** Normalize a phone number to digits with an optional leading "+". */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim().replace(/[\s()-]/g, "");
  return trimmed.startsWith("+") ? "+" + trimmed.slice(1).replace(/\D/g, "") : trimmed.replace(/\D/g, "");
}

/** Build a Prisma `where` clause that matches a login/recovery identifier
 *  against either the email or phone column. */
export function identifierWhere(identifier: string): { email: string } | { phone: string } {
  const id = identifier.trim();
  if (id.includes("@")) return { email: id.toLowerCase() };
  return { phone: normalizePhone(id) };
}
