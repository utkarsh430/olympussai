// Apply the published timetable's H* to the route-directions ALREADY in the
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
// fields the whole network becomes underivable — while 656 route-directions
// with perfectly good geometry sit in the database carrying a fabricated H*.
// Geometry does not go stale on the timescale a headway does. Recalibration is
// the operation that matches the thing being fixed: H* and its provenance,
// nothing else.
//
// It writes through the SAME versioned upsert the full seeder uses
// (src/seed/persist.ts#upsertRoutePolicy), so a recalibrated policy is closed
// and re-inserted exactly like any other change and appears in the history.
// Gains are inherited rather than re-stamped — see UpsertPolicyOptions.

import type { Pool } from 'pg';
import {
  DEFAULT_GAINS,
  UNCALIBRATED_HEADWAY_SENTINEL_SECONDS,
  type HeadwayCalibrationSource,
  type SeedRoutePolicy,
} from './harvest.js';
import { upsertRoutePolicy, withTransaction } from './persist.js';
import { lookupTimetableHeadway, type TimetableIndex, type TimetableMatchKind } from './timetable.js';

export interface RecalibrateOptions {
  /** Roll every transaction back instead of committing. Every statement still runs. */
  dryRun?: boolean;
  /** Used only where the existing policy row has null gains. */
  gains?: { kf: number; kb: number; selfEqualizingK: number };
}

export interface RecalibratedDirection {
  routeDirectionId: string;
  routeId: string;
  directionCode: string;
  previousTargetHeadwaySeconds: number | null;
  previousCalibrationSource: string | null;
  targetHeadwaySeconds: number;
  calibrationSource: HeadwayCalibrationSource;
  match: TimetableMatchKind | null;
  sampleCount: number | null;
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

/**
 * Recalibrate every active route-direction against the timetable.
 *
 * ONE TRANSACTION PER ROUTE-DIRECTION, matching persistNetworkSeed: a failure
 * costs exactly that direction, is reported, and the run continues.
 */
export async function recalibrateHeadways(
  pool: Pool,
  index: TimetableIndex,
  options: RecalibrateOptions = {},
): Promise<RecalibrateResult> {
  const gains = options.gains ?? { ...DEFAULT_GAINS };
  const dryRun = options.dryRun ?? false;

  const directions = await loadActiveRouteDirections(pool);
  const result: RecalibrateResult = {
    routeDirectionsConsidered: directions.length,
    calibrated: 0,
    uncalibrated: 0,
    matchesExact: 0,
    matchesSoleDirection: 0,
    policiesInserted: 0,
    policiesUnchanged: 0,
    changed: [],
    failures: [],
  };

  for (const row of directions) {
    const found = lookupTimetableHeadway(index, row.route_id, row.direction_code);

    // The ONLY two outcomes. There is no fallback branch on purpose: a
    // route-direction the timetable cannot answer for gets no number, because
    // inventing one here is the exact defect being removed.
    const policy: SeedRoutePolicy = {
      targetHeadwaySeconds: found
        ? found.headway.targetHeadwaySeconds
        : UNCALIBRATED_HEADWAY_SENTINEL_SECONDS,
      calibrationSource: found ? 'timetable' : 'none',
      ...gains,
    };

    if (found) {
      result.calibrated += 1;
      if (found.match === 'exact') result.matchesExact += 1;
      else result.matchesSoleDirection += 1;
    } else {
      result.uncalibrated += 1;
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
          match: found?.match ?? null,
          sampleCount: found?.headway.sampleCount ?? null,
          stopAreaCount: found?.headway.stopAreaCount ?? null,
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
 * That is the figure this whole change exists to move.
 */
export function summarizeRecalibration(result: RecalibrateResult): {
  calibratedPct: string;
  fabricatedCleared: number;
  replacedByMeasurement: number;
} {
  const total = result.routeDirectionsConsidered;
  const fabricatedCleared = result.changed.filter(
    (entry) => entry.previousCalibrationSource === 'default',
  ).length;
  const replacedByMeasurement = result.changed.filter(
    (entry) => entry.calibrationSource === 'timetable',
  ).length;
  return {
    calibratedPct: total === 0 ? '0.0%' : `${((result.calibrated / total) * 100).toFixed(1)}%`,
    fabricatedCleared,
    replacedByMeasurement,
  };
}
