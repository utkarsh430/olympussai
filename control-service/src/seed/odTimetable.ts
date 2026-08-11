// Pure OD harvest: getBusBetweenStops rows -> a MEASURED target headway (H*)
// per route-direction, statewide.
//
// NO I/O. Every function is a deterministic transformation of its arguments, so
// the same corpus always produces the same index — which is what makes
// `--od-file` a reproducible seed input rather than a convenience, exactly as
// `--timetable-file` is for src/seed/timetable.ts.
//
// ---------------------------------------------------------------------------
// WHY A SECOND SOURCE, AND WHY IT RANKS BELOW THE FIRST
// ---------------------------------------------------------------------------
// getStaticData.php is the corridor timetable and stays authoritative. It
// publishes a DEPARTURE BOARD at a stop, which is headway at a point in the
// strict sense. It is also scoped to 22 stops on one instrumented corridor
// (MEASURED by probing stop_code 1..400 with zero errors), so it calibrated 74
// of 666 seeded route-directions and left 592 with no target at all.
//
// getBusBetweenStops.php covers the state. Its rows are real published trips
// with real published departure times, so the numbers derived here are
// measurements and not estimates — but they are assembled from queries about
// city PAIRS rather than read off one board, so the view of any single route is
// coarser and its completeness depends on which city pairs the route happens to
// span. That is the whole justification for a separate calibration_source and
// for the precedence rule in src/seed/recalibrate.ts:
//
//     'timetable'  >  'od_timetable'  >  'none'
//
// A route already carrying 'timetable' is NEVER overwritten. Ranking is not a
// judgement about which number is prettier; it is about which observation is
// closer to the definition of headway.
//
// ---------------------------------------------------------------------------
// THE ESTIMATOR: THE SAME ONE, DELIBERATELY
// ---------------------------------------------------------------------------
// Departures are bucketed BY BOARDING STOP (`from_stop_name`), each bucket
// yields its median gap, and H* is the median across buckets — precisely
// src/seed/timetable.ts#deriveTimetableHeadway, whose helpers this module
// imports rather than restates. The bounds
// (MIN/MAX_TIMETABLE_HEADWAY_SECONDS), the 120s re-publication collapse and the
// reject-never-clamp rule all come from there too.
//
// BUCKETING BY STOP MATTERS MORE HERE THAN IT DID THERE, because this feed
// makes the pooling mistake easy and expensive. MEASURED on a real response:
// within one Lucknow -> Prayagraj query, vj_id 19237 appears TWICE — once for
// KAISERBAGH at 10:53:44 and once for ALAMBAGH at 11:08:52. Those are the same
// bus fifteen minutes apart on its way out of one city. Pool the boarding stops
// and that single working manufactures a 15-minute "headway" out of nothing; do
// it across a corridor of stops and a once-daily long-distance route acquires a
// dense fake service. Bucketing by `from_stop_name` is what makes each bucket a
// genuine departure board again.
//
// THE BIAS IS MEASURED, NOT ASSUMED, over the full 53,898-row sweep of all 210
// ordered city pairs (2026-08-11). Both estimators were run over the same
// corpus and compared on the 906 line-directions BOTH can answer for:
//
//                       median derived H*     line-directions derived
//   pooled per route          1,635 s                  1,441
//   bucketed per stop         2,582 s                    940
//
// Pooling reports a 37% SHORTER headway, and does so on 399 of the 906 (44%).
// An H* biased LOW is the silent-false-negative failure this whole line of work
// exists to remove: every threshold in src/headway/ is a ratio of H*, so a
// too-small denominator makes hFwd/H* look healthy and the route is never
// flagged. (src/seed/timetable.ts measured the same effect on its own corpus at
// 33%, and refused pooling for the same reason.)
//
// THE COST OF REFUSING IT IS ALSO MEASURED, and it is real: against the seeded
// database, pooling would calibrate 111 route-directions the corridor timetable
// cannot answer for, and bucketing calibrates 97. Fourteen route-directions of
// coverage were given up to keep the other 97 honest. That trade is the whole
// policy of this seeder stated numerically.
//
// The same journey also recurs across the sweep — a route spanning five cities
// is returned by every pair it covers — so departure times are held in a Set
// per bucket and identical values collapse before any gap is computed.
//
// ---------------------------------------------------------------------------
// DIRECTION
// ---------------------------------------------------------------------------
// This endpoint publishes NO explicit direction word, unlike getStaticData's
// `line_direction`. The only signal is the `_IN` / `_OUT` suffix on
// `route_name` ("MZP_1310_ORD_OUT"), read with the harvester's existing
// `directionSuffix` (src/seed/routeName.ts) so there is one definition of what
// those suffixes mean.
//
// A row whose route_name carries NEITHER suffix is kept, under the direction
// key 'UNSUFFIXED', and is usable only through the sole-direction lookup below.
// It is not guessed into 'OUT': the seeded network's 118 'SINGLE' and 10 'UP'
// route-directions exist precisely because the old seeder used to guess, and
// lookupOdHeadway resolves those the same disciplined way
// src/seed/timetable.ts does — only when the line has exactly one direction, so
// there is only one answer it could be.
//
// ---------------------------------------------------------------------------
// WHAT IS DELIBERATELY NOT DERIVED, AND THE HONEST COVERAGE NUMBER
// ---------------------------------------------------------------------------
// A line-direction with one departure per boarding stop has no gap to measure
// and gets NO number. Not a fallback, not a network average, not the other
// direction's value. It stays 'none', and detection stays off for it visibly.
// A narrower honestly-calibrated set beats a bigger-looking one built on
// invention — this module exists to widen coverage, not to manufacture it.
//
// MEASURED end to end on the live database, 2026-08-11:
//
//   53,898 OD rows -> 2,155 distinct lines, 2,185 line-directions, of which
//   940 yield a credible H*. Of the 666 active route-directions, 170 have their
//   line present in the corpus, 130 get a derivable OD headway, and 33 of those
//   are ALSO covered by the corridor timetable — which wins, by precedence. Net:
//
//     74 'timetable' + 97 'od_timetable' = 171 calibrated (25.7%), 495 'none'.
//
// The join is the ceiling, not the estimator. `line_name` matches routes.id for
// only ~170 of 666 seeded route-directions, because routes.id came from
// getScheduledBusInfo's `line_id` and this feed's `line_name` is often not a
// line id at all — MEASURED, many rows carry a description there instead
// ("ALAMBAGH TO MIRZAPUR VIA ZEROROAD BUS STATION"). Keying on `route_name`
// instead reaches 2,851 derivable groups, which looks far better and lines up
// with nothing that was seeded. A bigger keyspace is not a better join.

