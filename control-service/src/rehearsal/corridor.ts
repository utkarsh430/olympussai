// Turning a real seeded route-direction into simulator inputs.
//
// ─── THE REFUSAL IS THE POINT OF THIS FILE ───────────────────────────────
//
// Most seeded route-directions carry no measured target headway: 'none' with
// a sentinel of 1 second where neither published source could answer, and
// 'default' where no evidence was found and a number was written anyway.
// Every threshold in `src/headway/` is a ratio of the target headway, so a
// rehearsal run on either kind would produce a full set of confident-looking
// numbers computed against a denominator that is not a measurement. That is
// the exact fabrication the seeder refuses to commit, and it is refused here
// too.
//
// The refusal is not re-implemented. `loadActiveRoutePolicy` from
// `../headway/repository.js` is the reader the live detection path uses, and
// its MEASURED_POLICY_PREDICATE is what makes an uncalibrated corridor
// indistinguishable from one with no policy at all. Asking it first and
// stopping when it answers null means the rehearsal surface and the live
// detector can never disagree about which corridors are calibrated - they are
// reading through the same function, against the same exported predicate.
//
// The remaining policy columns (the controller gains, the hold cap, the
// occupancy policy) are then loaded for the SAME row. They are not part of
// the calibration question, and no fallback is substituted for any of them:
// a corridor whose `self_equalizing_k` and `kf`/`kb` are all null generates
// no candidates at all, and the rehearsal says so rather than picking a gain.
import type { Pool } from 'pg';
import { getPool } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import { loadActiveRoutePolicy, MEASURED_POLICY_PREDICATE } from '../headway/repository.js';
import type { RoutePolicyRow } from '../state/store.js';
import type { StopDefinition } from '../simulation/types.js';

/** A stop as the rehearsal needs it: sequencing, control-point config, and a real position to draw. */
export interface CorridorStop {
  stopId: string;
  name: string;
  sequence: number;
  cumulativeDistanceMeters: number;
  isControlPoint: boolean;
  /** `route_direction_stops.max_hold_seconds`, which overrides the policy cap at this specific point. Null when unset. */
  maxHoldSeconds: number | null;
  latitude: number;
  longitude: number;
}

export interface CorridorInputs {
  routeDirectionId: string;
  routeId: string;
  routeName: string | null;
  directionCode: string;
  isLoop: boolean;
  totalDistanceMeters: number;
  /** Where the target headway came from: 'timetable' or 'od_timetable'. Never 'none' - such a corridor never reaches here. */
  calibrationSource: string;
  policy: RoutePolicyRow;
  stops: CorridorStop[];
  /** Full route-shape polyline, for drawing the corridor the simulation runs on. */
  shape: { latitude: number; longitude: number }[];
}

/** Raised when the corridor has no measured target headway. Carries the 404 the live headway path already raises for the same condition. */
export function uncalibratedCorridorError(routeDirectionId: string): AppError {
  return new AppError(
    'no_active_policy',
    `Route-direction ${routeDirectionId} has no measured target headway, so no simulation can be run on it. ` +
      'Every bunching threshold is a ratio of that target; without it there is nothing to simulate against.',
    404,
  );
}

