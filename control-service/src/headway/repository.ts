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
import { loadEnv } from "../config/env.js";
import type { StopVisitRecord } from "./stopHeadway.js";
import type {
  BunchingSeverity,
  RouteDirectionListing,
  RouteDirectionMeta,
  RoutePolicyForHeadway,
  VehicleForHeadway,
} from "./types.js";

/**
 * "This policy row carries a target headway that was MEASURED."
 *
 * The one predicate that decides whether a corridor detects at all, written
 * once and referenced everywhere so the corridor picker's `has_active_policy`
 * flag, the eligibility sweep and the headway read can never drift apart. They
 * used to be three hand-copied strings, which is how the second of the two
 * exclusions below went missing from all three at once.
 *
 * ─── BOTH EXCLUSIONS ARE THE SAME RULE ───────────────────────────────────
 *
 * `calibration_source` records where a target headway CAME FROM
 * (src/seed/harvest.ts). Two of its values mean "nowhere":
 *
 *   'none'     No target. The timetable had no answer, so
 *              UNCALIBRATED_HEADWAY_SENTINEL_SECONDS (1) sits in the not-null
 *              column and detection is off, visibly.
 *   'default'  FABRICATED - harvest.ts's own word. No evidence was found and a
 *              number was written anyway, because the column is NOT NULL and
 *              `> 0` and something had to go in it.
 *
 * Only 'none' was excluded. 'default' was not, so nothing stopped the reactive
 * bunching rule running against an invented number - exactly what "Derive
 * target headway from the published timetable; never fabricate one" was
 * supposed to have ended.
 *
 * WHAT IT WOULD DO, because "it is only a fallback" reads as harmless. Every
 * threshold in this directory is a RATIO of H*, so a fabricated H* does not
 * weaken detection, it INVERTS it. The 679 'default' rows written on this
 * deployment carry targets from 60 seconds to 50,460 (14 hours). At the top of
 * that range and the default 0.25 bunched ratio, any pair closer together than
 * three and a half hours reads as bunched - on a live corridor, every pair,
 * permanently. At the bottom, nothing can ever flag. seed/index.ts used to
 * describe these rows as "effectively excluded from bunching detection", which
 * is the reasoning this predicate corrects.
 *
 * SCOPE, stated honestly: all 679 of those rows have since been superseded by
 * recalibration, so this deployment's ACTIVE set (666 rows: 495 'none', 171
 * measured) currently contains none of them. This closes the hole rather than
 * clears a live backlog - a fresh seed of a deployment that has not been
 * recalibrated writes 'default' rows, and they would have been live inputs.
 *
 * A fabricated target is not a weaker measurement, it is the absence of one,
 * and the honest handling of an absent target is the fail-closed 404
 * `no_active_policy` that 'none' already gets.
 */
export const MEASURED_POLICY_PREDICATE = "calibration_source not in ('none', 'default')";

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

/**
 * Active policy for this route-direction (effective_to is null), preferring the
 * all-period/all-day-type default row when several apply.
 *
 * `calibration_source = 'none'` ROWS ARE EXCLUDED, and that exclusion is the
 * enforcement point for the seeder's no-fabrication policy. Such a row means
 * the timetable had no answer for this route-direction, so
 * target_headway_seconds carries a sentinel rather than a target (see
 * db/migrations/20260810120000__route_policy_timetable_calibration.sql). H* is
 * the denominator of every threshold in this directory - bunching.ts divides by
 * it, metrics.ts reports CV and EWT against it - so letting a sentinel through
 * would produce numbers, and numbers get believed.
 *
 * Filtering here rather than at each call site means the route-direction takes
 * the path that ALREADY existed for an unpoliced one: this returns null and
 * service.ts raises its 404 `no_active_policy`. Detection is off, and saying so
 * out loud is the entire point - the failure being fixed is that it used to be
 * off silently, on two thirds of the network.
 */
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
        and ${MEASURED_POLICY_PREDICATE}
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
  /**
   * Projected forward headway at the forecast horizon
   * (src/headway/riskForecast.ts), or null when no trend could be fitted.
   *
   * `headway_states.forecast_h_fwd_seconds` has existed since the core data
   * model and carried NULL on every row ever written, because this column was
   * simply absent from the insert. Storing it makes the prediction auditable
   * after the fact: an operator asking "was this predicted, and how early?"
   * can be answered from the sample history rather than from a log line.
   */
  forecastHFwdSeconds?: number | null;
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
        h_bwd_seconds, target_headway_seconds, deviation_seconds, confidence,
        forecast_h_fwd_seconds)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
      input.forecastHFwdSeconds ?? null,
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
 * The same pair's recent samples, but carrying WHEN each was taken.
 *
 * `loadRecentHeadwayRatios` above deliberately returns bare ratios: the
 * reactive rule is a rule about consecutive samples and has no use for the
 * clock. The predictive tier regresses headway ON time, so it needs the
 * timestamps, and it needs the raw seconds rather than the ratio - a slope in
 * ratio-per-second would have to be multiplied back by H* to forecast a
 * crossing, and doing that at the call site is how the two representations
 * end up disagreeing.
 *
 * Ordered newest-first to match its sibling; the fit sorts for itself.
 */
