// Postgres reads for arrival prediction.
//
// Thin plain functions each taking an optional `pool`, matching the convention
// in src/headway/repository.ts and src/db/commands.ts rather than inventing a
// third shape for the same job.
//
// READS GO TO POSTGRES, NOT TO state/store.ts, for the same reason
// headway/repository.ts does: that in-memory store is populated at boot and by
// the ingestion path, and it does not carry `kf_state`, `stop_state_entered_at`
// or the route-direction stop list at all. Prediction needs the filter
// covariance to size its uncertainty band and the dwell entry time to know how
// much dwell is left, so it reads the table that has them.
//
// NOTHING HERE READS `trips` OR `trip_stop_times`. That is deliberate and
// structural, not an oversight: those are the published-timetable tables, they
// are empty on this deployment (0 rows, measured 2026-08-14), and a query
// against them is the one line that could turn this service from a predictor
// into a schedule-repeater. Its absence is the enforcement.
import type { Pool } from 'pg';
import { getPool } from '../db/pool.js';
import { LOW_CONFIDENCE_THRESHOLD } from '../state-estimation/confidence.js';
import type {
  Covariance2x2,
  KalmanState,
} from '../state-estimation/types.js';
import type {
  PeerVehicleSpeed,
  PredictionRouteGeometry,
  PredictionStop,
  VehicleStateForPrediction,
} from './types.js';

interface VehicleStateRow {
  vehicle_id: string;
  route_direction_id: string | null;
  distance_along_route_meters: string | null;
  speed_kmph: string | null;
  stop_state: string;
  current_stop_id: string | null;
  stop_state_entered_at: string | null;
  confidence: string | null;
  is_low_confidence: boolean;
  observed_at: string;
  lat: string | null;
  lon: string | null;
  kf_state: KalmanState | null;
}

export async function loadVehicleStateForPrediction(
  vehicleId: string,
  pool: Pool = getPool(),
): Promise<VehicleStateForPrediction | null> {
  const { rows } = await pool.query<VehicleStateRow>(
    `select vehicle_id, route_direction_id, distance_along_route_meters, speed_kmph,
            stop_state, current_stop_id, stop_state_entered_at, confidence,
            is_low_confidence, observed_at, kf_state,
            ST_Y(position::geometry) as lat, ST_X(position::geometry) as lon
       from vehicle_states
      where vehicle_id = $1`,
    [vehicleId],
  );
  const row = rows[0];
  if (!row) return null;

  const lat = numberOrNull(row.lat);
  const lon = numberOrNull(row.lon);

  return {
    vehicleId: row.vehicle_id,
    routeDirectionId: row.route_direction_id,
    distanceAlongRouteMeters: numberOrNull(row.distance_along_route_meters),
    speedKmph: numberOrNull(row.speed_kmph),
    stopState: row.stop_state,
    currentStopId: row.current_stop_id,
    stopEnteredAt: toIsoOrNull(row.stop_state_entered_at),
    confidence: numberOrNull(row.confidence),
    isLowConfidence: row.is_low_confidence,
    observedAt: toIso(row.observed_at),
    position: lat === null || lon === null ? null : { lat, lon },
    velocityVarianceMeters2PerSecond2: velocityVariance(row.kf_state),
  };
}

export async function vehicleExists(vehicleId: string, pool: Pool = getPool()): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `select exists(select 1 from vehicles where id = $1) as exists`,
    [vehicleId],
  );
  return rows[0]?.exists ?? false;
}

