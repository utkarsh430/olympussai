// On-boot state rehydration from the core-data-model tables (vehicle_states,
// headway_states, active route_policies) into the in-memory store, required
// before /readyz reports healthy
// (docs/CONTROL_SERVICE_DEPLOYMENT.md "Health/readiness contract").
import type { Pool } from 'pg';
import { getPool } from './pool.js';
import { stateStore } from '../state/store.js';
import { logger } from '../lib/logger.js';
import { MEASURED_POLICY_PREDICATE } from '../headway/repository.js';
import type { HeadwayStateRow, RoutePolicyRow, VehicleStateRow } from '../state/store.js';

async function loadVehicleStates(pool: Pool): Promise<VehicleStateRow[]> {
  // `position` is a geography(Point) - projected to plain lat/lon here
  // rather than shipped as WKB, because everything that reads this store
  // (the /v1/vehicle-states wire shape, the MPC solver) wants numbers.
  // ::geometry is required before ST_X/ST_Y: those accessors are not
  // defined on geography.
  const { rows } = await pool.query<{
    vehicle_id: string;
    trip_id: string | null;
    route_direction_id: string | null;
    position_lat: number | string | null;
    position_lon: number | string | null;
    distance_along_route_meters: string | null;
    speed_kmph: string | null;
    heading_degrees: string | null;
    stop_state: string;
    current_stop_id: string | null;
    occupancy_count: number | null;
    occupancy_load_band: string | null;
    confidence: string | null;
    is_low_confidence: boolean | null;
    observed_at: string;
  }>(
    `select vehicle_id, trip_id, route_direction_id,
            ST_Y(position::geometry) as position_lat,
            ST_X(position::geometry) as position_lon,
            distance_along_route_meters,
            speed_kmph, heading_degrees, stop_state, current_stop_id,
            occupancy_count, occupancy_load_band,
            confidence, is_low_confidence, observed_at
       from vehicle_states`,
  );
  return rows.map((r) => ({
    vehicleId: r.vehicle_id,
    tripId: r.trip_id,
    routeDirectionId: r.route_direction_id,
    position:
      r.position_lat == null || r.position_lon == null
        ? null
        : { lat: Number(r.position_lat), lon: Number(r.position_lon) },
    distanceAlongRouteMeters: r.distance_along_route_meters === null ? null : Number(r.distance_along_route_meters),
    speedKmph: r.speed_kmph === null ? null : Number(r.speed_kmph),
    headingDegrees: r.heading_degrees === null ? null : Number(r.heading_degrees),
    stopState: r.stop_state,
    currentStopId: r.current_stop_id,
    occupancyCount: r.occupancy_count,
    occupancyLoadBand: r.occupancy_load_band,
    confidence: r.confidence === null ? null : Number(r.confidence),
    // NOT NULL DEFAULT false in the schema; `?? false` only covers a row
    // materialised by a fake pool in tests.
    isLowConfidence: r.is_low_confidence ?? false,
    observedAt: r.observed_at,
  }));
}

async function loadHeadwayStates(pool: Pool): Promise<HeadwayStateRow[]> {
  // Most recent sample per leader/follower pair only - this is runtime
  // state to rehydrate, not the full append-only history (blueprint 7.3
  // history stays in Postgres and is queried directly when needed).
  const { rows } = await pool.query<{
    id: string;
    route_direction_id: string;
    leader_vehicle_id: string;
    follower_vehicle_id: string;
    h_fwd_seconds: string | null;
    h_bwd_seconds: string | null;
    target_headway_seconds: string;
    deviation_seconds: string | null;
    computed_at: string;
  }>(
    `select distinct on (leader_vehicle_id, follower_vehicle_id)
            id, route_direction_id, leader_vehicle_id, follower_vehicle_id,
            h_fwd_seconds, h_bwd_seconds, target_headway_seconds,
            deviation_seconds, computed_at
       from headway_states
      order by leader_vehicle_id, follower_vehicle_id, computed_at desc`,
  );
  return rows.map((r) => ({
    id: r.id,
    routeDirectionId: r.route_direction_id,
    leaderVehicleId: r.leader_vehicle_id,
    followerVehicleId: r.follower_vehicle_id,
    hFwdSeconds: r.h_fwd_seconds === null ? null : Number(r.h_fwd_seconds),
    hBwdSeconds: r.h_bwd_seconds === null ? null : Number(r.h_bwd_seconds),
    targetHeadwaySeconds: Number(r.target_headway_seconds),
    deviationSeconds: r.deviation_seconds === null ? null : Number(r.deviation_seconds),
    computedAt: r.computed_at,
  }));
}

/**
 * Rows without a MEASURED target headway are excluded for the same reason
 * src/headway/repository.ts#loadActiveRoutePolicy excludes them, and through
 * the same exported predicate so the two cannot drift: such a row has no target
 * headway, only the sentinel the not-null column forced ('none') or a number
 * written where no evidence was found ('default'). Loading either into the
 * store would hand every consumer something to divide by. Absent from the store
 * is the state that already means "unpoliced".
 */
