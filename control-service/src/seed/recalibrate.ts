// Apply the PUBLISHED schedules' H* to the route-directions ALREADY in the
// database, without re-harvesting geometry.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A SEPARATE PASS AND NOT JUST "RE-RUN THE SEEDER"
// ---------------------------------------------------------------------------
// The full harvest rebuilds the network from the live feed: planProbes reads a
// `routename` off each live vehicle to decide which vehicle to ask
// getScheduledBusInfo about. MEASURED 2026-08-10 against the production feed:
// of 9,155 live records, ZERO carried `routename`, `route`, `route_description`
// or `scheduled_start_time` — the feed was publishing GPS telemetry and depot
// only. planProbes therefore returns an empty probe list, a full harvest
// produces an empty network, and 'fleet_span' is not merely weak but
// structurally unavailable.
//
// That is the root problem stated precisely: the seeder derives the network
// from whichever buses happen to be running, so when the feed drops its route
// fields the whole network becomes underivable — while 666 route-directions
// with perfectly good geometry sit in the database carrying a fabricated or
// absent H*. Geometry does not go stale on the timescale a headway does.
// Recalibration is the operation that matches the thing being fixed: H* and its
// provenance, nothing else.
//
// It writes through the SAME versioned upsert the full seeder uses
// (src/seed/persist.ts#upsertRoutePolicy), so a recalibrated policy is closed
// and re-inserted exactly like any other change and appears in the history.
// Gains are inherited rather than re-stamped — see UpsertPolicyOptions.
//
// ---------------------------------------------------------------------------
// TWO PUBLISHED SOURCES, ONE STRICT PRECEDENCE
// ---------------------------------------------------------------------------
//
//     'timetable'  >  'od_timetable'  >  'none'
//
// 'timetable' is getStaticData.php, a departure board at a stop — successive
// departures of one line-direction at one point, which is what headway IS. It
// is also scoped to 22 stops on the Lucknow -> Raebareli -> Prayagraj corridor
// and cannot be widened, so it answers for 74 of 666 route-directions.
//
// 'od_timetable' is getBusBetweenStops.php, the statewide origin-destination
// schedule: published trips between city pairs, swept over the ordered pairs of
// the 16 published cities. Real published departures, coarser view, statewide
// reach.
//
// THE ORDER IS ENFORCED IN ONE PLACE — resolveHeadway below — and the property
// it guarantees is that a route-direction holding 'timetable' is never
// downgraded, whatever the OD corpus would have said about it. That matters
// because the two sources genuinely disagree sometimes, and disagreement is not
// symmetric: replacing a point measurement with a coarser one loses
// information and would silently move detection thresholds on the only routes
// currently under detection at all.
//
// Everything either source cannot answer for stays 'none' with the sentinel.
// There is still no fabrication branch, and adding a source did not add one.

import type { Pool } from 'pg';
import {
  DEFAULT_GAINS,
  UNCALIBRATED_HEADWAY_SENTINEL_SECONDS,
  type HeadwayCalibrationSource,
  type SeedRoutePolicy,
} from './harvest.js';
import { lookupOdHeadway, type OdIndex, type OdMatchKind } from './odTimetable.js';
import { upsertRoutePolicy, withTransaction } from './persist.js';
import { lookupTimetableHeadway, type TimetableIndex, type TimetableMatchKind } from './timetable.js';

export interface RecalibrateOptions {
  /** Roll every transaction back instead of committing. Every statement still runs. */
  dryRun?: boolean;
  /** Used only where the existing policy row has null gains. */
  gains?: { kf: number; kb: number; selfEqualizingK: number };
}

/** The calibration sources this pass can write. Precedence order. */
export type RecalibrationSource = Extract<
  HeadwayCalibrationSource,
  'timetable' | 'od_timetable' | 'none'
>;