export async function loadRecentHeadwaySamples(
  routeDirectionId: string,
  leaderVehicleId: string,
  followerVehicleId: string,
  limit: number,
  pool: Pool = getPool()
): Promise<{ hFwdSeconds: number; computedAt: string }[]> {
  const { rows } = await pool.query<{ h_fwd_seconds: string; computed_at: string }>(
    `select h_fwd_seconds, computed_at
       from headway_states
      where route_direction_id = $1 and leader_vehicle_id = $2 and follower_vehicle_id = $3
        and h_fwd_seconds is not null
      order by computed_at desc
      limit $4`,
    [routeDirectionId, leaderVehicleId, followerVehicleId, limit]
  );
  return rows.map((row) => ({
    hFwdSeconds: Number(row.h_fwd_seconds),
    computedAt: new Date(row.computed_at).toISOString(),
  }));
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
 *
 * A CORRIDOR WITH NO MEASURED TARGET IS PRUNED HERE TOO, and that is a
 * correctness fix as much as an efficiency one. computeRouteDirectionHeadway
 * throws a 404 AppError (`no_active_policy`) for those, which the sweep
 * catches, counts as `failed` and logs a warning for - once per corridor, per
 * cycle, forever. So the one signal that means "a route this service should be
 * controlling has broken" was permanently buried under hundreds of warnings
 * about corridors that are working exactly as designed, and every one of those
 * cycles still paid for a metadata read and a policy read to reach a
 * predetermined answer. Filtering on the same MEASURED_POLICY_PREDICATE the
 * headway read uses means the sweep attempts only corridors that can actually
 * produce a reading.
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
                from route_policies p
               where p.route_direction_id = rd.id
                 and p.effective_to is null
                 and p.${MEASURED_POLICY_PREDICATE}
            )
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

export interface OpenIncidentPair extends OpenIncidentRef {
  leaderVehicleId: string;
  followerVehicleId: string;
}

/**
 * Every open incident on a route-direction, resolved back to the
 * leader/follower pair it was opened for.
 *
 * Backs `closeSupersededIncidents` in ./service.ts: the compute cycle has just
 * recomputed which pairs EXIST on this corridor, so any open incident whose
 * pair is not in that set is describing a pair that has stopped being one.
 *
 * Rows whose members do not resolve to exactly one leader and one follower are
 * returned with nulls and dropped by the caller rather than filtered out here -
 * a malformed incident is a thing to notice, not a row to silently skip in SQL.
 */
export async function listOpenIncidentPairsForRouteDirection(
  routeDirectionId: string,
  pool: Pool = getPool()
): Promise<OpenIncidentPair[]> {
  const { rows } = await pool.query<{
    id: string;
    severity: BunchingSeverity;
    leader_vehicle_id: string | null;
    follower_vehicle_id: string | null;
  }>(
    `select bi.id, bi.severity,
            max(m.vehicle_id) filter (where m.member_role = 'leader') as leader_vehicle_id,
            max(m.vehicle_id) filter (where m.member_role = 'follower') as follower_vehicle_id
       from bunching_incidents bi
       join bunching_incident_members m on m.incident_id = bi.id
      where bi.route_direction_id = $1 and bi.status <> 'closed'
      group by bi.id`,
    [routeDirectionId]
  );
  const pairs: OpenIncidentPair[] = [];
  for (const row of rows) {
    if (row.leader_vehicle_id == null || row.follower_vehicle_id == null) continue;
    pairs.push({
      id: row.id,
      severity: row.severity,
      leaderVehicleId: row.leader_vehicle_id,
      followerVehicleId: row.follower_vehicle_id,
    });
  }
  return pairs;
}