async function loadActivePolicies(pool: Pool): Promise<RoutePolicyRow[]> {
  const { rows } = await pool.query<{
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
    minimum_action_seconds: number;
    prediction_horizon_control_points: number;
    occupancy_stale_seconds: number | null;
    occupancy_capacity: number | null;
    ks: string | null;
    max_lateness_seconds: number | null;
    speed_band_min_kmph: string | null;
    speed_band_max_kmph: string | null;
    max_concurrent_actions: number | null;
  }>(
    `select id, route_direction_id, operating_period, day_type,
            target_headway_seconds, bunched_threshold_ratio, warning_threshold_ratio,
            kf, kb, self_equalizing_k, max_hold_seconds, cooldown_seconds, minimum_action_seconds,
            prediction_horizon_control_points, occupancy_stale_seconds, occupancy_capacity,
            ks, max_lateness_seconds, speed_band_min_kmph, speed_band_max_kmph,
            max_concurrent_actions
       from route_policies
      where effective_to is null
        and ${MEASURED_POLICY_PREDICATE}`,
  );
  return rows.map((r) => ({
    id: r.id,
    routeDirectionId: r.route_direction_id,
    operatingPeriod: r.operating_period,
    dayType: r.day_type,
    targetHeadwaySeconds: Number(r.target_headway_seconds),
    bunchedThresholdRatio: Number(r.bunched_threshold_ratio),
    warningThresholdRatio: Number(r.warning_threshold_ratio),
    kf: r.kf === null ? null : Number(r.kf),
    kb: r.kb === null ? null : Number(r.kb),
    selfEqualizingK: r.self_equalizing_k === null ? null : Number(r.self_equalizing_k),
    maxHoldSeconds: r.max_hold_seconds,
    cooldownSeconds: r.cooldown_seconds,
    minimumActionSeconds: r.minimum_action_seconds,
    predictionHorizonControlPoints: r.prediction_horizon_control_points,
    occupancyStaleSeconds: r.occupancy_stale_seconds,
    occupancyCapacity: r.occupancy_capacity,
    ks: r.ks === null ? null : Number(r.ks),
    maxLatenessSeconds: r.max_lateness_seconds,
    speedBandMinKmph: r.speed_band_min_kmph === null ? null : Number(r.speed_band_min_kmph),
    speedBandMaxKmph: r.speed_band_max_kmph === null ? null : Number(r.speed_band_max_kmph),
    maxConcurrentActions: r.max_concurrent_actions,
  }));
}

/**
 * Every stop a corridor has designated as a control point.
 *
 * Separate query from `loadTerminalStops` rather than one pass over the
 * table: that one wants exactly one row per route-direction (the origin) and
 * uses `distinct on` to get it, while this wants all of them. Folding the
 * two together would mean post-processing a result shaped for neither.
 */
async function loadControlPointStops(pool: Pool): Promise<{ routeDirectionId: string; stopId: string }[]> {
  const { rows } = await pool.query<{ route_direction_id: string; stop_id: string }>(
    `select route_direction_id, stop_id
       from route_direction_stops
      where is_control_point`,
  );
  return rows.map((r) => ({ routeDirectionId: r.route_direction_id, stopId: r.stop_id }));
}

/**
 * Every route-direction's stop sequence, for the horizon the objective's
 * waiting term is summed over (`mpc/objective.ts`, `MULTI_STOP_WAIT_TERM_ENABLED`).
 *
 * A third pass over the same table rather than a widening of
 * `loadControlPointStops`: that one is filtered to `is_control_point` and
 * this one must not be. Holds are executed at control points, but a hold's
 * benefit is experienced at EVERY station the vehicle has left - and
 * `route_direction_stops` is static config read once at boot, so the extra
 * pass costs one query per process.
 */
async function loadStopSequences(
  pool: Pool,
): Promise<{ routeDirectionId: string; stopId: string; sequence: number }[]> {
  const { rows } = await pool.query<{
    route_direction_id: string;
    stop_id: string;
    sequence: number;
  }>(
    `select route_direction_id, stop_id, sequence
       from route_direction_stops
      order by route_direction_id, sequence asc`,
  );
  return rows.map((r) => ({
    routeDirectionId: r.route_direction_id,
    stopId: r.stop_id,
    sequence: Number(r.sequence),
  }));
}

async function loadTerminalStops(pool: Pool): Promise<{ routeDirectionId: string; stopId: string }[]> {
  // The lowest `sequence` row per route-direction is its origin terminal
  // (blueprint 8.2 Algorithm A). `distinct on` + `order by sequence asc`
  // picks exactly that row per route-direction in one query.
  const { rows } = await pool.query<{ route_direction_id: string; stop_id: string }>(
    `select distinct on (route_direction_id) route_direction_id, stop_id
       from route_direction_stops
      order by route_direction_id, sequence asc`,
  );
  return rows.map((r) => ({ routeDirectionId: r.route_direction_id, stopId: r.stop_id }));
}

