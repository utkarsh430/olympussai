// Pure timetable harvest: getStaticData rows -> route identity, direction and a
// MEASURED target headway (H*) per route-direction.
//
// NO I/O. Every function is a deterministic transformation of its arguments, so
// the same corpus always produces the same index — which is what makes
// `--timetable-file` a reproducible seed input rather than a convenience.
//
// ---------------------------------------------------------------------------
// WHY H* HAD TO MOVE HERE
// ---------------------------------------------------------------------------
// H* is the denominator of the entire detection system: src/headway/bunching.ts
// fires on hFwd/H* against bunched_threshold_ratio (0.25) and
// warning_threshold_ratio (0.5). A wrong H* raises no error — it produces
// silence. MEASURED on the seeded database before this change: 435 of 656
// route-directions carried a fabricated 1,800s, and one direction was seeded at
// 26,130s against a real timetable headway of 478s. At 55x too large, hFwd/H*
// can never reach 0.5, so that route could never be flagged, ever.
//
// The old derivations could not have fixed this, because of what they had to
// work with:
//
//   'journey_span'  one probed vehicle's own day. A bus running a line twice
//                   says nothing about how many buses serve it.
//   'fleet_span'    which vehicles happen to hold an assignment right now — a
//                   SUBSET of the day's workings, so span/(n-1) over it
//                   systematically OVERESTIMATES.
//
// Both infer a property of the SERVICE from a sample of VEHICLES. getStaticData
// publishes the service itself, so this module reads it instead of inferring it.
//
// ---------------------------------------------------------------------------
// THE ESTIMATOR, AND THE TWO CHOICES THAT MATTER
// ---------------------------------------------------------------------------
// For one (line_id, direction):
//
//   1. Bucket departures BY STOP AREA. A departure time only means something
//      relative to other departures AT THE SAME POINT. Pooling stop areas mixes
//      in each journey's running time between them, which manufactures short
//      fake gaps: MEASURED over the full corpus, pooling drops the median
//      derived headway from 2,100s to 1,409s — a 33% downward bias. Too SMALL
//      an H* is precisely the silent-false-negative failure this work exists to
//      remove, so the bias is not acceptable even though pooling would have
//      "derived" more line-directions than bucketing does.
//
//   2. Take the MEDIAN gap, not the mean and not span/(n-1). A published day
//      has a long overnight break in it; the mean and the span estimator both
//      absorb that break into every headway they report, while the median
//      ignores it as the single outlying gap it is. This is the same reasoning
//      that makes MIN/MAX bounds a rejection rather than a clamp below.
//
// Per stop area with >= 2 distinct departures -> that stop's median gap. H* is
// then the median ACROSS those per-stop medians, so a line seen at eleven hub
// stops uses all eleven observations without ever mixing them.
//
// ---------------------------------------------------------------------------
// WHAT IS DELIBERATELY NOT DERIVED
// ---------------------------------------------------------------------------
// A line-direction seen at ONE departure per stop area has no gap to measure.
// MEASURED on the 2026-08-10 corpus: of 1,186 line-directions, 480 yield a
// credible H*, 585 have no repeated departure at any stop area, and 121 derive
// a number outside the credibility bounds. The 706 that produce nothing get NO
// number. Not a fallback, not a network average, not the other direction's
// value — `calibration_source = 'none'`, and detection is off for them visibly
// instead of silently. That is the entire policy: a smaller honestly-calibrated
// set beats broad coverage built on invention.

import type { TimetableDirectionCode, TimetableRow } from '../ingestion/upsrtc/staticData.js';

