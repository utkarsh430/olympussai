import type { DepotBusRow } from '@/models/depotLive';
import {
  distanceM,
  hasUsablePosition,
  median,
  nearDistanceM,
  nearPoint,
  type NearPoint,
  type PositionedRow,
} from './geo';
import type { Yard } from './types';
import { MOVING_SPEED_KMPH } from './thresholds';
import { densityClusters } from './yardClusters';
import { adjacentPlace } from './yardPlace';

/*
 * A yard is learned, not surveyed: it is where the depot's parked buses stand
 * closest together. The values below were set from a midday snapshot of the
 * whole fleet (119 operating depots, about 10,000 buses), not chosen by feel.
 *
 * Parked buses are clustered by distance (see yardClusters.ts). A bus with at
 * least YARD_CORE_MIN_NEIGHBOURS parked buses within YARD_LINK_M, itself
 * included, is a core bus; core buses within that distance of each other are
 * one group; any other bus within that distance of a core bus borders that
 * group and belongs to it, but links nothing further.
 *
 * Groups whose nearest buses stand within YARD_ADJACENT_M are one place (Ruling
 * S46, see yardPlace.ts): the place starts as the largest group and takes in
 * every group within that distance of it, then of what it has taken in, unless
 * that would make it more than YARD_MAX_SPAN_M across. Real yards are compact:
 * the largest group spans 150 m at the median and 376 m at most, and the
 * largest merged place measured 395 m.
 *
 * The yard is that place, provided it holds at least YARD_MIN_CLUSTER buses, at
 * least YARD_MIN_SHARE of the depot's parked buses, at least
 * YARD_DOMINANCE_RATIO times the largest group left outside it, and no two of
 * its buses are more than YARD_MAX_SPAN_M apart. Otherwise no yard is claimed,
 * because a guess between comparable stands would put every departure judged
 * against the yard in the wrong place. A rival of equal size fails the
 * dominance rule, so there is never a choice to make between them. The share is
 * a quarter, not a half: at midday most of a depot's standing buses are at
 * terminals far away, and a half left 65 of 119 depots without a yard.
 *
 * The centre is the median latitude and longitude of the yard's buses. The
 * radius reaches the farthest of them plus YARD_RADIUS_PAD_M (never below
 * YARD_MIN_RADIUS_M), so every bus that forms the yard reads as inside it.
 *
 * What this does not do, on purpose:
 *  - A single file parked thinly (a bus every 100 m) has no core bus, so it is
 *    not a group at all: neither a yard nor a rival to one.
 *  - A chain of single buses does not join two groups, but its first bus, if it
 *    stands within the link distance of three yard buses, is itself a core bus
 *    and the next one borders it: up to two buses of an approach queue count as
 *    in the yard and widen the radius. A queue with a bus every 75 m or closer
 *    joins whatever it reaches; the span limit then decides.
 *  - A bus that belongs to no group is never taken into the place, however near
 *    it stands, and does not carry the place's reach on to a group beyond it.
 *  - Groups further apart than YARD_ADJACENT_M stay two places, and dominance
 *    refuses a yard between comparable ones: at every depot left without a
 *    yard, such groups stood 0.8 to 52 km apart.
 *  - A bus standing just outside the circle reads as away. No margin is added:
 *    before groups were merged the snapshot gave 95 of 119 depots a yard, with
 *    2,444 parked buses inside their own yard and 50 within 450 m outside it,
 *    23 of those at three depots. The merge changes three depots: one gains a
 *    yard, two take in 5 and 9 more buses.
 */

/** Two parked buses this close stand in the same group. */
export const YARD_LINK_M = 150;
/**
 * Two groups whose nearest buses stand this close are one place (Ruling S46).
 * Twice the link distance: a compound's two parking areas were measured 126 m
 * apart, so the link joins them only as the buses at the edges come and go,
 * while every pair of groups seen without a yard stood 0.8 km or more apart.
 */
export const YARD_ADJACENT_M = 2 * YARD_LINK_M;
/** A core bus has this many parked buses within the link distance, itself included. */
export const YARD_CORE_MIN_NEIGHBOURS = 4;
/** Fewer parked buses than this is a coincidence of stops, not a yard. */
export const YARD_MIN_CLUSTER = 6;
/** The yard must hold at least this share of the depot's parked buses. */
export const YARD_MIN_SHARE = 0.25;
/**
 * The yard must beat the second-largest place by this factor: one bus moving
 * must not relocate the yard by tens of kilometres.
 */
