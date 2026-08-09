// Postgres access for headway metrics and bunching incidents. Kept as a
// thin set of plain functions (matching the existing db/commands.ts /
// mpc/solver.ts convention in this codebase) rather than a class, each
// taking an optional `pool` for tests to inject a fake - see
// test/headwayService.test.ts and test/headwayRoutes.test.ts, which mock
// this whole module the same way test/service.test.ts mocks db/commands.js.
//
// Reads here go straight to Postgres rather than the in-memory
// `state/store.ts` cache: that cache is only populated once at process
// boot (control-service/src/db/rehydrate.ts) and nothing currently updates
// it at runtime (the GPS ingestion endpoint that would is a separate,
// not-yet-built piece of work - see control-service/README.md and the
// Crewban-5 handoff note on this ticket). Computing headway from a
// boot-time snapshot would silently go stale, so this module queries the
// vehicle_states / route_policies / route_directions tables directly on
// every compute call instead.
import type { Pool } from "pg";
import { getPool } from "../db/pool.js";
import type {
  BunchingSeverity,
  RouteDirectionMeta,
  RoutePolicyForHeadway,
  VehicleForHeadway,
} from "./types.js";

export async function loadRouteDirectionMeta(
  routeDirectionId: string,
  pool: Pool = getPool()
): Promise<RouteDirectionMeta | null> {
  const { rows } = await pool.query<{
    route_direction_id: string;
    route_id: string;
    direction_code: string;
    is_loop: boolean;
    total_distance_meters: string;
  }>(
    `select rd.id as route_direction_id, rd.route_id, rd.direction_code, rd.is_loop, rs.total_distance_meters
       from route_directions rd
       join route_shapes rs on rs.route_direction_id = rd.id
      where rd.id = $1 and rd.is_active = true`,
    [routeDirectionId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    routeDirectionId: row.route_direction_id,
    routeId: row.route_id,
    directionCode: row.direction_code,
    isLoop: row.is_loop,
    totalDistanceMeters: Number(row.total_distance_meters),
  };
}

/** Active policy for this route-direction (effective_to is null), preferring the all-period/all-day-type default row when several apply. */
export async function loadActiveRoutePolicy(
  routeDirectionId: string,
  pool: Pool = getPool()
): Promise<RoutePolicyForHeadway | null> {
  const { rows } = await pool.query<{
    route_direction_id: string;
    target_headway_seconds: string;
    bunched_threshold_ratio: string;
    warning_threshold_ratio: string;
    required_samples: number;
    operating_period: string;
    day_type: string;
  }>(
    `select route_direction_id, target_headway_seconds, bunched_threshold_ratio,
            warning_threshold_ratio, required_samples, operating_period, day_type
       from route_policies
      where route_direction_id = $1 and effective_to is null
      order by (operating_period = 'all' and day_type = 'all') desc
      limit 1`,
    [routeDirectionId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    routeDirectionId: row.route_direction_id,
    targetHeadwaySeconds: Number(row.target_headway_seconds),
    bunchedThresholdRatio: Number(row.bunched_threshold_ratio),
    warningThresholdRatio: Number(row.warning_threshold_ratio),
    requiredSamples: row.required_samples,
  };
}

export async function loadVehicleStatesForRouteDirection(
  routeDirectionId: string,
  pool: Pool = getPool()
): Promise<VehicleForHeadway[]> {
  const { rows } = await pool.query<{
    vehicle_id: string;
    distance_along_route_meters: string | null;
    speed_kmph: string | null;
    confidence: string | null;
    is_low_confidence: boolean;
    observed_at: string;
  }>(
    `select vehicle_id, distance_along_route_meters, speed_kmph, confidence, is_low_confidence, observed_at
       from vehicle_states
      where route_direction_id = $1 and distance_along_route_meters is not null`,
    [routeDirectionId]
  );
  return rows.map((row) => ({
    vehicleId: row.vehicle_id,
    routeDirectionId,
    distanceAlongRouteMeters: Number(row.distance_along_route_meters),
    isLowConfidence: row.is_low_confidence,
    speedKmph: row.speed_kmph == null ? null : Number(row.speed_kmph),
    confidence: row.confidence == null ? null : Number(row.confidence),
    observedAt: row.observed_at,
  }));
}

export interface HeadwaySampleInput {
  routeDirectionId: string;
  leaderVehicleId: string;
  followerVehicleId: string;
  hFwdSeconds: number | null;
  hBwdSeconds: number | null;
  targetHeadwaySeconds: number;
  deviationSeconds: number | null;
  confidence: number | null;
}

export interface HeadwaySampleRow extends HeadwaySampleInput {
  id: string;
  forecastHFwdSeconds: number | null;
  computedAt: string;
}

export async function insertHeadwaySample(
  input: HeadwaySampleInput,
  pool: Pool = getPool()
): Promise<HeadwaySampleRow> {
  const { rows } = await pool.query<{
    id: string;
    route_direction_id: string;
    leader_vehicle_id: string;
    follower_vehicle_id: string;
    h_fwd_seconds: string | null;
    h_bwd_seconds: string | null;
    target_headway_seconds: string;
    deviation_seconds: string | null;
    forecast_h_fwd_seconds: string | null;
    confidence: string | null;
    computed_at: string;
  }>(
    `insert into headway_states
       (route_direction_id, leader_vehicle_id, follower_vehicle_id, h_fwd_seconds,
        h_bwd_seconds, target_headway_seconds, deviation_seconds, confidence)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id, route_direction_id, leader_vehicle_id, follower_vehicle_id,
               h_fwd_seconds, h_bwd_seconds, target_headway_seconds, deviation_seconds,
               forecast_h_fwd_seconds, confidence, computed_at`,
    [
      input.routeDirectionId,
      input.leaderVehicleId,
      input.followerVehicleId,
      input.hFwdSeconds,
      input.hBwdSeconds,
      input.targetHeadwaySeconds,
      input.deviationSeconds,
      input.confidence,
    ]
  );
  const row = rows[0];
  if (!row) {
    throw new Error("headway_states insert returned no row");
  }
  return {
    id: row.id,
    routeDirectionId: row.route_direction_id,
    leaderVehicleId: row.leader_vehicle_id,
    followerVehicleId: row.follower_vehicle_id,
    hFwdSeconds: row.h_fwd_seconds == null ? null : Number(row.h_fwd_seconds),
    hBwdSeconds: row.h_bwd_seconds == null ? null : Number(row.h_bwd_seconds),
    targetHeadwaySeconds: Number(row.target_headway_seconds),
    deviationSeconds: row.deviation_seconds == null ? null : Number(row.deviation_seconds),
    forecastHFwdSeconds: row.forecast_h_fwd_seconds == null ? null : Number(row.forecast_h_fwd_seconds),
    confidence: row.confidence == null ? null : Number(row.confidence),
    computedAt: row.computed_at,
  };
}

/** hFwd/target ratios for this pair's most recent samples, newest first - the reactive rule's lookback window. */
export async function loadRecentHeadwayRatios(
  routeDirectionId: string,
  leaderVehicleId: string,
  followerVehicleId: string,
  limit: number,
  pool: Pool = getPool()
): Promise<number[]> {
  const { rows } = await pool.query<{ ratio: string }>(
    `select (h_fwd_seconds / target_headway_seconds) as ratio
       from headway_states
      where route_direction_id = $1 and leader_vehicle_id = $2 and follower_vehicle_id = $3
        and h_fwd_seconds is not null
      order by computed_at desc
      limit $4`,
    [routeDirectionId, leaderVehicleId, followerVehicleId, limit]
  );
  return rows.map((row) => Number(row.ratio));
}

/**
 * Route-directions that could actually produce a leader/follower pair right
 * now, i.e. that have at least TWO map-matched vehicle_states rows fresher
 * than `freshnessSeconds`.
 *
 * This pruning query - not the concurrency cap - is what makes the periodic
 * headway sweep affordable. With ~665 live buses spread over ~517 routes,
 * the overwhelming majority of the ~1,020 active route-directions have zero
 * or one vehicle on them and can produce no pair at all; computing headway
 * for those is pure waste (a metadata read, a policy read, a vehicle read,
 * and an empty result). In practice this cuts the sweep from ~1,020
 * route-directions to a few dozen.
 *
 * `exists (select 1 ... offset 1)` is the cheap spelling of "at least two":
 * Postgres can stop as soon as it has skipped one row and found a second,
 * without counting the rest.
 */
export async function listRouteDirectionsWithLiveHeadwayPairs(
  freshnessSeconds: number,
  pool: Pool = getPool()
): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `select rd.id
       from route_directions rd
       join route_shapes rs on rs.route_direction_id = rd.id
      where rd.is_active
        and exists (
              select 1
                from vehicle_states vs
               where vs.route_direction_id = rd.id
                 and vs.distance_along_route_meters is not null
                 and vs.observed_at > now() - ($1 || ' seconds')::interval
              offset 1
            )
      order by rd.id`,
    [freshnessSeconds]
  );
  return rows.map((row) => row.id);
}