/**
 * Collapse window for departures that are ONE working published twice.
 *
 * The re-publication defect that forced DUPLICATE_JOURNEY_WINDOW_SECONDS onto
 * the schedule feed is present here too, in a slightly different disguise: not
 * the same vj_id twice (MEASURED: zero (stop_area, vj_id) pairs repeat across
 * all 14,935 rows) but two DISTINCT vj_ids for the same working, offset by a
 * constant. Line 270 publishes vj 1418 and vj 34223 exactly 60s apart at all
 * three stop areas it touches.
 *
 * MEASURED over all 12,508 within-stop gaps in the corpus, the artefact is a
 * discrete spike rather than a tail: 514 gaps are EXACTLY 60s, against 24 at
 * 61s and 23 at 90s. 120s puts a 2x margin around that spike while leaving the
 * next genuine cluster (156 gaps at 180s, 131 at 240s, 267 at exactly 300s)
 * untouched — which matters, because those are real high-frequency corridors
 * and they are precisely the routes bunching detection exists for.
 *
 * Getting this wrong in the permissive direction is the expensive mistake: an
 * uncollapsed 60s artefact becomes H* = 60, every real headway then reads as a
 * ratio far above 0.5, and the route is silently undetectable — the exact
 * failure this module was written to remove.
 */
export const DUPLICATE_DEPARTURE_WINDOW_SECONDS = 120;

/**
 * Credibility floor for a timetable-derived H*, the same figure as
 * src/seed/harvest.ts's MIN_DERIVED_HEADWAY_SECONDS and for the same reason a
 * five-minute floor is right there: a gap small enough to look like a
 * re-publication cannot simultaneously be a credible headway. It also sits
 * exactly on the corpus's densest genuine short gap (267 at 300s), so a real
 * five-minute service is kept rather than rejected.
 */
export const MIN_TIMETABLE_HEADWAY_SECONDS = 300;

/**
 * Credibility ceiling. Four hours, well below harvest.ts's 12h, because this is
 * a measured median gap rather than a span estimator: a median gap that large
 * means the "line" is a handful of scattered long-distance workings, not a
 * service with a headway. src/headway/metrics.ts caps observed headways at 24h,
 * so at H* = 4h the 0.5 warning ratio still sits at 2h — comfortably inside
 * what the metric can ever report.
 *
 * An out-of-range derivation is REJECTED, never clamped. A clamped value looks
 * like a measurement and is not one; the route becomes 'none' instead.
 */
export const MAX_TIMETABLE_HEADWAY_SECONDS = 14_400;

/** Fewer than this many departures at one stop area yields no gap at all. */
const MIN_DEPARTURES_PER_STOP_AREA = 2;

/**
 * Drop departures that are a re-publication of the one before them, keeping the
 * earliest so the survivor is stable across re-runs. Same shape and same
 * reasoning as src/seed/harvest.ts#collapseNearIdenticalDepartures.
 */
export function collapseRepublishedDepartures(
  departureSeconds: Iterable<number>,
  windowSeconds: number = DUPLICATE_DEPARTURE_WINDOW_SECONDS,
): number[] {
  const kept: number[] = [];
  for (const departure of [...new Set(departureSeconds)].sort((a, b) => a - b)) {
    const last = kept[kept.length - 1];
    if (last !== undefined && departure - last <= windowSeconds) continue;
    kept.push(departure);
  }
  return kept;
}

export interface TimetableHeadway {
  targetHeadwaySeconds: number;
  /** Distinct departures at the best-observed stop area. */
  sampleCount: number;
  /** How many stop areas contributed a median gap. */
  stopAreaCount: number;
  /** Stop areas that contributed, ascending. Provenance for the report. */
  stopAreaCodes: number[];
}

/** A derivation that ran but produced a number outside the credibility bounds. */
export interface RejectedTimetableHeadway {
  routeId: string;
  directionCode: TimetableDirectionCode;
  seconds: number;
  sampleCount: number;
  stopAreaCount: number;
}

export interface TimetableRouteIdentity {
  /** routes.id — line_id, the same space getScheduledBusInfo publishes. */
  routeId: string;
  /** EXPLICIT, from line_direction. Never parsed from a name suffix. */
  directionCode: TimetableDirectionCode;
  routeName: string;
  /** route_desc / line_directional_desc — the human name for routes.public_name. */
  publicName: string | null;
}

export interface TimetableReport {
  rowsAccepted: number;
  distinctLines: number;
  distinctLineDirections: number;
  distinctRouteNames: number;
  stopAreasWithRows: number[];
  /** Line-directions with a credible measured H*. */
  headwaysDerived: number;
  /** Line-directions where no stop area saw two departures. Uncalibratable. */
  headwaysNoRepeatedDeparture: number;
  /** Line-directions whose derivation fell outside the credibility bounds. */
  headwaysImplausible: RejectedTimetableHeadway[];
}

