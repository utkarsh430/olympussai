import type { DepotBusRow } from '@/models/depotLive';
import { distanceM, hasUsablePosition, median, type PositionedRow } from './geo';
import { MOVING_SPEED_KMPH } from './thresholds';
import type { Yard } from './types';
import { YARD_MIN_CLUSTER, YARD_MIN_RADIUS_M, YARD_RADIUS_PAD_M } from './yard';

/*
 * Yard continuity (ruling S43), the pure half. The single-snapshot rule in
 * yard.ts still decides when a yard is first established. But it refuses to
 * choose between two stands of similar size, so a large depot whose terminal
 * stand fills up (42 buses against 41) lost its yard from one poll to the next
 * and every page that reads the yard flipped with it. A yard does not move
 * during the day: once established it is kept while the depot's buses are
 * still standing in it.
 *
 * Given the yard remembered for a depot and what the rule says now:
 *  - nothing remembered: the rule decides;
 *  - the rule gives a yard whose centre is inside the remembered circle: that
 *    yard replaces the remembered one and is not held;
 *  - the rule gives no yard, or one elsewhere: the remembered yard is kept if
 *    at least YARD_MIN_CLUSTER of the depot's standing buses with a usable
 *    position are inside its circle. It is re-centred on those buses by the
 *    rule's own centre and radius, and carries `heldSince`;
 *  - a hold ends YARD_HOLD_MAX_HOURS of feed time after it began, or as soon
 *    as fewer than YARD_MIN_CLUSTER buses stand in it. The rule then decides
 *    afresh, and may place the yard elsewhere.
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
): Yard | null {
  const standing = depotRows.filter(isStandingWithFix);
  const inside = standing.filter(
    (r) => distanceM(r.latitude, r.longitude, kept.lat, kept.lng) <= kept.radiusM,
  );
  if (inside.length < YARD_MIN_CLUSTER) return null;
  const lat = median(inside.map((r) => r.latitude));
  const lng = median(inside.map((r) => r.longitude));
  const farthest = Math.max(...inside.map((r) => distanceM(r.latitude, r.longitude, lat, lng)));
  const radiusM = Math.max(YARD_MIN_RADIUS_M, Math.ceil(farthest + YARD_RADIUS_PAD_M));
  return { lat, lng, radiusM, parked: standing.length, inCluster: inside.length, heldSince };
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
  if (remembered === null) return fresh;
  const kept = remembered.yard;
  const overlaps =
    ruleYard !== null &&
    distanceM(ruleYard.lat, ruleYard.lng, kept.lat, kept.lng) <= kept.radiusM;
  if (overlaps) return fresh;
  const heldSince = kept.heldSince ?? feedNow;
  if (feedMs - Date.parse(heldSince) > YARD_HOLD_MAX_MS) return fresh;
  const yard = heldYard(kept, depotRows, heldSince);
  return yard === null ? fresh : { yard, remembered: { yard, seenMs: feedMs } };
}
