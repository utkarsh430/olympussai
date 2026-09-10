// Reading the seeded network for the eligibility question. SELECTs only.
//
// ─── ONE QUERY, AND WHY NOT `loadCorridorInputs` ─────────────────────────
//
// `rehearsal/corridor.ts#loadCorridorInputs` is the right reader for ONE
// corridor about to be simulated: it issues four queries and REFUSES an
// uncalibrated corridor, which is exactly correct there and exactly wrong
// here. This module's whole job is to report on the corridors that reader
// refuses - 561 of 759 on this network - so it must be able to see them.
//
// The measured/uncalibrated decision is still not re-implemented. It is the
// same exported `MEASURED_POLICY_PREDICATE` the live detection path uses,
// applied in its own lateral, so `target_headway_seconds` comes back NULL for
// precisely the corridors the controller already refuses and never as a
// sentinel. The active row's `calibration_source` is read separately and
// unfiltered, because "this corridor has a policy whose source is 'none'" is
// the thing an operator needs told.
import type { Pool } from 'pg';
import { getPool } from '../db/pool.js';
import { MEASURED_POLICY_PREDICATE } from '../headway/repository.js';
import { assessCorridorEligibility } from './eligibility.js';
import type { ControllabilityAssumptions, CorridorShape } from './eligibility.js';

export interface CorridorShapeQuery {
  /** Live-vehicle window, matching `HEADWAY_VEHICLE_FRESHNESS_SECONDS`, so the count is the one the decision cycle would see. */
  freshnessSeconds: number;
  /** Restrict to these route-directions. Omitted, every ACTIVE route-direction is reported. */
  routeDirectionIds?: readonly string[];
}

interface CorridorShapeRow {
  id: string;
  route_name: string | null;
  direction_code: string;
  /** Null exactly when no active policy row passes MEASURED_POLICY_PREDICATE. */
  measured_target_headway_seconds: string | null;
  /** The active row's own source, whatever it is. Null when there is no active row at all. */
  calibration_source: string | null;
  cumulative_distance_meters: string[] | null;
  stop_ids: string[] | null;
  vehicle_count: string;
}

/**
 * Every active route-direction as the eligibility question needs it.
 *
 * `is_active` is the one corridor filter applied: an inactive route-direction
 * is not a deployment decision, it is a route that is not running.
 */
export async function loadCorridorShapes(
  query: CorridorShapeQuery,
  pool: Pool = getPool(),
): Promise<CorridorShape[]> {
  const { rows } = await pool.query<CorridorShapeRow>(
    `select rd.id,
            r.public_name as route_name,
            rd.direction_code,
            measured.target_headway_seconds as measured_target_headway_seconds,
            active.calibration_source,
            stops.cumulative_distance_meters,
            stops.stop_ids,
            coalesce(live.vehicle_count, 0) as vehicle_count
       from route_directions rd
       left join routes r on r.id = rd.route_id
       left join lateral (
              -- Same predicate and same tie-break as loadActiveRoutePolicy, so
              -- a corridor is calibrated here exactly when it is calibrated there.
              select rp.target_headway_seconds
                from route_policies rp
               where rp.route_direction_id = rd.id
                 and rp.effective_to is null
                 and rp.${MEASURED_POLICY_PREDICATE}
               order by (rp.operating_period = 'all' and rp.day_type = 'all') desc
               limit 1
            ) measured on true
       left join lateral (
              select rp.calibration_source
                from route_policies rp
               where rp.route_direction_id = rd.id
                 and rp.effective_to is null
               order by (rp.operating_period = 'all' and rp.day_type = 'all') desc
               limit 1
            ) active on true
       left join lateral (
              select array_agg(rds.cumulative_distance_meters order by rds.sequence)
                       as cumulative_distance_meters,
                     array_agg(rds.stop_id order by rds.sequence) as stop_ids
                from route_direction_stops rds
               where rds.route_direction_id = rd.id
            ) stops on true
       left join lateral (
              -- The same liveness the decision cycle's own eligibility uses:
              -- mapped onto the route and fresher than the freshness window.
              select count(*) as vehicle_count
                from vehicle_states vs
               where vs.route_direction_id = rd.id
                 and vs.distance_along_route_meters is not null
                 and vs.observed_at > now() - ($1 || ' seconds')::interval
            ) live on true
      where rd.is_active
        and ($2::uuid[] is null or rd.id = any($2::uuid[]))
      order by rd.id`,
    [query.freshnessSeconds, query.routeDirectionIds ? [...query.routeDirectionIds] : null],
  );

  return rows.map((row) => ({
    routeDirectionId: row.id,
    routeName: row.route_name,
    directionCode: row.direction_code,
    targetHeadwaySeconds:
      row.measured_target_headway_seconds === null
        ? null
        : Number(row.measured_target_headway_seconds),
    calibrationSource: row.calibration_source,
    cumulativeDistanceMeters: (row.cumulative_distance_meters ?? []).map(Number),
    stopIds: row.stop_ids ?? [],
    vehicleCount: Number(row.vehicle_count),
  }));
}

/**
 * Of the route-directions offered, the ones inside `CONTROLLABLE_BAND`.
 *
 * The decision cycle's gate. It takes an ALREADY-eligible list - corridors the
 * sweep's own predicate has vouched for as calibrated and carrying a live pair
 * - so the only question left is the band, and the answer comes from
 * `assessCorridorEligibility` rather than from a second reading of the bounds.
 *
 * The assumptions are the caller's, and on this network they are MODELLED:
 * nothing has recorded a stop visit, so there is no fitted running-time spread
 * to decide a corridor's band on. That is the honest reason this gate ships
 * off - see `DECISION_CYCLE_ELIGIBILITY_GATE_ENABLED` in `config/env.ts`.
 */
export async function loadInBandRouteDirectionIds(
  routeDirectionIds: readonly string[],
  assumptions: ControllabilityAssumptions,
  freshnessSeconds: number,
  pool: Pool = getPool(),
): Promise<Set<string>> {
  if (routeDirectionIds.length === 0) return new Set();
  const shapes = await loadCorridorShapes({ freshnessSeconds, routeDirectionIds }, pool);
  const inBand = new Set<string>();
  for (const shape of shapes) {
    if (assessCorridorEligibility(shape, assumptions).controllability?.band === 'controllable') {
      inBand.add(shape.routeDirectionId);
    }
  }
  return inBand;
}

/**
 * How many recommendations each route-direction has received, so the gate's
 * exclusion can be reported as a share of what the controller actually DOES
 * rather than only as a share of corridors.
 *
 * A corridor count overstates a gate's effect and a recommendation count
 * understates it, and neither alone is the answer: the corridors a gate
 * excludes are disproportionately the quiet ones, so 60% of corridors can be a
 * far smaller share of the advice an operator ever sees.
 */
export async function loadRecommendationVolume(
  lookbackHours: number,
  pool: Pool = getPool(),
): Promise<Map<string, number>> {
  const { rows } = await pool.query<{ route_direction_id: string; count: string }>(
    `select route_direction_id, count(*) as count
       from recommendations
      where created_at > now() - ($1 || ' hours')::interval
      group by route_direction_id`,
    [lookbackHours],
  );
  return new Map(rows.map((row) => [row.route_direction_id, Number(row.count)]));
}