export interface TimetableIndex {
  /** `${routeId}|${directionCode}` -> measured H*. */
  headwayByDirection: Map<string, TimetableHeadway>;
  /** route_name (getScheduledBusInfo calls it RouteName) -> identity. */
  identityByRouteName: Map<string, TimetableRouteIdentity>;
  /** routes.id -> the direction codes the timetable publishes for it. */
  directionsByRouteId: Map<string, Set<TimetableDirectionCode>>;
  report: TimetableReport;
}

export function directionKey(routeId: string, directionCode: string): string {
  return `${routeId}|${directionCode}`;
}

/** Middle value of a sorted copy; the mean of the middle two when even. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/**
 * Median gap between successive departures, after collapsing re-publications.
 * null when fewer than two survive.
 */
export function medianGapSeconds(departureSeconds: Iterable<number>): number | null {
  const sorted = collapseRepublishedDepartures(departureSeconds);
  if (sorted.length < MIN_DEPARTURES_PER_STOP_AREA) return null;
  const gaps: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    gaps.push(sorted[index]! - sorted[index - 1]!);
  }
  return medianOf(gaps);
}

export function isCredibleTimetableHeadway(seconds: number): boolean {
  return seconds >= MIN_TIMETABLE_HEADWAY_SECONDS && seconds <= MAX_TIMETABLE_HEADWAY_SECONDS;
}

export type TimetableHeadwayOutcome =
  | { kind: 'derived'; headway: TimetableHeadway }
  | { kind: 'implausible'; seconds: number; sampleCount: number; stopAreaCount: number }
  | { kind: 'no_repeated_departure' };

/**
 * H* for one line-direction from its departures, bucketed by stop area.
 *
 * See the module header for why the buckets are never merged and why the
 * estimator is a median of medians.
 */
export function deriveTimetableHeadway(
  departuresByStopArea: ReadonlyMap<number, ReadonlySet<number>>,
): TimetableHeadwayOutcome {
  const perStopMedians: number[] = [];
  const contributingStopAreas: number[] = [];
  let bestSampleCount = 0;

  for (const stopAreaCode of [...departuresByStopArea.keys()].sort((a, b) => a - b)) {
    const departures = departuresByStopArea.get(stopAreaCode)!;
    const gap = medianGapSeconds(departures);
    if (gap === null) continue;
    perStopMedians.push(gap);
    contributingStopAreas.push(stopAreaCode);
    // The COLLAPSED count, not the raw one: reporting 100 departures when 28 of
    // them were re-publications overstates the evidence behind the number.
    bestSampleCount = Math.max(bestSampleCount, collapseRepublishedDepartures(departures).length);
  }

  if (perStopMedians.length === 0) return { kind: 'no_repeated_departure' };

  const seconds = medianOf(perStopMedians)!;
  if (!isCredibleTimetableHeadway(seconds)) {
    return {
      kind: 'implausible',
      seconds,
      sampleCount: bestSampleCount,
      stopAreaCount: perStopMedians.length,
    };
  }

  return {
    kind: 'derived',
    headway: {
      targetHeadwaySeconds: seconds,
      sampleCount: bestSampleCount,
      stopAreaCount: perStopMedians.length,
      stopAreaCodes: contributingStopAreas,
    },
  };
}

/**
 * Build the whole index from a normalized corpus.
 *
 * Rows arrive already filtered to those carrying a line, an explicit direction,
 * a stop area and a departure (src/ingestion/upsrtc/staticData.ts), so nothing
 * here has to re-check upstream shape.
 */
