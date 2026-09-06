/**
 * Ad placement for the Match feed.
 *
 * The placement is here; the ad is not. Showing one needs an AdMob account and
 * `react-native-google-mobile-ads`, which is a native module and therefore a new
 * build — neither exists yet. This module counts decisions and decides *when* an
 * ad should appear, so wiring AdMob later is a change to `present()` alone.
 *
 * Counting decisions, not loots. Passing is uncapped and only loots consume the
 * daily quota, so a free user makes at most 10 loots a day — an ad every 5 loots
 * would show at most twice and earn nothing. Decisions track real usage.
 *
 * The time floor exists because someone passing quickly would otherwise be shown
 * an ad every few seconds, which is how an app gets uninstalled.
 */

const EVERY_N_DECISIONS = 5;
const MIN_GAP_MS = 3 * 60 * 1000;

let decisions = 0;
let lastShownAt = 0;

/** Test seam. Not used by the app. */
export function _resetAdState() {
  decisions = 0;
  lastShownAt = 0;
}

/**
 * Whether an ad is due right now. Exported so the counting rule can be tested
 * without a real ad network attached.
 */
export function adIsDue(now = Date.now()): boolean {
  if (decisions === 0 || decisions % EVERY_N_DECISIONS !== 0) return false;
  return now - lastShownAt >= MIN_GAP_MS;
}

/**
 * Record one Match decision — a loot or a pass — and show an ad if one is due.
 * Safe to call on every decision; it is cheap and mostly does nothing.
 */
export async function countDecisionForAd(now = Date.now()): Promise<void> {
  decisions += 1;
  if (!adIsDue(now)) return;
  lastShownAt = now;
  await present();
}

/**
 * Replace this body when AdMob exists. Until then an ad being "due" is a no-op,
 * which keeps the counting logic live and testable without pretending to serve
 * anything.
 */
async function present(): Promise<void> {
  // TODO(ads): load and show an AdMob interstitial once the account exists and
  // react-native-google-mobile-ads is in a native build.
}