/**
 * The most recent persisted sample per leader/follower pair on a
 * route-direction, within `maxAgeSeconds`. Read-only counterpart to
 * insertHeadwaySample - backs GET /v1/route-directions/:id/headway, which
 * exists so a dashboard poll can READ the history the reactive bunching
 * rule looks back over instead of appending an off-cadence sample to it.
 */
export async function loadLatestHeadwaySamples(
  routeDirectionId: string,
  maxAgeSeconds: number,
  pool: Pool = getPool()
): Promise<HeadwaySampleRow[]> {
  const { rows } = await pool.query<{
    id: string;
    route_direction_id: string;
    leader_vehicle_id: string;
    follower_vehicle_id: string;
    h_fwd_seconds: string | null;
    h_bwd_seconds: string | null;
    target_headway_seconds: string;
    deviation_seconds: string | null;
    forecast_h_fwd_seconds: string | null;
    confidence: string | null;
    computed_at: string;
  }>(
    `select distinct on (leader_vehicle_id, follower_vehicle_id)
            id, route_direction_id, leader_vehicle_id, follower_vehicle_id,
            h_fwd_seconds, h_bwd_seconds, target_headway_seconds, deviation_seconds,
            forecast_h_fwd_seconds, confidence, computed_at
       from headway_states
      where route_direction_id = $1
        and computed_at > now() - ($2 || ' seconds')::interval
      order by leader_vehicle_id, follower_vehicle_id, computed_at desc`,
    [routeDirectionId, maxAgeSeconds]
  );
  return rows.map((row) => ({
    id: row.id,
    routeDirectionId: row.route_direction_id,
    leaderVehicleId: row.leader_vehicle_id,
    followerVehicleId: row.follower_vehicle_id,
    hFwdSeconds: row.h_fwd_seconds == null ? null : Number(row.h_fwd_seconds),
    hBwdSeconds: row.h_bwd_seconds == null ? null : Number(row.h_bwd_seconds),
    targetHeadwaySeconds: Number(row.target_headway_seconds),
    deviationSeconds: row.deviation_seconds == null ? null : Number(row.deviation_seconds),
    forecastHFwdSeconds: row.forecast_h_fwd_seconds == null ? null : Number(row.forecast_h_fwd_seconds),
    confidence: row.confidence == null ? null : Number(row.confidence),
    computedAt: row.computed_at,
  }));
}

