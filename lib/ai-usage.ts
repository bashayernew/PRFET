/**
 * Per-tier monthly caps for the costly AI actions (image + video generation), so a user
 * can never burn through the Google bill. Text chat and browser voice are free/unlimited.
 *
 * Caps live in AppSettings (dashboard-editable). Counters live on the User and reset on
 * the first action of each calendar month. Admins are always unlimited; a cap of 0 also
 * means unlimited (lets the dashboard turn a cap off entirely).
 */
import { prisma } from "@/lib/prisma";

export type AiKind = "image" | "video";
export type CapCheck = { allowed: boolean; cap: number; used: number; remaining: number };

/** Current month key in UTC, e.g. "2026-08". */
function monthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Check whether a user may perform one more AI action of `kind` this month.
 * Rolls the monthly counters over to the new month if needed (persisted).
 * Does NOT increment — call aiCapBump() after a successful generation.
 */
export async function aiCapCheck(userId: string, kind: AiKind): Promise<CapCheck> {
  const unlimited: CapCheck = { allowed: true, cap: 0, used: 0, remaining: Infinity };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isAdmin: true, premiumTier: true,
      aiImagesUsed: true, aiVideosUsed: true, aiUsageMonth: true,
      aiImagesExtra: true, aiVideosExtra: true,
    },
  });
  if (!user) return unlimited;
  if (user.isAdmin) return unlimited; // admins never metered

  const s = await prisma.appSettings.findUnique({
    where: { id: "app" },
    select: { aiImagesBasic: true, aiImagesVip: true, aiVideosBasic: true, aiVideosVip: true },
  }).catch(() => null);

  const vip = (user.premiumTier || "basic") === "vip";
  const baseCap = kind === "image"
    ? (vip ? (s?.aiImagesVip ?? 100) : (s?.aiImagesBasic ?? 35))
    : (vip ? (s?.aiVideosVip ?? 20) : (s?.aiVideosBasic ?? 9));
  if (!baseCap || baseCap <= 0) return unlimited; // 0 = unlimited

  // Roll counters (and add-on top-ups) over if we've entered a new month.
  const month = monthKey();
  let imagesUsed = user.aiImagesUsed;
  let videosUsed = user.aiVideosUsed;
  let imagesExtra = user.aiImagesExtra;
  let videosExtra = user.aiVideosExtra;
  if (user.aiUsageMonth !== month) {
    imagesUsed = 0; videosUsed = 0; imagesExtra = 0; videosExtra = 0;
    await prisma.user.update({
      where: { id: userId },
      data: { aiUsageMonth: month, aiImagesUsed: 0, aiVideosUsed: 0, aiImagesExtra: 0, aiVideosExtra: 0, aiMsgsUsed: 0, aiMsgsExtra: 0, callSecondsUsed: 0, callSecondsExtra: 0 },
    }).catch(() => {});
  }

  // Effective cap = tier allowance + any add-on packs bought this month.
  const cap = baseCap + (kind === "image" ? imagesExtra : videosExtra);
  const used = kind === "image" ? imagesUsed : videosUsed;
  const remaining = Math.max(0, cap - used);
  return { allowed: used < cap, cap, used, remaining };
}

/**
 * The buyable add-on packs (prices live in AppSettings, dashboard-editable):
 *  - voice   ($1.99, 1 month): +120 AI-voice minutes
 *  - media   ($1.99, 1 month): +5 images, +2 videos, +200 messages
 *  - storage ($1.99, 3 months): +25 GB of storage
 * Image/video/message/voice top-ups reset with the calendar month; storage carries its
 * own expiry date.
 */
export type AddonPack = {
  images?: number;   // extra image generations (this month)
  videos?: number;   // extra video generations (this month)
  messages?: number; // extra assistant messages (this month)
  minutes?: number;  // extra AI-voice minutes (this month)
  storageGb?: number; // extra storage (GB), valid for `storageMonths`
  storageMonths?: number;
};

export const ADDON_PACKS: Record<string, AddonPack> = {
  voice:   { minutes: 120 },
  media:   { images: 5, videos: 2, messages: 200 },
  storage: { storageGb: 25, storageMonths: 3 },
};

/**
 * Credit an add-on pack to a user. Monthly top-ups (images/videos/messages/voice) land in
 * the current month; a storage pack extends the storage bonus by its months. Call this only
 * AFTER a real purchase is verified (store billing) or from an admin manual grant.
 */