/**
 * How much of the NETWORK (as opposed to runtime state) this instance
 * actually has. Distinct from stateStore.counts(), which reports the live
 * per-vehicle state: these two numbers describe whether the static network
 * that state estimation matches AGAINST exists at all.
 */
export interface NetworkCounts {
  /**
   * Active route-directions that have a route_shape. Zero means map
   * matching has nothing to match to, so every fix short-circuits to
   * `off_route` - see routes/health.ts, which turns a zero here into a
   * 503 rather than letting the instance take traffic it cannot serve.
   */
  routeDirectionsWithShape: number;
  vehicles: number;
}

let networkCounts: NetworkCounts = { routeDirectionsWithShape: 0, vehicles: 0 };

/** Last counts observed by rehydrateState() or refreshNetworkCounts(). Zeroed until either has run. */
export function getNetworkCounts(): NetworkCounts {
  return { ...networkCounts };
}

/** Test-only: reset the module-level counts between cases. */
export function _resetNetworkCountsForTests(): void {
  networkCounts = { routeDirectionsWithShape: 0, vehicles: 0 };
}

async function loadNetworkCounts(pool: Pool): Promise<NetworkCounts> {
  // One round trip with two scalar subqueries rather than two queries: the
  // numbers are only ever read together, and count(*) returns bigint, which
  // node-postgres hands back as a string.
  const { rows } = await pool.query<{
    route_directions_with_shape: string | number | null;
    vehicles: string | number | null;
  }>(
    `select
       (select count(*)
          from route_directions rd
          join route_shapes rs on rs.route_direction_id = rd.id
         where rd.is_active) as route_directions_with_shape,
       (select count(*) from vehicles where is_active) as vehicles`,
  );
  const row = rows[0];
  return {
    routeDirectionsWithShape: Number(row?.route_directions_with_shape ?? 0),
    vehicles: Number(row?.vehicles ?? 0),
  };
}

/**
 * Recomputes and publishes the counts /readyz reports (getNetworkCounts()),
 * independently of a full rehydrateState() run.
 *
 * WHY THIS IS SEPARATE FROM rehydrateState(). Before this function existed,
 * networkCounts was set exactly once, at process boot, by rehydrateState()
 * alone. A live instance's /readyz then reported whatever the network
 * looked like at STARTUP forever after: a reseed that took the network from
 * 47 to 759 route-directions-with-shape left /readyz reporting 47 until the
 * process was restarted, silently misrepresenting readiness (and, with
 * REQUIRE_SEEDED_NETWORK on, the actual gate) for as long as the instance
 * kept running. Restarting to pick up a number is a workaround, not a fix.
 *
 * Called from two places that already know the network may have just
 * changed, rather than from every /readyz request: the geometryRefresh
 * scheduled job (SHAPE_CACHE_TTL_MS, 15 minutes by default - see
 * scheduler/jobs.ts) as a bounded backstop, and
 * POST /v1/admin/geometry/refresh (routes/positions.ts) as the immediate
 * path an operator already uses right after reseeding to make new shapes
 * live. /readyz itself stays a cheap in-memory read on every poll -
 * infrastructure can hit it at a high rate, and a full count(*) join
 * against route_directions/route_shapes on every one of those requests
 * would be pure waste on an instance nothing has changed on.
 */
export async function refreshNetworkCounts(pool: Pool = getPool()): Promise<NetworkCounts> {
  networkCounts = await loadNetworkCounts(pool);
  return { ...networkCounts };
}

/**
 * Rehydrates the in-memory store from CONTROL_SERVICE_DATABASE_URL. Must
 * complete (or fail) before /readyz can return 200 - Render gates traffic
 * cutover on /readyz, so this function is the load-bearing piece of a safe
 * rolling deploy.
 */
export async function rehydrateState(pool: Pool = getPool()): Promise<void> {
  stateStore.setStatus('in_progress');
  try {
    const [
      vehicleStates,
      headwayStates,
      activePolicies,
      terminalStops,
      controlPointStops,
      stopSequences,
    ] = await Promise.all([
      loadVehicleStates(pool),
      loadHeadwayStates(pool),
      loadActivePolicies(pool),
      loadTerminalStops(pool),
      loadControlPointStops(pool),
      loadStopSequences(pool),
      refreshNetworkCounts(pool),
    ]);
    stateStore.loadVehicleStates(vehicleStates);
    stateStore.loadHeadwayStates(headwayStates);
    stateStore.loadActivePolicies(activePolicies);
    stateStore.loadTerminalStops(terminalStops);
    stateStore.loadStopSequences(stopSequences);
    stateStore.loadControlPointStops(controlPointStops);
    stateStore.setStatus('complete');
    logger.info(
      { counts: stateStore.counts(), network: networkCounts },
      'state rehydration complete',
    );
  } catch (err) {
    stateStore.setStatus('failed', err instanceof Error ? err.message : String(err));
    logger.error({ err }, 'state rehydration failed');
    throw err;
  }
}