export interface OpenIncidentRef {
  id: string;
  severity: BunchingSeverity;
}

export async function findOpenIncidentForPair(
  routeDirectionId: string,
  leaderVehicleId: string,
  followerVehicleId: string,
  pool: Pool = getPool()
): Promise<OpenIncidentRef | null> {
  const { rows } = await pool.query<{ id: string; severity: BunchingSeverity }>(
    `select bi.id, bi.severity
       from bunching_incidents bi
       join bunching_incident_members leader_member
         on leader_member.incident_id = bi.id and leader_member.vehicle_id = $2
       join bunching_incident_members follower_member
         on follower_member.incident_id = bi.id and follower_member.vehicle_id = $3
      where bi.route_direction_id = $1 and bi.status <> 'closed'
      order by bi.started_at desc
      limit 1`,
    [routeDirectionId, leaderVehicleId, followerVehicleId]
  );
  const row = rows[0];
  return row ? { id: row.id, severity: row.severity } : null;
}

export interface OpenIncidentInput {
  routeDirectionId: string;
  severity: BunchingSeverity;
  leaderVehicleId: string;
  followerVehicleId: string;
  evidence: Record<string, unknown>;
}

export async function openIncident(
  input: OpenIncidentInput,
  pool: Pool = getPool()
): Promise<{ id: string; startedAt: string }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ id: string; started_at: string }>(
      `insert into bunching_incidents (route_direction_id, severity, evidence)
       values ($1, $2, $3::jsonb)
       returning id, started_at`,
      [input.routeDirectionId, input.severity, JSON.stringify(input.evidence)]
    );
    const incident = rows[0];
    if (!incident) throw new Error("bunching_incidents insert returned no row");
    await client.query(
      `insert into bunching_incident_members (incident_id, vehicle_id, member_role)
       values ($1, $2, 'leader'), ($1, $3, 'follower')`,
      [incident.id, input.leaderVehicleId, input.followerVehicleId]
    );
    await client.query("commit");
    return { id: incident.id, startedAt: incident.started_at };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function escalateIncident(
  id: string,
  severity: BunchingSeverity,
  evidence: Record<string, unknown>,
  pool: Pool = getPool()
): Promise<void> {
  await pool.query(`update bunching_incidents set severity = $2, evidence = $3::jsonb where id = $1`, [
    id,
    severity,
    JSON.stringify(evidence),
  ]);
}

