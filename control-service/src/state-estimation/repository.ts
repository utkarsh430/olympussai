// Postgres-backed persistence for the state estimator, against the schema
// in control-service/db/migrations/20260805190000__core_data_model.sql and
// 20260805200000__state_estimation.sql.
//
// Depends only on a minimal `Queryable` shape (the subset of pg.Pool /
// pg.PoolClient used here), not on the `pg` package's concrete types, so
// tests can supply an in-memory fake (see ./testing/inMemoryRepository.ts)
// without a live database. The real service wires a `pg.Pool` from
// ../db/pool.ts, which satisfies this interface as-is.

import { logger } from "../lib/logger.js";
import type {
  KalmanState,
  LatLng,
  PriorVehicleState,
  RouteDirectionShape,
  RouteDirectionStopPoint,
  VehicleStateEstimate,
} from "./types.js";

export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[]
  ): Promise<{ rows: T[] }>;
}

export interface StateEstimationRepository {
  loadActiveRouteDirectionShapes(): Promise<RouteDirectionShape[]>;
  loadRouteDirectionStops(
    routeDirectionIds: readonly string[]
  ): Promise<Map<string, RouteDirectionStopPoint[]>>;
  loadPriorVehicleState(vehicleId: string): Promise<PriorVehicleState | null>;
  loadActiveHold(vehicleId: string): Promise<boolean>;
  resolveCurrentTrip(vehicleId: string, routeDirectionId: string, now: Date): Promise<string | null>;
  /**
   * Persists the estimate. Resolves `false` when the write was suppressed
   * by the out-of-order guard (an already-persisted fix is newer), so the
   * caller can skip mirroring a state the table deliberately did not take.
   */
  saveVehicleState(estimate: VehicleStateEstimate): Promise<boolean>;
  /** Loads every vehicle's persisted prior state - used once at startup to rebuild the in-memory cache. */
  rehydrateAll(): Promise<Map<string, PriorVehicleState>>;
  /**
   * Optional spatial prefilter: only the shapes plausibly within
   * `radiusMeters` of `point`. Optional so an implementation without a
   * spatial index (the in-memory test repository) stays valid and callers
   * simply fall back to loadActiveRouteDirectionShapes().
   *
   * Implementations MUST return a superset of every shape within
   * `radiusMeters` - returning fewer would silently change a map-match
   * decision, which is exactly what the prefilter must never do.
   */
  loadCandidateShapesNear?(point: LatLng, radiusMeters: number): Promise<RouteDirectionShape[]>;
}

const HOLD_ACTION_TYPES = ["terminal_dispatch_hold", "two_way_hold", "self_equalizing_hold"] as const;
const HOLD_ACTIVE_STATUSES = ["delivered", "acknowledged", "executing"] as const;

export class PgStateEstimationRepository implements StateEstimationRepository {
  constructor(private readonly db: Queryable) {}

  async loadActiveRouteDirectionShapes(): Promise<RouteDirectionShape[]> {
    const { rows } = await this.db.query<{
      route_direction_id: string;
      route_id: string;
      direction_code: string;
      corridor_id: string | null;
      is_loop: boolean;
      corridor_offset_meters: string | null;
      corridor_direction_sign: number;
      total_distance_meters: string;
      geojson: string;
    }>(
      `select rd.id as route_direction_id, rd.route_id, rd.direction_code,
              rd.corridor_id, rd.is_loop, rd.corridor_offset_meters, rd.corridor_direction_sign,
              rs.total_distance_meters, ST_AsGeoJSON(rs.geom) as geojson
         from route_directions rd
         join route_shapes rs on rs.route_direction_id = rd.id
        where rd.is_active = true`
    );

    return rows.map((row) => ({
      routeDirectionId: row.route_direction_id,
      routeId: row.route_id,
      directionCode: row.direction_code,
      corridorId: row.corridor_id,
      isLoop: row.is_loop,
      corridorOffsetMeters: row.corridor_offset_meters == null ? null : Number(row.corridor_offset_meters),
      corridorDirectionSign: row.corridor_direction_sign === -1 ? -1 : 1,
      totalDistanceMeters: Number(row.total_distance_meters),
      points: parseGeoJsonLineString(row.geojson),
    }));
  }