export async function loadCorridorInputs(
  routeDirectionId: string,
  pool: Pool = getPool(),
): Promise<CorridorInputs> {
  // Step 1, and the only one that decides whether this corridor may be
  // simulated at all. Same reader, same predicate, same answer as detection.
  const calibrated = await loadActiveRoutePolicy(routeDirectionId, pool);
  if (!calibrated) throw uncalibratedCorridorError(routeDirectionId);

  const policyResult = await pool.query<{
    id: string;
    route_direction_id: string;
    operating_period: string;
    day_type: string;
    target_headway_seconds: string;
    bunched_threshold_ratio: string;
    warning_threshold_ratio: string;
    kf: string | null;
    kb: string | null;
    self_equalizing_k: string | null;
    max_hold_seconds: number;
    cooldown_seconds: number;
    prediction_horizon_control_points: number;
    occupancy_stale_seconds: number | null;
    occupancy_capacity: number | null;
    calibration_source: string;
  }>(
    // Same predicate and same tie-break as loadActiveRoutePolicy, so this
    // selects the row that reader just vouched for rather than a sibling.
    `select id, route_direction_id, operating_period, day_type,
            target_headway_seconds, bunched_threshold_ratio, warning_threshold_ratio,
            kf, kb, self_equalizing_k, max_hold_seconds, cooldown_seconds,
            prediction_horizon_control_points, occupancy_stale_seconds, occupancy_capacity,
            calibration_source
       from route_policies
      where route_direction_id = $1 and effective_to is null
        and ${MEASURED_POLICY_PREDICATE}
      order by (operating_period = 'all' and day_type = 'all') desc
      limit 1`,
    [routeDirectionId],
  );
  const policyRow = policyResult.rows[0];
  if (!policyRow) throw uncalibratedCorridorError(routeDirectionId);

  const policy: RoutePolicyRow = {
    id: policyRow.id,
    routeDirectionId: policyRow.route_direction_id,
    operatingPeriod: policyRow.operating_period,
    dayType: policyRow.day_type,
    targetHeadwaySeconds: Number(policyRow.target_headway_seconds),
    bunchedThresholdRatio: Number(policyRow.bunched_threshold_ratio),
    warningThresholdRatio: Number(policyRow.warning_threshold_ratio),
    kf: policyRow.kf === null ? null : Number(policyRow.kf),
    kb: policyRow.kb === null ? null : Number(policyRow.kb),
    selfEqualizingK: policyRow.self_equalizing_k === null ? null : Number(policyRow.self_equalizing_k),
    maxHoldSeconds: policyRow.max_hold_seconds,
    cooldownSeconds: policyRow.cooldown_seconds,
    minimumActionSeconds: 0,
    predictionHorizonControlPoints: policyRow.prediction_horizon_control_points,
    occupancyStaleSeconds: policyRow.occupancy_stale_seconds,
    occupancyCapacity: policyRow.occupancy_capacity,
    ks: null,
    maxLatenessSeconds: null,
    speedBandMinKmph: null,
    speedBandMaxKmph: null,
  };

  const directionResult = await pool.query<{
    route_id: string;
    route_name: string | null;
    direction_code: string;
    is_loop: boolean;
    total_distance_meters: string;
  }>(
    `select rd.route_id, r.public_name as route_name, rd.direction_code, rd.is_loop,
            rs.total_distance_meters
       from route_directions rd
       join route_shapes rs on rs.route_direction_id = rd.id
       left join routes r on r.id = rd.route_id
      where rd.id = $1 and rd.is_active = true`,
    [routeDirectionId],
  );
  const direction = directionResult.rows[0];
  if (!direction) {
    throw new AppError('route_direction_not_found', `No active route-direction ${routeDirectionId} with a shape`, 404);
  }

  const stopsResult = await pool.query<{
    stop_id: string;
    name: string;
    sequence: number;
    cumulative_distance_meters: string;
    is_control_point: boolean;
    max_hold_seconds: number | null;
    latitude: number | string;
    longitude: number | string;
  }>(
    // ::geometry before ST_X/ST_Y: those accessors are not defined on
    // geography (same note as db/rehydrate.ts).
    `select rds.stop_id, s.name, rds.sequence, rds.cumulative_distance_meters,
            rds.is_control_point, rds.max_hold_seconds,
            ST_Y(s.geom::geometry) as latitude, ST_X(s.geom::geometry) as longitude
       from route_direction_stops rds
       join stops s on s.id = rds.stop_id
      where rds.route_direction_id = $1
      order by rds.sequence`,
    [routeDirectionId],
  );

  const stops: CorridorStop[] = stopsResult.rows.map((row) => ({
    stopId: row.stop_id,
    name: row.name,
    sequence: row.sequence,
    cumulativeDistanceMeters: Number(row.cumulative_distance_meters),
    isControlPoint: row.is_control_point,
    maxHoldSeconds: row.max_hold_seconds,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
  }));

  if (stops.length < 2) {
    throw new AppError(
      'corridor_too_short',
      `Route-direction ${routeDirectionId} has ${stops.length} mapped stop(s); a headway simulation needs at least two.`,
      422,
    );
  }

  const shapeResult = await pool.query<{ points: string }>(
    `select ST_AsGeoJSON(geom::geometry) as points from route_shapes where route_direction_id = $1`,
    [routeDirectionId],
  );
  const shape = parseLineString(shapeResult.rows[0]?.points);

  return {
    routeDirectionId,
    routeId: direction.route_id,
    routeName: direction.route_name,
    directionCode: direction.direction_code,
    isLoop: direction.is_loop,
    totalDistanceMeters: Number(direction.total_distance_meters),
    calibrationSource: policyRow.calibration_source,
    policy,
    stops,
    shape,
  };
}

/**
 * GeoJSON LineString -> lat/lon vertices.
 *
 * Returns an empty array rather than throwing on anything unexpected: a
 * corridor whose polyline cannot be read is still a corridor whose stops,
 * policy and simulation are perfectly valid, and the surface draws the stop
 * chain instead. Losing the drawn shape is a degraded picture; refusing the
 * run over it would be a worse answer to a smaller problem.
 */
function parseLineString(geoJson: string | undefined): { latitude: number; longitude: number }[] {
  if (!geoJson) return [];
  try {
    const parsed: unknown = JSON.parse(geoJson);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { type?: unknown }).type !== 'LineString' ||
      !Array.isArray((parsed as { coordinates?: unknown }).coordinates)
    ) {
      return [];
    }
    const coordinates = (parsed as { coordinates: unknown[] }).coordinates;
    const points: { latitude: number; longitude: number }[] = [];
    for (const entry of coordinates) {
      if (!Array.isArray(entry)) continue;
      const [lon, lat] = entry as unknown[];
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      points.push({ latitude: lat, longitude: lon });
    }
    return points;
  } catch {
    return [];
  }
}

/**
 * Which stops the control laws may act at.
 *
 * `route_direction_stops.is_control_point` is configuration and the seeder
 * sets it; when a corridor has none, the rehearsal says so and runs with no
 * control point rather than promoting stops on its own. A simulator that
 * invented control points would be rehearsing a corridor configuration that
 * does not exist.
 */
export function toStopDefinitions(
  stops: readonly CorridorStop[],
  demandModel: (stop: CorridorStop, index: number) => StopDefinition['demand'],
): StopDefinition[] {
  return stops.map((stop, index) => ({
    stopId: stop.stopId,
    sequence: stop.sequence,
    isControlPoint: stop.isControlPoint,
    cumulativeDistanceMeters: stop.cumulativeDistanceMeters,
    demand: demandModel(stop, index),
  }));
}
