/** Premium (VIP) styling helpers. */
import type { CSSProperties } from "react";

export type VipUser = { isPremium?: boolean | null; textColor?: string | null };

/** The colour a premium member picked — applied to their name and anything they write. */
export function vipStyle(u?: VipUser | null): CSSProperties | undefined {
  return u?.isPremium && u.textColor ? { color: u.textColor } : undefined;
}

/** The name colours members can pick. Red is NOT here — it's exclusive to the owner. */
export const NAME_COLORS = ["#f59e0b", "#eab308", "#10b981", "#14b8a6", "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#0ea5e9", "#64748b"];

/** The red only the owner's name may use. */
export const OWNER_RED = "#ef4444";

/** Red is reserved (warnings, blocks, delete) — only the owner may take it. */
export function isReservedRed(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  if (d < 40) return false; // grey-ish, not a red
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  // hues 340°–360° and 0°–15° are the reds
  return h >= 340 || h <= 15;
}

/** A chat bubble in the member's colour: soft tint behind, their colour for the text. */
export function vipBubble(u?: VipUser | null): CSSProperties | undefined {
  if (!u?.isPremium || !u.textColor) return undefined;
  const c = u.textColor;
  return {
    backgroundColor: `${c}1F`, // ~12% tint — keeps the text readable
    color: c,
    boxShadow: `inset 0 0 0 1px ${c}59`,
  };
}