export async function closeIncident(
  id: string,
  evidence: Record<string, unknown>,
  pool: Pool = getPool()
): Promise<void> {
  await pool.query(
    `update bunching_incidents set status = 'closed', ended_at = now(), evidence = $2::jsonb where id = $1`,
    [id, JSON.stringify(evidence)]
  );
}

export interface BunchingIncidentRow {
  id: string;
  routeDirectionId: string;
  severity: string;
  causeClass: string;
  controllability: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  evidence: Record<string, unknown>;
  members: { vehicleId: string; role: string }[];
}

export async function listOpenIncidents(
  routeDirectionId: string | undefined,
  pool: Pool = getPool()
): Promise<BunchingIncidentRow[]> {
  const whereClause = routeDirectionId ? "and bi.route_direction_id = $1" : "";
  const params = routeDirectionId ? [routeDirectionId] : [];
  const { rows } = await pool.query<{
    id: string;
    route_direction_id: string;
    severity: string;
    cause_class: string;
    controllability: string;
    status: string;
    started_at: string;
    ended_at: string | null;
    evidence: Record<string, unknown>;
    members: { vehicleId: string; role: string }[];
  }>(
    `select bi.id, bi.route_direction_id, bi.severity, bi.cause_class, bi.controllability,
            bi.status, bi.started_at, bi.ended_at, bi.evidence,
            coalesce(
              json_agg(json_build_object('vehicleId', m.vehicle_id, 'role', m.member_role))
                filter (where m.vehicle_id is not null),
              '[]'
            ) as members
       from bunching_incidents bi
       left join bunching_incident_members m on m.incident_id = bi.id
      where bi.status <> 'closed' ${whereClause}
      group by bi.id
      order by bi.started_at desc`,
    params
  );
  return rows.map((row) => ({
    id: row.id,
    routeDirectionId: row.route_direction_id,
    severity: row.severity,
    causeClass: row.cause_class,
    controllability: row.controllability,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    evidence: row.evidence,
    members: row.members,
  }));
}

/**
 * A single incident by id, regardless of status (open or closed) — unlike
 * listOpenIncidents, which deliberately excludes closed ones. Backs the web
 * app's incident timeline reconstruction (state -> explanation -> decision
 * -> ack -> outcome), which still needs to read a closed incident's state
 * to show its final "outcome" stage.
 */
export async function getIncidentById(
  id: string,
  pool: Pool = getPool()
): Promise<BunchingIncidentRow | null> {
  const { rows } = await pool.query<{
    id: string;
    route_direction_id: string;
    severity: string;
    cause_class: string;
    controllability: string;
    status: string;
    started_at: string;
    ended_at: string | null;
    evidence: Record<string, unknown>;
    members: { vehicleId: string; role: string }[];
  }>(
    `select bi.id, bi.route_direction_id, bi.severity, bi.cause_class, bi.controllability,
            bi.status, bi.started_at, bi.ended_at, bi.evidence,
            coalesce(
              json_agg(json_build_object('vehicleId', m.vehicle_id, 'role', m.member_role))
                filter (where m.vehicle_id is not null),
              '[]'
            ) as members
       from bunching_incidents bi
       left join bunching_incident_members m on m.incident_id = bi.id
      where bi.id = $1
      group by bi.id`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    routeDirectionId: row.route_direction_id,
    severity: row.severity,
    causeClass: row.cause_class,
    controllability: row.controllability,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    evidence: row.evidence,
    members: row.members,
  };
}

export async function listActiveRouteDirections(
  pool: Pool = getPool()
): Promise<RouteDirectionMeta[]> {
  const { rows } = await pool.query<{
    route_direction_id: string;
    route_id: string;
    direction_code: string;
    is_loop: boolean;
    total_distance_meters: string;
  }>(
    `select rd.id as route_direction_id, rd.route_id, rd.direction_code, rd.is_loop, rs.total_distance_meters
       from route_directions rd
       join route_shapes rs on rs.route_direction_id = rd.id
      where rd.is_active = true
      order by rd.route_id, rd.direction_code`
  );
  return rows.map((row) => ({
    routeDirectionId: row.route_direction_id,
    routeId: row.route_id,
    directionCode: row.direction_code,
    isLoop: row.is_loop,
    totalDistanceMeters: Number(row.total_distance_meters),
  }));
}
