// On-boot state rehydration from the core-data-model tables (vehicle_states,
// headway_states, active route_policies) into the in-memory store, required
// before /readyz reports healthy
// (docs/CONTROL_SERVICE_DEPLOYMENT.md "Health/readiness contract").
import type { Pool } from 'pg';
import { getPool } from './pool.js';
import { stateStore } from '../state/store.js';
import { logger } from '../lib/logger.js';
import type { HeadwayStateRow, RoutePolicyRow, VehicleStateRow } from '../state/store.js';

async function loadVehicleStates(pool: Pool): Promise<VehicleStateRow[]> {
  const { rows } = await pool.query<{
    vehicle_id: string;
    trip_id: string | null;
    route_direction_id: string | null;
    distance_along_route_meters: string | null;
    speed_kmph: string | null;
    stop_state: string;
    current_stop_id: string | null;
    confidence: string | null;
    observed_at: string;
  }>(
    `select vehicle_id, trip_id, route_direction_id, distance_along_route_meters,
            speed_kmph, stop_state, current_stop_id, confidence, observed_at
       from vehicle_states`,
  );
  return rows.map((r) => ({
    vehicleId: r.vehicle_id,
    tripId: r.trip_id,
    routeDirectionId: r.route_direction_id,
    distanceAlongRouteMeters: r.distance_along_route_meters === null ? null : Number(r.distance_along_route_meters),
    speedKmph: r.speed_kmph === null ? null : Number(r.speed_kmph),
    stopState: r.stop_state,
    currentStopId: r.current_stop_id,
    confidence: r.confidence === null ? null : Number(r.confidence),
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
  }>(
    `select id, route_direction_id, operating_period, day_type,
            target_headway_seconds, bunched_threshold_ratio, warning_threshold_ratio,
            kf, kb, self_equalizing_k, max_hold_seconds, cooldown_seconds
       from route_policies
      where effective_to is null`,
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
  }));
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
    const [vehicleStates, headwayStates, activePolicies] = await Promise.all([
      loadVehicleStates(pool),
      loadHeadwayStates(pool),
      loadActivePolicies(pool),
    ]);
    stateStore.loadVehicleStates(vehicleStates);
    stateStore.loadHeadwayStates(headwayStates);
    stateStore.loadActivePolicies(activePolicies);
    stateStore.setStatus('complete');
    logger.info({ counts: stateStore.counts() }, 'state rehydration complete');
  } catch (err) {
    stateStore.setStatus('failed', err instanceof Error ? err.message : String(err));
    logger.error({ err }, 'state rehydration failed');
    throw err;
  }
}