export const YARD_DOMINANCE_RATIO = 1.5;
/** Buses further apart than this are a road, not a yard. */
export const YARD_MAX_SPAN_M = 1500;
/** A yard is never claimed smaller than a few bays. */
export const YARD_MIN_RADIUS_M = 120;
/** Margin beyond the farthest bus of the yard so its edge bays count as inside. */
export const YARD_RADIUS_PAD_M = 40;

/** The inferred yard and the registration numbers of the buses that form it, sorted. */
export interface YardGroup {
  readonly yard: Yard;
  readonly members: readonly string[];
}

interface Candidate {
  readonly registrationNumber: string;
  readonly point: NearPoint;
}

function isParkedWithFix(row: DepotBusRow): row is PositionedRow {
  if (!hasUsablePosition(row) || row.speedKmph === null) return false;
  return row.speedKmph <= MOVING_SPEED_KMPH;
}

/** Registration order (by code unit, not locale), then position: a total, stable order. */
function byRegistration(a: Candidate, b: Candidate): number {
  if (a.registrationNumber !== b.registrationNumber) {
    return a.registrationNumber < b.registrationNumber ? -1 : 1;
  }
  return a.point.lat - b.point.lat || a.point.lng - b.point.lng;
}

/** The greatest distance between any two of the points. */
function spanM(points: readonly NearPoint[]): number {
  let widest = 0;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      widest = Math.max(widest, nearDistanceM(points[i]!, points[j]!));
    }
  }
  return widest;
}

function isConfident(largest: readonly NearPoint[], rivalSize: number, parked: number): boolean {
  const size = largest.length;
  if (size < YARD_MIN_CLUSTER) return false;
  if (size / parked < YARD_MIN_SHARE) return false;
  if (size < YARD_DOMINANCE_RATIO * rivalSize) return false;
  return spanM(largest) <= YARD_MAX_SPAN_M;
}

/**
 * Infer one depot's yard and the buses forming it; null unless the evidence is
 * strong (see the rule above) rather than a guess or a midpoint. Buses are put
 * in registration order first, so the answer does not depend on input order.
 * `adjacentM` is the ruled YARD_ADJACENT_M; a test passes 0 to apply the rule
 * as it stood before groups were merged, which no group can then be.
 */
export function inferYardGroup(
  rows: readonly DepotBusRow[],
  adjacentM: number = YARD_ADJACENT_M,
): YardGroup | null {
  const candidates: readonly Candidate[] = rows
    .filter(isParkedWithFix)
    .map((row) => ({
      registrationNumber: row.registrationNumber,
      point: nearPoint(row.latitude, row.longitude),
    }))
    .sort(byRegistration);

  const allPoints = candidates.map((candidate) => candidate.point);
  const groups = densityClusters(allPoints, YARD_LINK_M, YARD_CORE_MIN_NEIGHBOURS);
  const place = adjacentPlace(allPoints, groups, adjacentM, YARD_MAX_SPAN_M);
  if (!place) return null;
  const members = place.members.map((index) => candidates[index]!);
  const points = members.map((member) => member.point);
  if (!isConfident(points, place.rivalSize, candidates.length)) return null;

  const lat = median(points.map((point) => point.lat));
  const lng = median(points.map((point) => point.lng));
  // Measured as locateBus measures it, so no member can fall outside by rounding.
  const farthest = Math.max(...points.map((point) => distanceM(point.lat, point.lng, lat, lng)));
  const radiusM = Math.max(YARD_MIN_RADIUS_M, Math.ceil(farthest + YARD_RADIUS_PAD_M));

  return {
    yard: { lat, lng, radiusM, parked: candidates.length, inCluster: members.length },
    members: members.map((member) => member.registrationNumber),
  };
}

/** One depot's yard; null unless the evidence is strong (see the rule above). */
export function inferYard(rows: readonly DepotBusRow[]): Yard | null {
  return inferYardGroup(rows)?.yard ?? null;
}

/** Yards for every depot id present, skipping rows with no home depot. */
export function inferYards(rows: readonly DepotBusRow[]): ReadonlyMap<string, Yard> {
  const byDepot = new Map<string, DepotBusRow[]>();
  for (const row of rows) {
    if (row.depotId === null) continue;
    const group = byDepot.get(row.depotId) ?? [];
    group.push(row);
    byDepot.set(row.depotId, group);
  }
  const yards = new Map<string, Yard>();
  for (const id of [...byDepot.keys()].sort()) {
    const yard = inferYard(byDepot.get(id) ?? []);
    if (yard) yards.set(id, yard);
  }
  return yards;
}