export function buildTimetableIndex(rows: readonly TimetableRow[]): TimetableIndex {
  const departures = new Map<string, Map<number, Set<number>>>();
  const identityByRouteName = new Map<string, TimetableRouteIdentity>();
  const directionsByRouteId = new Map<string, Set<TimetableDirectionCode>>();
  const stopAreas = new Set<number>();
  const lines = new Set<string>();

  for (const row of rows) {
    const { lineId, directionCode, departureSecondsOfDay, stopAreaCode } = row;
    if (lineId === null || directionCode === null || departureSecondsOfDay === null) continue;

    stopAreas.add(stopAreaCode);
    lines.add(lineId);

    const key = directionKey(lineId, directionCode);
    let byStopArea = departures.get(key);
    if (!byStopArea) {
      byStopArea = new Map<number, Set<number>>();
      departures.set(key, byStopArea);
    }
    let times = byStopArea.get(stopAreaCode);
    if (!times) {
      times = new Set<number>();
      byStopArea.set(stopAreaCode, times);
    }
    times.add(departureSecondsOfDay);

    let directions = directionsByRouteId.get(lineId);
    if (!directions) {
      directions = new Set<TimetableDirectionCode>();
      directionsByRouteId.set(lineId, directions);
    }
    directions.add(directionCode);

    // First row wins, and iteration order is the corpus order, which is stable
    // for a saved file and stop-code-ascending for a live fetch.
    if (row.routeName !== null && !identityByRouteName.has(row.routeName)) {
      identityByRouteName.set(row.routeName, {
        routeId: lineId,
        directionCode,
        routeName: row.routeName,
        publicName: row.routeDescription ?? row.lineDirectionalDescription,
      });
    }
  }

  const headwayByDirection = new Map<string, TimetableHeadway>();
  const implausible: RejectedTimetableHeadway[] = [];
  let noRepeatedDeparture = 0;

  for (const key of [...departures.keys()].sort()) {
    const outcome = deriveTimetableHeadway(departures.get(key)!);
    if (outcome.kind === 'derived') {
      headwayByDirection.set(key, outcome.headway);
      continue;
    }
    if (outcome.kind === 'no_repeated_departure') {
      noRepeatedDeparture += 1;
      continue;
    }
    const [routeId = key, direction = 'OUT'] = key.split('|');
    implausible.push({
      routeId,
      directionCode: direction as TimetableDirectionCode,
      seconds: outcome.seconds,
      sampleCount: outcome.sampleCount,
      stopAreaCount: outcome.stopAreaCount,
    });
  }

  return {
    headwayByDirection,
    identityByRouteName,
    directionsByRouteId,
    report: {
      rowsAccepted: rows.length,
      distinctLines: lines.size,
      distinctLineDirections: departures.size,
      distinctRouteNames: identityByRouteName.size,
      stopAreasWithRows: [...stopAreas].sort((a, b) => a - b),
      headwaysDerived: headwayByDirection.size,
      headwaysNoRepeatedDeparture: noRepeatedDeparture,
      headwaysImplausible: implausible,
    },
  };
}

/**
 * How a route-direction's H* was matched to the timetable. Reported so a run
 * can be audited without re-deriving anything.
 *
 *   'exact'          line_id AND direction_code both came from the timetable.
 *   'sole_direction' the stored direction_code is one the timetable does not
 *                    use ('SINGLE' / 'UP' — pseudo-directions the OLD seeder
 *                    invented when a route name carried no _IN/_OUT suffix),
 *                    AND the timetable publishes exactly ONE direction for that
 *                    line. With only one direction there is only one headway it
 *                    could be, so the match is unambiguous. If the line has two
 *                    directions this does NOT fire: guessing which one a
 *                    pseudo-direction meant is exactly the invention this whole
 *                    change removes.
 */
export type TimetableMatchKind = 'exact' | 'sole_direction';

export interface TimetableHeadwayLookup {
  headway: TimetableHeadway;
  match: TimetableMatchKind;
}

/** Direction codes the timetable itself can produce. Anything else is derived. */
const TIMETABLE_DIRECTION_CODES: readonly string[] = ['IN', 'OUT'];

export function lookupTimetableHeadway(
  index: TimetableIndex,
  routeId: string,
  directionCode: string,
): TimetableHeadwayLookup | null {
  const exact = index.headwayByDirection.get(directionKey(routeId, directionCode));
  if (exact) return { headway: exact, match: 'exact' };

  if (TIMETABLE_DIRECTION_CODES.includes(directionCode)) return null;

  const directions = index.directionsByRouteId.get(routeId);
  if (!directions || directions.size !== 1) return null;
  const [only] = [...directions];
  const headway = index.headwayByDirection.get(directionKey(routeId, only!));
  return headway ? { headway, match: 'sole_direction' } : null;
}