import { directionSuffix } from './routeName.js';
import {
  collapseRepublishedDepartures,
  directionKey,
  isCredibleTimetableHeadway,
  medianGapSeconds,
  medianOf,
} from './timetable.js';
import type { OdScheduleRow } from '../ingestion/upsrtc/busBetweenStops.js';

/**
 * The direction key for a row whose route_name carries no _IN/_OUT suffix.
 *
 * Deliberately NOT one of the real direction codes, and deliberately not
 * dropped either: such a row is real service and its departures are real, but
 * which direction they belong to is unstated. Keeping them under a key that
 * cannot collide with 'IN' or 'OUT' means they can be used where they are
 * unambiguous (a line with one direction) and are inert everywhere else.
 */
export const UNSUFFIXED_DIRECTION = 'UNSUFFIXED';

/** Fewer than this many distinct departures at one boarding stop yields no gap. */
const MIN_DEPARTURES_PER_STOP = 2;

/**
 * A derived OD headway and the evidence behind it.
 *
 * READ `stopCount` BEFORE TRUSTING THE NUMBER. Because the sweep queries city
 * GROUPS, boarding stops are the major terminals only — MEASURED, 43 distinct
 * `from_stop_name` values across all 53,898 rows — and the median calibrated
 * route-direction ends up with stopCount 1 (max 9). `sampleCount` is healthier:
 * median 17 collapsed departures, max 113.
 *
 * A single well-sampled boarding stop IS a departure board and is the right
 * thing to measure. It is simply one observation point rather than several, so
 * these numbers carry less corroboration than a 'timetable' H* does — which is
 * exactly why they are labelled differently and rank below it.
 */