export async function aiGrantAddon(userId: string, pack: string): Promise<boolean> {
  const p = ADDON_PACKS[pack];
  if (!p) return false;
  const month = monthKey();

  // Make sure the monthly top-ups belong to this month before adding to them.
  await prisma.user.updateMany({
    where: { id: userId, NOT: { aiUsageMonth: month } },
    data: { aiUsageMonth: month, aiImagesUsed: 0, aiVideosUsed: 0, aiImagesExtra: 0, aiVideosExtra: 0, aiMsgsUsed: 0, aiMsgsExtra: 0, callSecondsUsed: 0, callSecondsExtra: 0 },
  }).catch(() => {});

  const monthly: Record<string, { increment: number }> = {};
  if (p.images) monthly.aiImagesExtra = { increment: p.images };
  if (p.videos) monthly.aiVideosExtra = { increment: p.videos };
  if (p.messages) monthly.aiMsgsExtra = { increment: p.messages };
  if (p.minutes) monthly.callSecondsExtra = { increment: p.minutes * 60 };
  if (Object.keys(monthly).length) {
    await prisma.user.update({ where: { id: userId }, data: monthly }).catch(() => {});
  }

  // Storage add-on: extend from whichever is later (now, or an existing bonus end).
  if (p.storageGb && p.storageMonths) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { storageBonusUntil: true, storageBonusBytes: true } }).catch(() => null);
    const now = new Date();
    const from = u?.storageBonusUntil && u.storageBonusUntil > now ? u.storageBonusUntil : now;
    const until = new Date(from);
    until.setMonth(until.getMonth() + p.storageMonths);
    const add = BigInt(p.storageGb) * BigInt(1024 * 1024 * 1024);
    // If the old bonus already lapsed, start fresh; otherwise stack on top.
    const base = u?.storageBonusUntil && u.storageBonusUntil > now ? (u.storageBonusBytes ?? BigInt(0)) : BigInt(0);
    await prisma.user.update({
      where: { id: userId },
      data: { storageBonusBytes: base + add, storageBonusUntil: until },
    }).catch(() => {});
  }
  return true;
}

/** Count one successful AI action against the user's monthly total. */
export async function aiCapBump(userId: string, kind: AiKind): Promise<void> {
  const month = monthKey();
  const field = kind === "image" ? "aiImagesUsed" : "aiVideosUsed";
  // Make sure the counter belongs to this month before incrementing.
  await prisma.user.updateMany({
    where: { id: userId, NOT: { aiUsageMonth: month } },
    data: { aiUsageMonth: month, aiImagesUsed: 0, aiVideosUsed: 0, aiImagesExtra: 0, aiVideosExtra: 0, aiMsgsUsed: 0, aiMsgsExtra: 0, callSecondsUsed: 0, callSecondsExtra: 0 },
  }).catch(() => {});
  await prisma.user.update({
    where: { id: userId },
    data: { [field]: { increment: 1 } },
  }).catch(() => {});
}

/* -------------------------------------------------------------------------- */
/*  Assistant messages, AI-voice time, and media storage — same idea as above  */
/*  (dashboard-editable caps in AppSettings, counters on the User). Messages    */
/*  and voice reset each month; storage is cumulative and never resets.         */
/* -------------------------------------------------------------------------- */

/** Roll the shared monthly counters over if we've entered a new calendar month. */
async function rollMonth(userId: string): Promise<void> {
  const month = monthKey();
  await prisma.user.updateMany({
    where: { id: userId, NOT: { aiUsageMonth: month } },
    data: { aiUsageMonth: month, aiImagesUsed: 0, aiVideosUsed: 0, aiImagesExtra: 0, aiVideosExtra: 0, aiMsgsUsed: 0, aiMsgsExtra: 0, callSecondsUsed: 0, callSecondsExtra: 0 },
  }).catch(() => {});
}

/** May this user send one more assistant message this month? */
export async function msgCapCheck(userId: string): Promise<CapCheck> {
  const unlimited: CapCheck = { allowed: true, cap: 0, used: 0, remaining: Infinity };
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true, premiumTier: true, aiMsgsUsed: true, aiMsgsExtra: true, aiUsageMonth: true },
  });
  if (!user || user.isAdmin) return unlimited;

  const s = await prisma.appSettings.findUnique({
    where: { id: "app" },
    select: { aiMessagesBasic: true, aiMessagesVip: true },
  }).catch(() => null);
  const vip = (user.premiumTier || "basic") === "vip";
  const base = vip ? (s?.aiMessagesVip ?? 7500) : (s?.aiMessagesBasic ?? 4000);
  if (!base || base <= 0) return unlimited;

  const month = monthKey();
  const thisMonth = user.aiUsageMonth === month;
  const cap = base + (thisMonth ? user.aiMsgsExtra : 0); // add-on top-ups bought this month
  const used = thisMonth ? user.aiMsgsUsed : 0;
  return { allowed: used < cap, cap, used, remaining: Math.max(0, cap - used) };
}

