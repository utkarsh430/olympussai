import type { DepotBusRow } from '@/models/depotLive';
import { gpsAgeMinutes, isRecentlyHeard } from './busState';
import { distanceM, hasUsablePosition, type PositionedRow } from './geo';
import { MOVING_SPEED_KMPH } from './thresholds';
import type { Yard } from './types';
import { YARD_MIN_CLUSTER } from './yard';

/*
 * Yard continuity (ruling S43), the pure half. The single-snapshot rule in
 * yard.ts still decides when a yard is first established. But it refuses to
 * choose between two stands of similar size, so a large depot whose terminal
 * stand fills up (42 buses against 41) lost its yard from one poll to the next
 * and every page that reads the yard flipped with it. A yard does not move
 * during the day: once established it is kept while the depot's buses are
 * still standing in it.
 *
 * Given the yard remembered for a depot (ruling S50c):
 *  - nothing remembered, or an entry more than YARD_HOLD_MAX_HOURS of feed
 *    time away from this snapshot: the rule decides;
 *  - an entry written at this very feed time (a re-fetch with new rows): that
 *    yard, unchanged, so every poll of one feed time agrees;
 *  - the rule gives a yard whose centre is inside the remembered circle: that
 *    yard replaces the remembered one and is not held;
 *  - the rule gives no yard, or one elsewhere: the remembered yard is kept if
 *    at least YARD_MIN_CLUSTER of the depot's standing buses with a usable
 *    position, heard within the reporting window, are inside its circle. The
 *    circle stays exactly where and as large as it was; only `parked`,
 *    `inCluster` and `heldSince` change, so buses standing at its edge cannot
 *    walk it outward;
 *  - a hold ends YARD_HOLD_MAX_HOURS of feed time after it began, or as soon
 *    as fewer than YARD_MIN_CLUSTER recently heard buses stand in it (dead
 *    devices left in the yard do not keep it). The rule then decides afresh,
 *    and may place the yard elsewhere.
 * No clock is read: `feedNow` is the snapshot's own.
 */

/** A hold lasts no longer than this, by the feed's clock. */
export const YARD_HOLD_MAX_HOURS = 12;
export const YARD_HOLD_MAX_MS = YARD_HOLD_MAX_HOURS * 3_600_000;

export interface RememberedYard {
  readonly yard: Yard;
  /** Feed time, in ms, of the snapshot that last established or held it. */
  readonly seenMs: number;
}

export interface YardDecision {
  /** The yard every page uses on this snapshot. */
  readonly yard: Yard | null;
  /** What to remember for the next snapshot. */
  readonly remembered: RememberedYard | null;
}

/** The yard rule's own evidence: a standing bus with a usable position. */
function isStandingWithFix(row: DepotBusRow): row is PositionedRow {
  if (!hasUsablePosition(row) || row.speedKmph === null) return false;
  return row.speedKmph <= MOVING_SPEED_KMPH;
}

function heldYard(
  kept: Yard,
  depotRows: readonly DepotBusRow[],
  heldSince: string,
  feedNow: string,
): Yard | null {
  const standing = depotRows.filter(isStandingWithFix);
  const inside = standing.filter(
    (r) =>
      isRecentlyHeard(gpsAgeMinutes(r, feedNow)) &&
      distanceM(r.latitude, r.longitude, kept.lat, kept.lng) <= kept.radiusM,
  );
  if (inside.length < YARD_MIN_CLUSTER) return null;
  return { ...kept, parked: standing.length, inCluster: inside.length, heldSince };
}

/**
 * One depot's yard on this snapshot, and what to remember. `depotRows` are the
 * depot's own buses; their order does not matter.
 */
export function continueYard(
  remembered: RememberedYard | null,
  ruleYard: Yard | null,
  depotRows: readonly DepotBusRow[],
  feedNow: string,
  feedMs: number,
): YardDecision {
  const fresh: YardDecision = {
    yard: ruleYard,
    remembered: ruleYard === null ? null : { yard: ruleYard, seenMs: feedMs },
  };
  if (remembered === null || Math.abs(feedMs - remembered.seenMs) > YARD_HOLD_MAX_MS) return fresh;
  if (remembered.seenMs === feedMs) return { yard: remembered.yard, remembered };
  const kept = remembered.yard;
  const overlaps =
    ruleYard !== null && distanceM(ruleYard.lat, ruleYard.lng, kept.lat, kept.lng) <= kept.radiusM;
  if (overlaps) return fresh;
  // An older snapshot decided against a later memory is never "held since" its own future.
  const heldSince =
    kept.heldSince !== undefined && Date.parse(kept.heldSince) <= feedMs ? kept.heldSince : feedNow;
  if (feedMs - Date.parse(heldSince) > YARD_HOLD_MAX_MS) return fresh;
  const yard = heldYard(kept, depotRows, heldSince, feedNow);
  return yard === null ? fresh : { yard, remembered: { yard, seenMs: feedMs } };
}