export interface OdHeadway {
  targetHeadwaySeconds: number;
  /** Distinct (collapsed) departures at the best-observed boarding stop. */
  sampleCount: number;
  /** How many boarding stops contributed a median gap. */
  stopCount: number;
  /** Boarding stops that contributed, sorted. Provenance for the report. */
  stopNames: string[];
}

/** A derivation that ran but produced a number outside the credibility bounds. */
export interface RejectedOdHeadway {
  routeId: string;
  directionCode: string;
  seconds: number;
  sampleCount: number;
  stopCount: number;
}

export interface OdReport {
  rowsAccepted: number;
  /** Distinct `line_name` values — the keyspace that joins to routes.id. */
  distinctLines: number;
  distinctLineDirections: number;
  /** Distinct `route_name` values, for comparison with the line keyspace. */
  distinctRouteNames: number;
  distinctBoardingStops: number;
  /** Rows whose route_name carried no _IN/_OUT suffix. */
  rowsWithoutDirectionSuffix: number;
  headwaysDerived: number;
  /** Line-directions where no boarding stop saw two departures. Uncalibratable. */
  headwaysNoRepeatedDeparture: number;
  headwaysImplausible: RejectedOdHeadway[];
}

export interface OdIndex {
  /** `${lineName}|${directionCode}` -> measured H*. */
  headwayByDirection: Map<string, OdHeadway>;
  /** line_name -> the direction keys the OD corpus publishes for it. */
  directionsByRouteId: Map<string, Set<string>>;
  report: OdReport;
}

export type OdHeadwayOutcome =
  | { kind: 'derived'; headway: OdHeadway }
  | { kind: 'implausible'; seconds: number; sampleCount: number; stopCount: number }
  | { kind: 'no_repeated_departure' };

/**
 * H* for one line-direction from its departures, bucketed by boarding stop.
 *
 * Median of per-stop medians. See the module header for why the buckets are
 * never merged and why the estimator is a median rather than a mean or a span:
 * a published day has a long overnight break in it, and the mean and the span
 * estimator both absorb that break into every headway they report while the
 * median treats it as the single outlying gap it is.
 */
export function deriveOdHeadway(
  departuresByStop: ReadonlyMap<string, ReadonlySet<number>>,
): OdHeadwayOutcome {
  const perStopMedians: number[] = [];
  const contributingStops: string[] = [];
  let bestSampleCount = 0;

  for (const stopName of [...departuresByStop.keys()].sort()) {
    const departures = departuresByStop.get(stopName)!;
    if (departures.size < MIN_DEPARTURES_PER_STOP) continue;
    const gap = medianGapSeconds(departures);
    if (gap === null) continue;
    perStopMedians.push(gap);
    contributingStops.push(stopName);
    // The COLLAPSED count, not the raw one: reporting 40 departures when 12 of
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
      stopCount: perStopMedians.length,
    };
  }

  return {
    kind: 'derived',
    headway: {
      targetHeadwaySeconds: seconds,
      sampleCount: bestSampleCount,
      stopCount: perStopMedians.length,
      stopNames: contributingStops,
    },
  };
}

/**
 * Build the whole index from a normalized corpus.
 *
 * Rows arrive already filtered to those carrying a line_name, a boarding stop
 * and a parseable departure (src/ingestion/upsrtc/busBetweenStops.ts), so
 * nothing here has to re-check upstream shape.
 */
