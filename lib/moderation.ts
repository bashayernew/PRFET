/**
 * One place that decides what a member is and isn't allowed to do.
 *
 * Two independent mechanisms, deliberately kept apart:
 *
 *   GENERAL BLOCK  — `suspendedUntil`. The account is locked. They can still sign in (so
 *     the app can tell them why and how long is left) but every route refuses them.
 *
 *   PARTIAL BLOCK  — `blockCalls`, `blockPosts`, … with an optional `restrictUntil`. They
 *     use the app normally except for the features the admin switched off.
 *
 * Both are checked server-side. A hidden button is a courtesy, not a control: the client
 * is a WebView anyone can point a proxy at, so the API has to be the thing that says no.
 */

export type Feature = "calls" | "posts" | "ai" | "jobs" | "ads" | "chat" | "rooms";

/** The columns every gate needs. Select exactly these to keep the queries cheap. */
export const MODERATION_SELECT = {
  suspendedUntil: true,
  suspendReason: true,
  suspendedAt: true,
  disabledAt: true,
  disabledReason: true,
  restrictUntil: true,
  restrictReason: true,
  blockCalls: true,
  blockPosts: true,
  blockAi: true,
  blockJobs: true,
  blockAds: true,
  blockChat: true,
  blockRooms: true,
} as const;

export type ModerationState = {
  suspendedUntil: Date | null;
  suspendReason: string | null;
  suspendedAt: Date | null;
  disabledAt: Date | null;
  disabledReason: string | null;
  restrictUntil: Date | null;
  restrictReason: string | null;
  blockCalls: boolean;
  blockPosts: boolean;
  blockAi: boolean;
  blockJobs: boolean;
  blockAds: boolean;
  blockChat: boolean;
  blockRooms: boolean;
};

const FLAG: Record<Feature, keyof ModerationState> = {
  calls: "blockCalls",
  posts: "blockPosts",
  ai: "blockAi",
  jobs: "blockJobs",
  ads: "blockAds",
  chat: "blockChat",
  rooms: "blockRooms",
};

/** Whole days remaining, rounded up — "1 day left" should not read as 0 with hours to go. */
export function daysLeft(until: Date | null | undefined): number {
  if (!until) return 0;
  const ms = until.getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/** Account-wide lock, currently in force. */
export function isSuspended(u: Pick<ModerationState, "suspendedUntil">): boolean {
  return !!u.suspendedUntil && u.suspendedUntil.getTime() > Date.now();
}

export function isDisabled(u: Pick<ModerationState, "disabledAt">): boolean {
  return !!u.disabledAt;
}

/**
 * Is this one feature blocked right now?
 *
 * A flag with no `restrictUntil` means "until an admin lifts it" — open-ended, not expired.
 * Reading a null date as "already over" would quietly unblock everyone the admin blocked
 * indefinitely, so the null case has to mean the opposite.
 */
export function isFeatureBlocked(u: ModerationState, feature: Feature): boolean {
  if (isSuspended(u) || isDisabled(u)) return true; // the big hammer covers everything
  if (!u[FLAG[feature]]) return false;
  if (!u.restrictUntil) return true;
  return u.restrictUntil.getTime() > Date.now();
}

/** What the client needs to render a block screen or hide a tab. */
export function moderationSummary(u: ModerationState) {
  const suspended = isSuspended(u);
  const features: Feature[] = (Object.keys(FLAG) as Feature[]).filter((f) =>
    !suspended && !isDisabled(u) ? isFeatureBlocked(u, f) : false,
  );
  return {
    suspended,
    suspendReason: suspended ? u.suspendReason : null,
    suspendedUntil: suspended ? u.suspendedUntil?.toISOString() ?? null : null,
    suspendedAt: suspended ? u.suspendedAt?.toISOString() ?? null : null,
    daysLeft: suspended ? daysLeft(u.suspendedUntil) : 0,
    blockedFeatures: features,
    restrictReason: features.length ? u.restrictReason : null,
    restrictUntil: features.length ? u.restrictUntil?.toISOString() ?? null : null,
    restrictDaysLeft: features.length ? daysLeft(u.restrictUntil) : 0,
  };
}

/**
 * Guard for API routes. Returns null when allowed, or a ready-to-return 403 body.
 * Callers get the reason and the countdown so the app can explain itself rather than
 * showing a bare "forbidden".
 */
export function featureDenial(u: ModerationState, feature: Feature) {
  if (isDisabled(u)) return { error: "account_disabled" as const };
  if (isSuspended(u)) {
    return {
      error: "account_suspended" as const,
      reason: u.suspendReason,
      daysLeft: daysLeft(u.suspendedUntil),
    };
  }
  if (isFeatureBlocked(u, feature)) {
    return {
      error: "feature_blocked" as const,
      feature,
      reason: u.restrictReason,
      daysLeft: daysLeft(u.restrictUntil),
    };
  }
  return null;
}