export interface RecalibratedDirection {
  routeDirectionId: string;
  routeId: string;
  directionCode: string;
  previousTargetHeadwaySeconds: number | null;
  previousCalibrationSource: string | null;
  targetHeadwaySeconds: number;
  calibrationSource: HeadwayCalibrationSource;
  match: TimetableMatchKind | OdMatchKind | null;
  sampleCount: number | null;
  /**
   * Observation points behind the number: stop AREAS for 'timetable', BOARDING
   * STOPS for 'od_timetable'. One field because the audit question is the same
   * either way — how many independent places saw this line.
   */
  stopAreaCount: number | null;
}

export interface RecalibrateFailure {
  routeDirectionId: string;
  routeId: string;
  directionCode: string;
  error: string;
}

export interface RecalibrateResult {
  routeDirectionsConsidered: number;
  calibrated: number;
  uncalibrated: number;
  /** Calibrated from the corridor departure board. Highest precedence. */
  calibratedFromTimetable: number;
  /** Calibrated from the statewide OD schedule, i.e. the timetable was silent. */
  calibratedFromOd: number;
  matchesExact: number;
  matchesSoleDirection: number;
  policiesInserted: number;
  policiesUnchanged: number;
  /** Every direction whose H* actually moved. The audit trail for the run. */
  changed: RecalibratedDirection[];
  failures: RecalibrateFailure[];
}

interface RouteDirectionRow {
  id: string;
  route_id: string;
  direction_code: string;
}

/**
 * Every ACTIVE route-direction, ordered so a re-run visits them identically.
 *
 * Inactive directions are skipped: they are not served, so a target headway for
 * them would be a statement about nothing.
 */
export async function loadActiveRouteDirections(pool: Pool): Promise<RouteDirectionRow[]> {
  const { rows } = await pool.query<RouteDirectionRow>(
    `select id, route_id, direction_code
       from route_directions
      where is_active = true
      order by route_id, direction_code`,
  );
  return rows;
}

export interface ResolvedHeadway {
  targetHeadwaySeconds: number;
  source: RecalibrationSource;
  match: TimetableMatchKind | OdMatchKind | null;
  sampleCount: number | null;
  stopAreaCount: number | null;
}

/**
 * The precedence rule, in one function so there is one place to read it and one
 * place to test it.
 *
 * The corridor timetable is asked first. If it answers, the OD index is NOT
 * consulted — not compared against, not averaged with, not used as a
 * tie-breaker. There is no code path from a timetable hit to an 'od_timetable'
 * result, which is what makes "a 'timetable' row is never downgraded" a
 * structural property rather than a convention.
 *
 * Either index may be null: a run can have one source, the other, or both.
 */
export function resolveHeadway(
  routeId: string,
  directionCode: string,
  timetable: TimetableIndex | null,
  od: OdIndex | null,
): ResolvedHeadway {
  if (timetable) {
    const found = lookupTimetableHeadway(timetable, routeId, directionCode);
    if (found) {
      return {
        targetHeadwaySeconds: found.headway.targetHeadwaySeconds,
        source: 'timetable',
        match: found.match,
        sampleCount: found.headway.sampleCount,
        stopAreaCount: found.headway.stopAreaCount,
      };
    }
  }

  if (od) {
    const found = lookupOdHeadway(od, routeId, directionCode);
    if (found) {
      return {
        targetHeadwaySeconds: found.headway.targetHeadwaySeconds,
        source: 'od_timetable',
        match: found.match,
        sampleCount: found.headway.sampleCount,
        stopAreaCount: found.headway.stopCount,
      };
    }
  }

  // The third outcome, and there is no fourth. A route-direction no published
  // source can answer for gets no number, because inventing one here is the
  // exact defect this whole line of work removes.
  return {
    targetHeadwaySeconds: UNCALIBRATED_HEADWAY_SENTINEL_SECONDS,
    source: 'none',
    match: null,
    sampleCount: null,
    stopAreaCount: null,
  };
}

/**
 * Recalibrate every active route-direction against the published sources.
 *
 * ONE TRANSACTION PER ROUTE-DIRECTION, matching persistNetworkSeed: a failure
 * costs exactly that direction, is reported, and the run continues.
 */
