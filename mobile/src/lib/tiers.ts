/**
 * Trust tiers — client mirror of the server gate.
 *
 * ⚠️  NOTHING HERE IS SECURITY.
 *
 * This module exists so the UI can show the right screen and the right prompt. It
 * is a *convenience copy* of rules that are actually enforced in Postgres, by
 * `public.current_tier()` and the RLS policies and column grants around it. If this
 * file and the database ever disagree, the database is right and this file is a bug.
 *
 * Never add a check here and skip the server side. A hidden button is not access
 * control — the database tests deliberately call endpoints directly, bypassing the
 * UI, precisely to prove the server refuses on its own.
 *
 * See CONTEXT.md §4.
 */

export const Tier = {
  /**
   * Signed in with Google, no college email confirmed. Read groups, request a
   * college. Nothing else.
   *
   * Not necessarily temporary: a student whose college issues no email stays here
   * permanently. Treat it as a real destination, not a waiting room.
   */
  Unverified: 0,
  /**
   * DORMANT — nothing currently reaches this tier.
   *
   * It was ID-card verification, which was removed from the product. The number is
   * kept so capability minimums stay meaningful and so reinstating the ID path
   * costs a decision rather than a migration.
   */
  Verified: 1,
  /** College email confirmed, by domain at sign-in or added later. Full access. */
  CollegeVerified: 2,
} as const;

export type TrustTier = (typeof Tier)[keyof typeof Tier];

/** Every gated thing a user can attempt. */
export type Capability =
  | 'readGroups'
  | 'postInGroups'
  | 'directMessage'
  | 'lootyMatch'
  | 'requestCollege';

const MINIMUM_TIER: Record<Capability, TrustTier> = {
  readGroups: Tier.Unverified,
  requestCollege: Tier.Unverified,
  postInGroups: Tier.Verified,
  directMessage: Tier.Verified,
  lootyMatch: Tier.Verified,
};

/**
 * A banned user collapses to Tier 0 — they can still read groups but cannot post,
 * DM, or use Match. This mirrors `current_tier()`, which folds the ban check in so
 * that every policy gets ban enforcement from a plain tier comparison.
 */
export function effectiveTier(tier: TrustTier, isBanned: boolean): TrustTier {
  return isBanned ? Tier.Unverified : tier;
}

export function can(
  capability: Capability,
  tier: TrustTier,
  isBanned = false,
): boolean {
  return effectiveTier(tier, isBanned) >= MINIMUM_TIER[capability];
}

/**
 * Why a capability is unavailable, for the upgrade prompt. Returns null when the
 * user already has access.
 */
export function blockedReason(
  capability: Capability,
  tier: TrustTier,
  isBanned = false,
): 'banned' | 'needsVerification' | null {
  if (can(capability, tier, isBanned)) return null;
  return isBanned ? 'banned' : 'needsVerification';
}

export const TIER_LABEL: Record<TrustTier, string> = {
  [Tier.Unverified]: 'Unverified',
  [Tier.Verified]: 'Verified',
  [Tier.CollegeVerified]: 'College Verified',
};

/**
 * Alumni is display-only. Students are never cut off when their course ends — they
 * get a badge so people can see who they are talking to. Mirrors `is_alumni()`;
 * Indian academic years end around May/June, hence the July boundary.
 */
export function isAlumni(endYear: number | null): boolean {
  if (endYear == null) return false;
  const now = new Date();
  const year = now.getFullYear();
  return endYear < year || (endYear === year && now.getMonth() + 1 > 6);
}
