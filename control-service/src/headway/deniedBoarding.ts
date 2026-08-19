// Detecting passengers left behind - the bunching amplifier nothing in this
// system can currently see.
//
// ─── WHY THIS IS NOT JUST A CROWDING METRIC ──────────────────────────────
//
// A full bus stops taking passengers. It therefore skips the dwell time it
// should have spent loading them, pulls away early, and closes on the bus in
// front. The gap BEHIND it grows, so the next bus arrives to an even larger
// crowd, fills up sooner, and does the same. Denied boarding is not merely a
// consequence of bunching, it is a positive feedback loop that accelerates
// it - and one the deployed controller is completely blind to, because it
// reasons only about gaps between buses and never about who could not get on.
//
// It is also the strongest reading available on the operator's third
// priority. "Passengers evenly distributed" fails most visibly not when one
// bus is fuller than another, but when someone is standing at a stop
// watching a bus go past.
//
// ─── THE SIGNAL ──────────────────────────────────────────────────────────
//
// Two conditions together, neither sufficient alone:
//
//   1. The bus was AT or NEAR capacity on departure.
//   2. It dwelled for LESS time than its own fitted dwell model says a gap
//      that long should have produced.
//
// Condition 1 alone is a full bus that still managed to load everyone.
// Condition 2 alone is a quiet stop, or a fast one. Together they say: a lot
// of people should have boarded here, and the bus left too quickly for them
// to have done so.
//
// ─── WHY IT IS INFERENCE, AND LABELLED AS SUCH ───────────────────────────
//
// Nothing counts people left on a kerb. This is a signal derived from an
// occupancy reading and a dwell model, and both carry error - the dwell
// comes from geofence crossings at a 30-second polling interval, and the
// model is a per-stop regression. `confidence` reports how far into the
// signal a case is rather than pretending to a binary, and every field name
// says "suspected". A detector that reported certainty here would put a
// number in front of an operator that no measurement supports.
import type { DwellModel } from '../calibration/dwell.js';
import { expectedDwellSeconds } from '../calibration/dwell.js';

/** How full a bus must be before a short dwell is suspicious at all. */
export const NEAR_CAPACITY_FRACTION = 0.9;

/**
 * How much shorter than expected the dwell must be to count.
 *
 * 0.6 means the bus spent under 60% of its modelled dwell. Generous on
 * purpose: the dwell measurement carries roughly a GPS polling interval of
 * error at each end, so a tight threshold would fire on timing noise, and a
 * false denied-boarding report is worse than a missed one - it is the kind
 * of number that gets quoted at a review and cannot be substantiated.
 */
export const SHORT_DWELL_RATIO = 0.6;

export interface DeniedBoardingInput {
  stopId: string;
  routeDirectionId: string;
  vehicleId: string;
  /** Gap since the previous bus departed this stop - what the dwell model is conditioned on. */
  precedingHeadwaySeconds: number;
  /** Measured dwell for this visit. */
  observedDwellSeconds: number;
  /** Onboard count on departure, or null when unknown. */
  occupancyCount: number | null;
  /** Seat + standing capacity for this vehicle, or null when unknown. */
  capacity: number | null;
}

export interface SuspectedDeniedBoarding {
  stopId: string;
  routeDirectionId: string;
  vehicleId: string;
  occupancyFraction: number;
  observedDwellSeconds: number;
  expectedDwellSeconds: number;
  /**
   * 0-1, rising with how full the bus was and how far short the dwell fell.
   * A ranking aid for an operator triaging a list, never a probability.
   */
  confidence: number;
}

/**
 * Whether this visit looks like one where people were left behind.
 *
 * Returns null - "cannot say" - whenever occupancy, capacity or a fitted
 * dwell model is missing, which is every visit today. That is the same
 * refusal the rest of this codebase makes about unmeasured quantities, and
 * it matters more here than most: this signal exists to be counted and
 * reported, and a detector that guessed in the absence of occupancy would
 * produce a denied-boarding TREND made entirely of assumptions.
 */
export function detectDeniedBoarding(
  input: DeniedBoardingInput,
  model: DwellModel | null,
): SuspectedDeniedBoarding | null {
  if (!model) return null;
  if (input.occupancyCount === null || input.capacity === null || input.capacity <= 0) return null;
  if (!Number.isFinite(input.observedDwellSeconds) || input.observedDwellSeconds < 0) return null;

  const occupancyFraction = input.occupancyCount / input.capacity;
  if (occupancyFraction < NEAR_CAPACITY_FRACTION) return null;

  const expected = expectedDwellSeconds(model, input.precedingHeadwaySeconds);
  // A stop the model expects to take no time cannot produce a dwell that is
  // suspiciously short.
  if (expected <= 0) return null;

  const dwellRatio = input.observedDwellSeconds / expected;
  if (dwellRatio >= SHORT_DWELL_RATIO) return null;

  // Both dimensions, each normalised to how far past its threshold the case
  // sits, so a bus at exactly 90% full that dwelled at exactly 60% of
  // expected scores near zero and a crush-loaded bus that barely stopped
  // scores near one.
  const fullness = Math.min(
    1,
    (occupancyFraction - NEAR_CAPACITY_FRACTION) / (1 - NEAR_CAPACITY_FRACTION),
  );
  const brevity = Math.min(1, (SHORT_DWELL_RATIO - dwellRatio) / SHORT_DWELL_RATIO);

  return {
    stopId: input.stopId,
    routeDirectionId: input.routeDirectionId,
    vehicleId: input.vehicleId,
    occupancyFraction,
    observedDwellSeconds: input.observedDwellSeconds,
    expectedDwellSeconds: expected,
    confidence: (fullness + brevity) / 2,
  };
}

/**
 * Load spread across the buses on a corridor - the third priority, stated
 * directly rather than inferred from headway regularity.
 *
 * Even spacing produces even loads only when demand is uniform along the
 * route, which it is not on a corridor with a dominant origin. So this is
 * measured on its own terms: the 90th-percentile load is what a crowding
 * complaint is about, and the spread between the fullest and emptiest bus is
 * what "evenly distributed" means when an operator says it.
 *
 * Null when fewer than two buses reported occupancy - one bus has no
 * distribution, and reporting a zero spread for it would read as perfect
 * balance.
 */
export function computeLoadBalance(
  occupancyCounts: readonly (number | null)[],
  capacity: number | null,
): {
  vehicleCount: number;
  meanFraction: number;
  p90Fraction: number;
  /** Max minus min load fraction. 0 = every bus equally loaded. */
  spreadFraction: number;
} | null {
  if (capacity === null || capacity <= 0) return null;
  const fractions = occupancyCounts
    .filter((c): c is number => c !== null && Number.isFinite(c))
    .map((c) => c / capacity)
    .sort((a, b) => a - b);
  if (fractions.length < 2) return null;

  const mean = fractions.reduce((s, v) => s + v, 0) / fractions.length;
  const p90Index = Math.min(fractions.length - 1, Math.ceil(0.9 * fractions.length) - 1);

  return {
    vehicleCount: fractions.length,
    meanFraction: mean,
    p90Fraction: fractions[Math.max(0, p90Index)]!,
    spreadFraction: fractions[fractions.length - 1]! - fractions[0]!,
  };
}