export async function recalibrateHeadways(
  pool: Pool,
  timetable: TimetableIndex | null,
  od: OdIndex | null = null,
  options: RecalibrateOptions = {},
): Promise<RecalibrateResult> {
  const gains = options.gains ?? { ...DEFAULT_GAINS };
  const dryRun = options.dryRun ?? false;

  const directions = await loadActiveRouteDirections(pool);
  const result: RecalibrateResult = {
    routeDirectionsConsidered: directions.length,
    calibrated: 0,
    uncalibrated: 0,
    calibratedFromTimetable: 0,
    calibratedFromOd: 0,
    matchesExact: 0,
    matchesSoleDirection: 0,
    policiesInserted: 0,
    policiesUnchanged: 0,
    changed: [],
    failures: [],
  };

  for (const row of directions) {
    const resolved = resolveHeadway(row.route_id, row.direction_code, timetable, od);

    const policy: SeedRoutePolicy = {
      targetHeadwaySeconds: resolved.targetHeadwaySeconds,
      calibrationSource: resolved.source,
      ...gains,
    };

    if (resolved.source === 'none') {
      result.uncalibrated += 1;
    } else {
      result.calibrated += 1;
      if (resolved.source === 'timetable') {
        result.calibratedFromTimetable += 1;
      } else {
        result.calibratedFromOd += 1;
      }
      if (resolved.match === 'exact') result.matchesExact += 1;
      else result.matchesSoleDirection += 1;
    }

    try {
      const outcome = await withTransaction(pool, dryRun, (client) =>
        upsertRoutePolicy(client, row.id, policy, { inheritGains: true }),
      );

      if (outcome.inserted) result.policiesInserted += 1;
      else result.policiesUnchanged += 1;

      if (outcome.inserted) {
        result.changed.push({
          routeDirectionId: row.id,
          routeId: row.route_id,
          directionCode: row.direction_code,
          previousTargetHeadwaySeconds: outcome.previous?.targetHeadwaySeconds ?? null,
          previousCalibrationSource: outcome.previous?.calibrationSource ?? null,
          targetHeadwaySeconds: policy.targetHeadwaySeconds,
          calibrationSource: policy.calibrationSource,
          match: resolved.match,
          sampleCount: resolved.sampleCount,
          stopAreaCount: resolved.stopAreaCount,
        });
      }
    } catch (error) {
      result.failures.push({
        routeDirectionId: row.id,
        routeId: row.route_id,
        directionCode: row.direction_code,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * The headline numbers a run should shout about, derived from a result.
 *
 * `fabricatedCleared` counts route-directions that were carrying a number
 * nobody measured and now carry either a measured one or an explicit "none".
 * That is the figure the previous change existed to move.
 *
 * `timetableDowngraded` counts the thing that must always be ZERO: a
 * route-direction that held 'timetable' and now holds something weaker. It is
 * computed from the run's own audit trail rather than trusted, because
 * "precedence is implemented correctly" is exactly the kind of claim that
 * should be checkable from a report after the fact.
 */
export function summarizeRecalibration(result: RecalibrateResult): {
  calibratedPct: string;
  fabricatedCleared: number;
  replacedByMeasurement: number;
  timetableDowngraded: number;
} {
  const total = result.routeDirectionsConsidered;
  const fabricatedCleared = result.changed.filter(
    (entry) => entry.previousCalibrationSource === 'default',
  ).length;
  const replacedByMeasurement = result.changed.filter(
    (entry) =>
      entry.calibrationSource === 'timetable' || entry.calibrationSource === 'od_timetable',
  ).length;
  const timetableDowngraded = result.changed.filter(
    (entry) =>
      entry.previousCalibrationSource === 'timetable' && entry.calibrationSource !== 'timetable',
  ).length;
  return {
    calibratedPct: total === 0 ? '0.0%' : `${((result.calibrated / total) * 100).toFixed(1)}%`,
    fabricatedCleared,
    replacedByMeasurement,
    timetableDowngraded,
  };
}