/**
 * Close every open incident whose pair has not been sampled inside
 * `maxSampleAgeSeconds`, newest-started last so a backlog drains oldest-first.
 *
 * THE BACKSTOP, not the primary path. `closeSupersededIncidents` closes a pair
 * the moment its own corridor is recomputed without it, which is precise and
 * immediate. This exists for the case that path structurally cannot reach: a
 * corridor that stops being computed AT ALL (it drops below two fresh
 * vehicles, or the service is stopped overnight). Nothing then revisits those
 * incidents, and without this they stay open forever - which is exactly how
 * this database accumulated 9,692 of them.
 *
 * Bounded by `limit` because a first run against a database that has been
 * accumulating for days has thousands of candidates, and one tick must not
 * hold the pool while ingestion is trying to use it. The sweep is idempotent,
 * so a backlog simply drains over several ticks.
 *
 * The anti-join probes `headway_states_leader_idx (leader_vehicle_id,
 * computed_at desc)`, so it is an index range scan per candidate rather than a
 * scan of the samples table - which is the largest table in the schema.
 */
export async function closeStaleOpenIncidents(
  maxSampleAgeSeconds: number,
  limit: number,
  pool: Pool = getPool()
): Promise<number> {
  const { rowCount } = await pool.query(
    `with open_pairs as (
       select bi.id,
              bi.route_direction_id,
              max(m.vehicle_id) filter (where m.member_role = 'leader') as leader_vehicle_id,
              max(m.vehicle_id) filter (where m.member_role = 'follower') as follower_vehicle_id
         from bunching_incidents bi
         join bunching_incident_members m on m.incident_id = bi.id
        where bi.status <> 'closed'
        group by bi.id
     ),
     stale as (
       select p.id
         from open_pairs p
        where p.leader_vehicle_id is not null
          and p.follower_vehicle_id is not null
          and not exists (
                select 1
                  from headway_states hs
                 where hs.leader_vehicle_id = p.leader_vehicle_id
                   and hs.computed_at > now() - ($1 || ' seconds')::interval
                   and hs.follower_vehicle_id = p.follower_vehicle_id
                   and hs.route_direction_id = p.route_direction_id
              )
        limit $2
     )
     update bunching_incidents bi
        set status = 'closed',
            ended_at = now(),
            evidence = bi.evidence || jsonb_build_object(
              'closureReason', 'evidence_went_stale',
              'closedBy', 'incidentStalenessSweep',
              'pairSampleMaxAgeSeconds', $1::int,
              'closedAt', now()
            )
       from stale
      where bi.id = stale.id`,
    [maxSampleAgeSeconds, limit]
  );
  return rowCount ?? 0;
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

/**
 * "EVERY member vehicle is still reporting, and is still on this incident's
 * own corridor" - a SQL fragment shared by listOpenIncidents and
 * countOpenIncidents so the list and the total it is reported against can
 * never disagree ("showing 12 of 30,619" would be worse than either number
 * alone).
 *
 * WHY EVERY MEMBER AND NOT JUST ONE. This clause first said "at least one
 * member has reported recently", which is the weaker half of what an incident
 * claims. Bunching is a statement about a PAIR: it is only still true if both
 * buses are still out there and still on the corridor the pair was measured
 * on. Measured on the pilot database, "at least one" let 7,504 of 9,692 undead
 * incidents straight through - the map still drew a web of links between buses
 * a median of 59 km apart, because one bus of each pair had been reassigned
 * and was reporting perfectly well from another district.
 *
 * The route-direction match is the half that catches exactly that: a bus that
 * has moved to another corridor is live, and is no longer part of this pair.
 *
 * Written as `not exists (a member that FAILS the test)` rather than a pair of
 * `exists`, so it holds for whatever members an incident has - two today,
 * a platoon of four if the detector ever opens one - without the clause having
 * to know the count.
 *
 * See INCIDENT_VEHICLE_FRESHNESS_SECONDS in src/config/env.ts for why this
 * bound exists at all, and INCIDENT_PAIR_SAMPLE_MAX_AGE_SECONDS for the sweep
 * that closes these rows properly rather than merely hiding them from a read.
 */
function incidentLivenessClause(paramIndex: number): string {
  return `and not exists (
            select 1
              from bunching_incident_members bim
              left join vehicle_states vs
                     on vs.vehicle_id = bim.vehicle_id
                    and vs.route_direction_id = bi.route_direction_id
                    and vs.observed_at > now() - ($${paramIndex} || ' seconds')::interval
             where bim.incident_id = bi.id
               and vs.vehicle_id is null
          )`;
}

/**
 * `limit`, when given, caps how many open incidents come back (most
 * recently-started first, matching the unlimited order below) - added for
 * the copilot grounding path, which folds every returned incident into an
 * LLM prompt and must not hand the model an unbounded, ever-growing table
 * (see src/lib/copilot/grounding.ts in the web app). Every other caller
 * (map/observability dashboards) omits it and keeps the original unlimited
 * behavior byte-for-byte.
 */
export async function listOpenIncidents(
  routeDirectionId: string | undefined,
  limit: number | undefined,
  pool: Pool = getPool(),
  freshnessSeconds: number = loadEnv().INCIDENT_VEHICLE_FRESHNESS_SECONDS
): Promise<BunchingIncidentRow[]> {
  const whereClause = routeDirectionId ? "and bi.route_direction_id = $1" : "";
  const params: (string | number)[] = routeDirectionId ? [routeDirectionId] : [];
  params.push(freshnessSeconds);
  const livenessClause = incidentLivenessClause(params.length);
  let limitClause = "";
  if (limit !== undefined) {
    params.push(limit);
    limitClause = `limit $${params.length}`;
  }
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
      where bi.status <> 'closed' ${whereClause} ${livenessClause}
      group by bi.id
      order by bi.started_at desc
      ${limitClause}`,
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
 * Total open (non-closed) incidents matching the same filter listOpenIncidents
 * uses, ignoring any limit - lets a limited caller state "showing N of TOTAL"
 * honestly instead of silently dropping the rest. Only called when a caller
 * actually applies a limit (see routes/headway.ts), so the unlimited default
 * path pays no extra query.
 */
export async function countOpenIncidents(
  routeDirectionId: string | undefined,
  pool: Pool = getPool(),
  freshnessSeconds: number = loadEnv().INCIDENT_VEHICLE_FRESHNESS_SECONDS
): Promise<number> {
  const whereClause = routeDirectionId ? "and bi.route_direction_id = $1" : "";
  const params: (string | number)[] = routeDirectionId ? [routeDirectionId] : [];
  params.push(freshnessSeconds);
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from bunching_incidents bi
      where bi.status <> 'closed' ${whereClause} ${incidentLivenessClause(params.length)}`,
    params
  );
  return Number(rows[0]?.count ?? 0);
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

/**
 * Route ids created by the end-to-end fixtures, which are not corridors.
 *
 * `tests/e2e/fixtures/controlServiceFixtures.ts#seedGatedRouteDirection`
 * inserts a `qa-e2e-route-<uuid8>` route per run so a command has a
 * rollout-gated route-direction to name, and nothing deletes them: a
 * long-lived database accumulates them (17 were sitting in the local control
 * database when this was written). They have never reached this list, because
 * they carry no `route_shapes` row and the join below is an inner one — but
 * that is an accident of the fixture, not a property anyone maintains, and it
 * is the only thing that has been keeping test scaffolding out of an
 * operator's corridor picker and out of every coverage count derived from it.
 *
 * Excluded explicitly so the guarantee survives a fixture that one day seeds
 * geometry too.
 */
const E2E_FIXTURE_ROUTE_PREFIX = 'qa-e2e-route-%';

export async function listActiveRouteDirections(
  pool: Pool = getPool()
): Promise<RouteDirectionListing[]> {
  const { rows } = await pool.query<{
    route_direction_id: string;
    route_id: string;
    direction_code: string;
    is_loop: boolean;
    total_distance_meters: string;
    has_active_policy: boolean;
  }>(
    // `has_active_policy` uses the SAME predicate as loadActiveRoutePolicy
    // above, deliberately: this flag's whole job is to answer, ahead of time,
    // whether GET /v1/route-directions/:id/headway will return a reading or
    // the 404 `no_active_policy` that means detection is off for that
    // corridor. If the two ever disagree, the picker starts promising
    // readings the headway endpoint then refuses to give. They shared a
    // hand-copied string and drifted anyway, so both now reference
    // MEASURED_POLICY_PREDICATE and cannot.
    `select rd.id as route_direction_id, rd.route_id, rd.direction_code, rd.is_loop,
            rs.total_distance_meters,
            exists (
              select 1 from route_policies p
               where p.route_direction_id = rd.id
                 and p.effective_to is null
                 and p.${MEASURED_POLICY_PREDICATE}
            ) as has_active_policy
       from route_directions rd
       join route_shapes rs on rs.route_direction_id = rd.id
      where rd.is_active = true
        and rd.route_id not like $1
      order by rd.route_id, rd.direction_code`,
    [E2E_FIXTURE_ROUTE_PREFIX]
  );
  return rows.map((row) => ({
    routeDirectionId: row.route_direction_id,
    routeId: row.route_id,
    directionCode: row.direction_code,
    isLoop: row.is_loop,
    totalDistanceMeters: Number(row.total_distance_meters),
    hasActivePolicy: row.has_active_policy,
  }));
}

/**
 * Recent stop occupancies for one route-direction, for the
 * departure-to-departure headway computation in `./stopHeadway.ts`.
 *
 * Ordered by departure so the caller differences consecutive rows without
 * re-sorting, and bounded by BOTH a lookback window and a row cap: a busy
 * corridor over a long window is unbounded otherwise, and this feeds a
 * dashboard read rather than a control decision.
 */
export async function listRecentStopVisits(
  routeDirectionId: string,
  lookbackHours: number,
  limit = 5000,
  pool: Pool = getPool()
): Promise<StopVisitRecord[]> {
  const { rows } = await pool.query<{
    vehicle_id: string;
    stop_id: string;
    route_direction_id: string;
    arrived_at: string;
    departed_at: string;
    trip_id: string | null;
  }>(
    `select vehicle_id, stop_id, route_direction_id, arrived_at, departed_at, trip_id
       from stop_visits
      where route_direction_id = $1
        and departed_at >= now() - ($2 || ' hours')::interval
      order by departed_at desc
      limit $3`,
    [routeDirectionId, String(lookbackHours), limit]
  );
  return rows.map((r) => ({
    vehicleId: r.vehicle_id,
    stopId: r.stop_id,
    routeDirectionId: r.route_direction_id,
    arrivedAt: r.arrived_at,
    departedAt: r.departed_at,
    tripId: r.trip_id,
  }));
}

/**
 * One row of the network-wide alert inbox.
 *
 * Distinct from `BunchingIncidentRow` on purpose. That shape backs a panel
 * inside a corridor the operator has already chosen, so it can assume the
 * corridor is known and leave it unnamed. An inbox spanning the whole network
 * cannot: an operator scanning it has chosen nothing yet, and a list of bare
 * route-direction uuids is unreadable. The route naming is the difference,
 * and it is joined here rather than resolved per-row by the caller because
 * doing it per-row is how a 40-alert list becomes 41 queries.
 */
export interface BunchingAlertRow extends BunchingIncidentRow {
  routeId: string;
  routePublicName: string;
  directionCode: string;
  directionName: string | null;
  /**
   * Seconds until the pair is forecast to reach the bunched threshold, lifted
   * out of `evidence.forecast`. Null for a reactive incident (the collapse has
   * already happened, so there is nothing to count down to) and also null for
   * a predicted one whose forecast has since gone quiet.
   */
  secondsToBunching: number | null;
  riskScore: number | null;
}

/**
 * Every open incident on the network, most urgent first.
 *
 * ─── WHY ORDERING IS THE PRODUCT HERE ────────────────────────────────────
 *
 * A per-corridor panel can order by recency because it holds a handful of
 * rows about one corridor an operator is already looking at. An inbox over
 * ~1,020 route-directions is read top-down and abandoned partway, so its
 * order IS the triage: whatever sorts first is what gets acted on, and
 * anything below the fold effectively does not exist.
 *
 * So the sort is by what an operator should do next, in three keys:
 *
 *   1. severity, worst first - a collapsed gap outranks a forecast one
 *   2. within a severity, urgency - the pair closest to its threshold first,
 *      which for predicted incidents is the shortest time-to-bunching
 *   3. recency, as the stable tiebreak
 *
 * Key 2 is the one that makes the predicted rung useful rather than merely
 * present. Twelve predicted incidents ordered by when they were opened is a
 * list in an arbitrary order; ordered by how soon each one bites, it is a
 * queue. `nulls last` puts a prediction that has gone quiet below every one
 * that still has a live countdown, which is the right place for it: it is not
 * evidence of safety, it is absence of evidence, and it should not outrank a
 * pair actively counting down.
 */
export async function listOpenAlerts(
  limit: number,
  pool: Pool = getPool(),
  freshnessSeconds: number = loadEnv().INCIDENT_VEHICLE_FRESHNESS_SECONDS
): Promise<BunchingAlertRow[]> {
  const params: (string | number)[] = [freshnessSeconds, limit];
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
    route_id: string;
    route_public_name: string;
    direction_code: string;
    direction_name: string | null;
    seconds_to_bunching: string | null;
    risk_score: string | null;
  }>(
    `select bi.id, bi.route_direction_id, bi.severity, bi.cause_class, bi.controllability,
            bi.status, bi.started_at, bi.ended_at, bi.evidence,
            rd.route_id, rd.direction_code, rd.direction_name,
            r.public_name as route_public_name,
            (bi.evidence -> 'forecast' ->> 'secondsToBunching')::numeric as seconds_to_bunching,
            (bi.evidence -> 'forecast' ->> 'riskScore')::numeric as risk_score,
            coalesce(
              json_agg(json_build_object('vehicleId', m.vehicle_id, 'role', m.member_role))
                filter (where m.vehicle_id is not null),
              '[]'
            ) as members
       from bunching_incidents bi
       join route_directions rd on rd.id = bi.route_direction_id
       join routes r on r.id = rd.route_id
       left join bunching_incident_members m on m.incident_id = bi.id
      where bi.status <> 'closed' ${incidentLivenessClause(1)}
      group by bi.id, rd.route_id, rd.direction_code, rd.direction_name, r.public_name
      order by case bi.severity
                 when 'severe' then 0
                 when 'bunched' then 1
                 when 'warning' then 2
                 when 'predicted' then 3
                 else 4
               end,
               (bi.evidence -> 'forecast' ->> 'secondsToBunching')::numeric asc nulls last,
               bi.started_at desc
      limit $2`,
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
    routeId: row.route_id,
    routePublicName: row.route_public_name,
    directionCode: row.direction_code,
    directionName: row.direction_name,
    secondsToBunching: row.seconds_to_bunching == null ? null : Number(row.seconds_to_bunching),
    riskScore: row.risk_score == null ? null : Number(row.risk_score),
  }));
}

/** Open incidents network-wide, by severity - the inbox's unread counts. */
export async function countOpenAlertsBySeverity(
  pool: Pool = getPool(),
  freshnessSeconds: number = loadEnv().INCIDENT_VEHICLE_FRESHNESS_SECONDS
): Promise<Record<string, number>> {
  const { rows } = await pool.query<{ severity: string; count: string }>(
    `select bi.severity, count(*)::text as count
       from bunching_incidents bi
      where bi.status <> 'closed' ${incidentLivenessClause(1)}
      group by bi.severity`,
    [freshnessSeconds]
  );
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.severity] = Number(row.count);
  return counts;
}