/** Count one assistant message against the monthly total. */
export async function msgBump(userId: string): Promise<void> {
  await rollMonth(userId);
  await prisma.user.update({
    where: { id: userId },
    data: { aiMsgsUsed: { increment: 1 } },
  }).catch(() => {});
}

/** May this user spend more AI-voice time this month? (cap stored in minutes) */
export async function voiceCapCheck(userId: string): Promise<CapCheck> {
  const unlimited: CapCheck = { allowed: true, cap: 0, used: 0, remaining: Infinity };
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true, premiumTier: true, callSecondsUsed: true, callSecondsExtra: true, aiUsageMonth: true },
  });
  if (!user || user.isAdmin) return unlimited;

  const s = await prisma.appSettings.findUnique({
    where: { id: "app" },
    select: { callMinutesBasic: true, callMinutesVip: true },
  }).catch(() => null);
  const vip = (user.premiumTier || "basic") === "vip";
  const capMin = vip ? (s?.callMinutesVip ?? 480) : (s?.callMinutesBasic ?? 2000);
  if (!capMin || capMin <= 0) return unlimited;

  const month = monthKey();
  const thisMonth = user.aiUsageMonth === month;
  const cap = capMin * 60 + (thisMonth ? user.callSecondsExtra : 0); // seconds; + add-on top-ups
  const used = thisMonth ? user.callSecondsUsed : 0;
  return { allowed: used < cap, cap, used, remaining: Math.max(0, cap - used) };
}

/** Add spoken seconds to the monthly AI-voice total. */
export async function voiceBump(userId: string, seconds: number): Promise<void> {
  const add = Math.max(0, Math.round(seconds));
  if (!add) return;
  await rollMonth(userId);
  await prisma.user.update({
    where: { id: userId },
    data: { callSecondsUsed: { increment: add } },
  }).catch(() => {});
}

/** Would this upload fit inside the user's storage cap? (cap stored in GB, cumulative) */
export async function storageCheck(userId: string, addBytes: number): Promise<CapCheck & { allowed: boolean }> {
  const unlimited = { allowed: true, cap: 0, used: 0, remaining: Infinity };
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true, premiumTier: true, storageBytesUsed: true, storageBonusBytes: true, storageBonusUntil: true },
  });
  if (!user || user.isAdmin) return unlimited;

  const s = await prisma.appSettings.findUnique({
    where: { id: "app" },
    select: { storageGbBasic: true, storageGbVip: true },
  }).catch(() => null);
  const vip = (user.premiumTier || "basic") === "vip";
  const capGb = vip ? (s?.storageGbVip ?? 50) : (s?.storageGbBasic ?? 25);
  if (!capGb || capGb <= 0) return unlimited;

  // Add any still-valid storage add-on on top of the tier's allowance.
  const bonusActive = user.storageBonusUntil && user.storageBonusUntil > new Date();
  const bonus = bonusActive ? Number(user.storageBonusBytes) : 0;
  const cap = capGb * 1024 * 1024 * 1024 + bonus;
  const used = Number(user.storageBytesUsed);
  return { allowed: used + addBytes <= cap, cap, used, remaining: Math.max(0, cap - used) };
}

/** Add uploaded bytes to the running storage total. */
export async function storageBump(userId: string, bytes: number): Promise<void> {
  const add = Math.max(0, Math.round(bytes));
  if (!add) return;
  await prisma.user.update({
    where: { id: userId },
    data: { storageBytesUsed: { increment: BigInt(add) } },
  }).catch(() => {});
}

/** Give storage back when media is deleted (never drops below zero). */
export async function storageRelease(userId: string, bytes: number): Promise<void> {
  const sub = Math.max(0, Math.round(bytes));
  if (!sub) return;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { storageBytesUsed: true } }).catch(() => null);
  if (!u) return;
  const next = Number(u.storageBytesUsed) - sub;
  await prisma.user.update({
    where: { id: userId },
    data: { storageBytesUsed: BigInt(Math.max(0, next)) },
  }).catch(() => {});
}