export function buildOdIndex(rows: readonly OdScheduleRow[]): OdIndex {
  const departures = new Map<string, Map<string, Set<number>>>();
  const directionsByRouteId = new Map<string, Set<string>>();
  const lines = new Set<string>();
  const routeNames = new Set<string>();
  const boardingStops = new Set<string>();
  let rowsWithoutSuffix = 0;

  for (const row of rows) {
    const { lineName, fromStopName, departureSecondsOfDay } = row;
    if (lineName === null || fromStopName === null) continue;

    const direction = directionSuffix(row.routeName) ?? UNSUFFIXED_DIRECTION;
    if (direction === UNSUFFIXED_DIRECTION) rowsWithoutSuffix += 1;

    lines.add(lineName);
    if (row.routeName !== null) routeNames.add(row.routeName);
    boardingStops.add(fromStopName);

    const key = directionKey(lineName, direction);
    let byStop = departures.get(key);
    if (!byStop) {
      byStop = new Map<string, Set<number>>();
      departures.set(key, byStop);
    }
    let times = byStop.get(fromStopName);
    if (!times) {
      times = new Set<number>();
      byStop.set(fromStopName, times);
    }
    // A Set, so the same working returned by many city-pair queries counts once.
    times.add(departureSecondsOfDay);

    let directions = directionsByRouteId.get(lineName);
    if (!directions) {
      directions = new Set<string>();
      directionsByRouteId.set(lineName, directions);
    }
    directions.add(direction);
  }

  const headwayByDirection = new Map<string, OdHeadway>();
  const implausible: RejectedOdHeadway[] = [];
  let noRepeatedDeparture = 0;

  for (const key of [...departures.keys()].sort()) {
    const outcome = deriveOdHeadway(departures.get(key)!);
    if (outcome.kind === 'derived') {
      headwayByDirection.set(key, outcome.headway);
      continue;
    }
    if (outcome.kind === 'no_repeated_departure') {
      noRepeatedDeparture += 1;
      continue;
    }
    const [routeId = key, direction = UNSUFFIXED_DIRECTION] = key.split('|');
    implausible.push({
      routeId,
      directionCode: direction,
      seconds: outcome.seconds,
      sampleCount: outcome.sampleCount,
      stopCount: outcome.stopCount,
    });
  }

  return {
    headwayByDirection,
    directionsByRouteId,
    report: {
      rowsAccepted: rows.length,
      distinctLines: lines.size,
      distinctLineDirections: departures.size,
      distinctRouteNames: routeNames.size,
      distinctBoardingStops: boardingStops.size,
      rowsWithoutDirectionSuffix: rowsWithoutSuffix,
      headwaysDerived: headwayByDirection.size,
      headwaysNoRepeatedDeparture: noRepeatedDeparture,
      headwaysImplausible: implausible,
    },
  };
}

/**
 * How a route-direction's H* was matched to the OD corpus.
 *
 *   'exact'          line_name AND the _IN/_OUT suffix both agreed with the
 *                    stored direction_code.
 *   'sole_direction' the stored direction_code is a PSEUDO-DIRECTION the OD
 *                    corpus cannot express ('SINGLE' / 'UP' — what the old
 *                    seeder invented when a route name carried no suffix), AND
 *                    the line has exactly ONE direction key in the corpus. With
 *                    one direction there is only one headway it could be, so
 *                    the match is unambiguous. With two it does NOT fire.
 *
 * This is the same two-rule scheme src/seed/timetable.ts uses, including the
 * part that matters most: a stored 'IN' or 'OUT' is matched EXACTLY OR NOT AT
 * ALL. Handing an outbound headway to the inbound direction because the corpus
 * only published one of them would be a guess, and it is exactly the class of
 * guess this whole line of work exists to delete — inbound and outbound of the
 * same line routinely run at different frequencies.
 */
export type OdMatchKind = 'exact' | 'sole_direction';

export interface OdHeadwayLookup {
  headway: OdHeadway;
  match: OdMatchKind;
}

/** Direction codes the OD corpus itself can produce. Anything else is invented. */
const OD_DIRECTION_CODES: readonly string[] = ['IN', 'OUT'];

export function lookupOdHeadway(
  index: OdIndex,
  routeId: string,
  directionCode: string,
): OdHeadwayLookup | null {
  const exact = index.headwayByDirection.get(directionKey(routeId, directionCode));
  if (exact) return { headway: exact, match: 'exact' };

  if (OD_DIRECTION_CODES.includes(directionCode)) return null;

  const directions = index.directionsByRouteId.get(routeId);
  if (!directions || directions.size !== 1) return null;
  const [only] = [...directions];
  const headway = index.headwayByDirection.get(directionKey(routeId, only!));
  return headway ? { headway, match: 'sole_direction' } : null;
}