  async loadRouteDirectionStops(
    routeDirectionIds: readonly string[]
  ): Promise<Map<string, RouteDirectionStopPoint[]>> {
    const result = new Map<string, RouteDirectionStopPoint[]>();
    if (routeDirectionIds.length === 0) return result;

    const { rows } = await this.db.query<{
      route_direction_id: string;
      stop_id: string;
      sequence: number;
      cumulative_distance_meters: string;
      geofence_radius_meters: string;
      is_control_point: boolean;
    }>(
      `select route_direction_id, stop_id, sequence, cumulative_distance_meters,
              geofence_radius_meters, is_control_point
         from route_direction_stops
        where route_direction_id = any($1::uuid[])
        order by route_direction_id, sequence`,
      [routeDirectionIds]
    );

    for (const row of rows) {
      const stop: RouteDirectionStopPoint = {
        routeDirectionId: row.route_direction_id,
        stopId: row.stop_id,
        sequence: row.sequence,
        cumulativeDistanceMeters: Number(row.cumulative_distance_meters),
        geofenceRadiusMeters: Number(row.geofence_radius_meters),
        isControlPoint: row.is_control_point,
      };
      const bucket = result.get(row.route_direction_id);
      if (bucket) {
        bucket.push(stop);
      } else {
        result.set(row.route_direction_id, [stop]);
      }
    }

    return result;
  }

  async loadPriorVehicleState(vehicleId: string): Promise<PriorVehicleState | null> {
    const { rows } = await this.db.query<{
      route_direction_id: string | null;
      kf_state: KalmanState | null;
      confidence: string | null;
      current_stop_id: string | null;
      stop_state_entered_at: string | null;
    }>(
      `select route_direction_id, kf_state, confidence, current_stop_id, stop_state_entered_at
         from vehicle_states
        where vehicle_id = $1`,
      [vehicleId]
    );

    const row = rows[0];
    if (!row) return null;

    return {
      routeDirectionId: row.route_direction_id,
      kalmanState: row.kf_state,
      confidence: row.confidence == null ? null : Number(row.confidence),
      currentStopId: row.current_stop_id,
      stopEnteredAt: row.stop_state_entered_at,
    };
  }

  async loadActiveHold(vehicleId: string): Promise<boolean> {
    const { rows } = await this.db.query<{ held: boolean }>(
      `select exists(
          select 1 from commands
           where vehicle_id = $1
             and action_type = any($2::text[])
             and status = any($3::text[])
             and now() < expires_at
        ) as held`,
      [vehicleId, HOLD_ACTION_TYPES, HOLD_ACTIVE_STATUSES]
    );
    return rows[0]?.held ?? false;
  }

  async resolveCurrentTrip(vehicleId: string, routeDirectionId: string, now: Date): Promise<string | null> {
    const { rows } = await this.db.query<{ id: string }>(
      `select id from trips
        where vehicle_id = $1
          and route_direction_id = $2
          and status in ('active', 'scheduled')
          and scheduled_start_time <= $3
          and scheduled_end_time >= $3 - interval '30 minutes'
        order by scheduled_start_time asc
        limit 1`,
      [vehicleId, routeDirectionId, now.toISOString()]
    );
    return rows[0]?.id ?? null;
  }