export async function loadRouteGeometry(
  routeDirectionId: string,
  pool: Pool = getPool(),
): Promise<PredictionRouteGeometry | null> {
  const { rows } = await pool.query<{
    route_direction_id: string;
    is_loop: boolean;
    total_distance_meters: string;
  }>(
    `select rd.id as route_direction_id, rd.is_loop, rs.total_distance_meters
       from route_directions rd
       join route_shapes rs on rs.route_direction_id = rd.id
      where rd.id = $1 and rd.is_active = true`,
    [routeDirectionId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    routeDirectionId: row.route_direction_id,
    isLoop: row.is_loop,
    totalDistanceMeters: Number(row.total_distance_meters),
  };
}

export async function loadRouteDirectionStops(
  routeDirectionId: string,
  pool: Pool = getPool(),
): Promise<PredictionStop[]> {
  const { rows } = await pool.query<{
    stop_id: string;
    stop_name: string;
    sequence: number;
    cumulative_distance_meters: string;
    is_control_point: boolean;
  }>(
    `select rds.stop_id, s.name as stop_name, rds.sequence,
            rds.cumulative_distance_meters, rds.is_control_point
       from route_direction_stops rds
       join stops s on s.id = rds.stop_id
      where rds.route_direction_id = $1
      order by rds.sequence`,
    [routeDirectionId],
  );
  return rows.map((row) => ({
    stopId: row.stop_id,
    stopName: row.stop_name,
    sequence: row.sequence,
    cumulativeDistanceMeters: Number(row.cumulative_distance_meters),
    isControlPoint: row.is_control_point,
  }));
}

/**
 * Vehicles that could serve as a speed measurement for this route-direction.
 *
 * Filtered HERE to fresh and confidently-matched, so a stale or flagged vehicle
 * can never contribute to another vehicle's speed. The along-route window and
 * the plausible-running-speed band are applied in speed.ts instead, because
 * those two are the model's own judgement and belong where they are documented
 * and unit-tested - not spread across a SQL predicate as well.
 */
export async function loadPeerSpeeds(
  routeDirectionId: string,
  maxAgeSeconds: number,
  pool: Pool = getPool(),
): Promise<PeerVehicleSpeed[]> {
  const { rows } = await pool.query<{
    vehicle_id: string;
    distance_along_route_meters: string;
    speed_kmph: string;
  }>(
    `select vehicle_id, distance_along_route_meters, speed_kmph
       from vehicle_states
      where route_direction_id = $1
        and distance_along_route_meters is not null
        and speed_kmph is not null
        and is_low_confidence = false
        and confidence >= $3
        -- Two-sided, exactly as the prediction core is two-sided: a row stamped
        -- in the future has a negative age and would sail through a one-sided
        -- "recent enough" test forever. The live table has carried
        -- observed_at = 2046-03-27.
        and observed_at <= now()
        and observed_at >= now() - make_interval(secs => $2::double precision)`,
    [routeDirectionId, maxAgeSeconds, LOW_CONFIDENCE_THRESHOLD],
  );
  return rows.map((row) => ({
    vehicleId: row.vehicle_id,
    distanceAlongRouteMeters: Number(row.distance_along_route_meters),
    speedKmph: Number(row.speed_kmph),
  }));
}

const HOLD_ACTION_TYPES = ['terminal_dispatch_hold', 'two_way_hold', 'self_equalizing_hold'] as const;
const HOLD_ACTIVE_STATUSES = ['delivered', 'acknowledged', 'executing'] as const;

/**
 * Whether a controller hold is in force right now.
 *
 * Same predicate as PgStateEstimationRepository.loadActiveHold, deliberately:
 * if the two ever disagreed, a bus could be shown a countdown by one subsystem
 * while the other one knew it was being held.
 */
export async function loadActiveHold(vehicleId: string, pool: Pool = getPool()): Promise<boolean> {
  const { rows } = await pool.query<{ held: boolean }>(
    `select exists(
        select 1 from commands
         where vehicle_id = $1
           and action_type = any($2::text[])
           and status = any($3::text[])
           and now() < expires_at
      ) as held`,
    [vehicleId, HOLD_ACTION_TYPES, HOLD_ACTIVE_STATUSES],
  );
  return rows[0]?.held ?? false;
}

/**
 * Velocity variance from the persisted Kalman covariance, or null.
 *
 * Defensive about the shape because `kf_state` is jsonb: it is whatever was
 * written, not whatever the type says. A malformed value must degrade to "no
 * covariance information" (which widens the band to the documented default),
 * never to a NaN that silently poisons every bound computed from it.
 */
function velocityVariance(kfState: KalmanState | null): number | null {
  if (kfState === null || typeof kfState !== 'object') return null;
  const p = (kfState as { p?: Covariance2x2 }).p;
  if (!Array.isArray(p) || p.length !== 2) return null;
  const row = p[1];
  if (!Array.isArray(row) || row.length !== 2) return null;
  const variance = row[1];
  if (typeof variance !== 'number' || !Number.isFinite(variance) || variance < 0) return null;
  return variance;
}

function numberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `pg` hands back a JS Date for timestamptz. Normalised to ISO-8601 here so the
 * prediction core only ever parses one format, and an unparseable value survives
 * as a string for the core's `unreadable_observation_time` branch to name rather
 * than being swallowed into a null that would read as "no state at all".
 */
function toIso(value: string | Date): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'invalid-date' : value.toISOString();
  return value;
}

function toIsoOrNull(value: string | Date | null): string | null {
  return value === null ? null : toIso(value);
}