  async saveVehicleState(estimate: VehicleStateEstimate): Promise<boolean> {
    try {
      const { rows } = await this.db.query<{ vehicle_id: string }>(
        `insert into vehicle_states (
           vehicle_id, trip_id, route_direction_id, position, distance_along_route_meters,
           speed_kmph, heading_degrees, stop_state, current_stop_id, confidence,
           is_low_confidence, kf_state, kf_updated_at, stop_state_entered_at, observed_at
         ) values (
           $1, $2, $3,
           ST_SetSRID(ST_MakePoint($4::double precision, $5::double precision), 4326)::geography,
           $6, $7, $8, $9, $10, $11,
           $12, $13::jsonb, $14, $15, $16
         )
         on conflict (vehicle_id) do update set
           trip_id = excluded.trip_id,
           route_direction_id = excluded.route_direction_id,
           position = excluded.position,
           distance_along_route_meters = excluded.distance_along_route_meters,
           speed_kmph = excluded.speed_kmph,
           heading_degrees = excluded.heading_degrees,
           stop_state = excluded.stop_state,
           current_stop_id = excluded.current_stop_id,
           confidence = excluded.confidence,
           is_low_confidence = excluded.is_low_confidence,
           kf_state = excluded.kf_state,
           kf_updated_at = excluded.kf_updated_at,
           stop_state_entered_at = excluded.stop_state_entered_at,
           observed_at = excluded.observed_at
         -- Never let a late/out-of-order redelivered position event clobber
         -- a state we've already advanced past (idempotency / ordering
         -- safety - OWASP A10, fail closed rather than regress silently).
         where vehicle_states.observed_at <= excluded.observed_at
         -- RETURNING is load-bearing, not decoration: the WHERE above can
         -- silently update zero rows, and without a row count the caller
         -- would go on to advance its in-memory cache past a fix the table
         -- rejected - cache and table then disagree permanently.
         returning vehicle_id`,
        [
          estimate.vehicleId,
          estimate.tripId,
          estimate.routeDirectionId,
          estimate.rawPosition.lon,
          estimate.rawPosition.lat,
          estimate.distanceAlongRouteMeters,
          estimate.speedKmph,
          estimate.headingDegrees,
          estimate.stopState,
          estimate.currentStopId,
          estimate.confidence,
          estimate.isLowConfidence,
          estimate.kalmanState ? JSON.stringify(estimate.kalmanState) : null,
          estimate.kalmanState ? estimate.kalmanState.updatedAt : null,
          estimate.stopEnteredAt,
          estimate.observedAt,
        ]
      );

      if (rows.length === 0) {
        logger.debug(
          { vehicleId: estimate.vehicleId, observedAt: estimate.observedAt },
          'vehicle_states write suppressed: a newer fix is already persisted'
        );
        return false;
      }
      return true;
    } catch (error) {
      logger.error(
        {
          vehicleId: estimate.vehicleId,
          error: error instanceof Error ? error.message : String(error),
        },
        'failed to persist vehicle_states row'
      );
      throw error;
    }
  }

  async rehydrateAll(): Promise<Map<string, PriorVehicleState>> {
    const { rows } = await this.db.query<{
      vehicle_id: string;
      route_direction_id: string | null;
      kf_state: KalmanState | null;
      confidence: string | null;
      current_stop_id: string | null;
      stop_state_entered_at: string | null;
    }>(
      `select vehicle_id, route_direction_id, kf_state, confidence, current_stop_id, stop_state_entered_at
         from vehicle_states
        where kf_state is not null`
    );

    const result = new Map<string, PriorVehicleState>();
    for (const row of rows) {
      result.set(row.vehicle_id, {
        routeDirectionId: row.route_direction_id,
        kalmanState: row.kf_state,
        confidence: row.confidence == null ? null : Number(row.confidence),
        currentStopId: row.current_stop_id,
        stopEnteredAt: row.stop_state_entered_at,
      });
    }

    logger.info({ vehicleCount: result.size }, 'rehydrated vehicle state cache');
    return result;
  }
}

export function parseGeoJsonLineString(geojson: string): LatLng[] {
  const parsed = JSON.parse(geojson) as { type: string; coordinates: [number, number][] };
  if (parsed.type !== "LineString") {
    throw new Error(`expected a GeoJSON LineString, got ${parsed.type}`);
  }
  return parsed.coordinates.map(([lon, lat]) => ({ lat, lon }));
}
