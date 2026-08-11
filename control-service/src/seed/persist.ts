// Write a NetworkSeed into the control service's own datastore.
//
// TRANSACTION SHAPE: one transaction PER ROUTE-DIRECTION, not one giant one.
// A full harvest is ~517 route-directions; holding them all in a single lock
// window would make one malformed route an all-or-nothing failure for the
// entire network, and would keep row locks on routes/stops open for minutes.
// Per-direction transactions mean a failure costs exactly that direction,
// which is then reported and the run continues. `vehicles` is the one
// exception: it is a single bulk transaction because it has no per-route
// structure and every other table's FKs point at it.
//
// FK ORDER inside a route-direction transaction:
//   routes -> route_directions -> (route_shapes, route_policies,
//                                  route_direction_rollout_stages)
//   stops  -> route_direction_stops
//
// GEOGRAPHY: every geometry column is geography(..., 4326). Points are built
// as ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography — LONGITUDE FIRST,
// the single most common way to silently seed a PostGIS database wrong. The
// LineString goes in as WKT (also lon-lat) via ST_GeomFromText.

import type { Pool, PoolClient } from 'pg';
import { toLineStringWkt } from './geometry.js';
import type {
  NetworkSeed,
  SeedRoute,
  SeedRouteDirection,
  SeedRoutePolicy,
  SeedVehicle,
} from './harvest.js';

/** Above this, stored total_distance_meters and ST_Length(geom) have diverged. */
export const SHAPE_DRIFT_WARN_RATIO = 0.01;

export interface ShapeDriftEntry {
  routeId: string;
  directionCode: string;
  routeDirectionId: string;
  storedMeters: number;
  postgisMeters: number;
  driftRatio: number;
}

export interface DirectionFailure {
  routeId: string;
  directionCode: string;
  error: string;
}

export interface PersistResult {
  vehiclesWritten: number;
  routesWritten: number;
  directionsWritten: number;
  shapesWritten: number;
  stopsWritten: number;
  routeDirectionStopsWritten: number;
  policiesInserted: number;
  policiesUnchanged: number;
  rolloutStagesWritten: number;
  rolloutStagesPreserved: number;
  failures: DirectionFailure[];
  shapeDrift: ShapeDriftEntry[];
}

export interface PersistOptions {
  /** Roll every transaction back instead of committing. Exercises every statement. */
  dryRun?: boolean;
  /**
   * Overwrite an existing rollout stage. Default false: a stage row is only
   * ever created, never changed, so a re-seed cannot demote a route an operator
   * has promoted to 'advisory'. See upsertRolloutStage.
   */
  forceRolloutStage?: boolean;
  /** Identity stamped on route_direction_rollout_stages / its audit log. */
  updatedBy?: string;
}

function emptyResult(): PersistResult {
  return {
    vehiclesWritten: 0,
    routesWritten: 0,
    directionsWritten: 0,
    shapesWritten: 0,
    stopsWritten: 0,
    routeDirectionStopsWritten: 0,
    policiesInserted: 0,
    policiesUnchanged: 0,
    rolloutStagesWritten: 0,
    rolloutStagesPreserved: 0,
    failures: [],
    shapeDrift: [],
  };
}

export async function withTransaction<T>(
  pool: Pool,
  dryRun: boolean,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const value = await run(client);
    // A dry run still executes every statement, so constraint violations and
    // type errors surface exactly as they would on a real write — it just
    // never commits.
    await client.query(dryRun ? 'rollback' : 'commit');
    return value;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // The transaction is already dead; the original error is what matters.
    }
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// Vehicles
// ============================================================================

/**
 * Bulk-upsert the whole vehicle inventory in one transaction.
 *
 * ~9,300 rows go in as four parallel arrays through a single unnest(), rather
 * than 9,300 round trips. Existing depot/type values are only overwritten by a
 * non-null incoming value, so a bus that happens to be reporting a blank depot
 * this minute does not erase what an earlier run learned.
 */
export async function persistVehicles(
  pool: Pool,
  vehicles: readonly SeedVehicle[],
  options: PersistOptions = {},
): Promise<number> {
  if (vehicles.length === 0) return 0;

  return withTransaction(pool, options.dryRun ?? false, async (client) => {
    const { rowCount } = await client.query(
      `insert into vehicles (id, registration_number, vehicle_type, depot_name)
       select id, registration_number, vehicle_type, depot_name
         from unnest($1::text[], $2::text[], $3::text[], $4::text[])
              as t(id, registration_number, vehicle_type, depot_name)
       on conflict (id) do update
          set registration_number = excluded.registration_number,
              vehicle_type = coalesce(excluded.vehicle_type, vehicles.vehicle_type),
              depot_name = coalesce(excluded.depot_name, vehicles.depot_name)`,
      [
        vehicles.map((vehicle) => vehicle.id),
        vehicles.map((vehicle) => vehicle.registrationNumber),
        vehicles.map((vehicle) => vehicle.vehicleType),
        vehicles.map((vehicle) => vehicle.depotName),
      ],
    );
    return rowCount ?? 0;
  });
}

// ============================================================================
// One route-direction
// ============================================================================

interface DirectionWriteOutcome {
  routeDirectionId: string;
  stopsWritten: number;
  routeDirectionStopsWritten: number;
  policyInserted: boolean;
  rolloutStageWritten: boolean;
  drift: ShapeDriftEntry | null;
}

async function upsertRoute(client: PoolClient, route: SeedRoute): Promise<void> {
  // `do update` rather than `do nothing`: only `do update` reliably produces a
  // row (and therefore a RETURNING value) when the row already exists. The
  // same reasoning applies to every upsert below.
  await client.query(
    `insert into routes (id, public_name)
     values ($1, $2)
     on conflict (id) do update set public_name = excluded.public_name
     returning id`,
    [route.id, route.publicName],
  );
}

async function upsertRouteDirection(
  client: PoolClient,
  direction: SeedRouteDirection,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into route_directions (route_id, direction_code, direction_name, is_loop, is_active)
     values ($1, $2, $3, $4, true)
     on conflict (route_id, direction_code) do update
        set direction_name = excluded.direction_name,
            is_loop = excluded.is_loop,
            is_active = true
     returning id`,
    [direction.routeId, direction.directionCode, direction.directionName, direction.isLoop],
  );
  return rows[0]!.id;
}

async function upsertShape(
  client: PoolClient,
  routeDirectionId: string,
  direction: SeedRouteDirection,
): Promise<number> {
  const { rows } = await client.query<{ postgis_length: string }>(
    `insert into route_shapes (route_direction_id, geom, total_distance_meters, surveyed_at)
     values ($1, ST_GeomFromText($2, 4326)::geography, $3, now())
     on conflict (route_direction_id) do update
        set geom = excluded.geom,
            total_distance_meters = excluded.total_distance_meters,
            surveyed_at = excluded.surveyed_at
     returning ST_Length(geom) as postgis_length`,
    [routeDirectionId, toLineStringWkt(direction.shapeVertices), direction.totalDistanceMeters],
  );
  return Number(rows[0]!.postgis_length);
}

async function upsertStops(client: PoolClient, seed: NetworkSeed, direction: SeedRouteDirection): Promise<number> {
  const stopIds = direction.stops.map((stop) => stop.stopId);
  const byId = new Map(seed.stops.map((stop) => [stop.id, stop]));
  const rows = stopIds.map((id) => byId.get(id)!);

  // ST_MakePoint takes X then Y — longitude first, latitude second.
  const { rowCount } = await client.query(
    `insert into stops (id, name, geom)
     select id, name, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
       from unnest($1::text[], $2::text[], $3::double precision[], $4::double precision[])
            as t(id, name, lon, lat)
     on conflict (id) do update
        set name = excluded.name,
            geom = excluded.geom`,
    [
      rows.map((stop) => stop.id),
      rows.map((stop) => stop.name),
      rows.map((stop) => stop.lon),
      rows.map((stop) => stop.lat),
    ],
  );
  return rowCount ?? 0;
}

/**
 * DELETE-THEN-INSERT, deliberately not an upsert.
 *
 * route_direction_stops carries BOTH unique (route_direction_id, sequence) and
 * unique (route_direction_id, stop_id). If two stops swap sequence positions
 * between harvests — or a stop is dropped and the survivors re-sequence, which
 * happens on every route with a 0/0 coordinate — no `on conflict` clause can
 * resolve it: whichever row is written first collides with the other's old
 * value on the opposite constraint. Clearing the direction's rows inside the
 * same transaction is the only formulation that is correct for an arbitrary
 * permutation, and it is atomic, so no reader ever sees a half-sequenced route.
 */
async function replaceDirectionStops(
  client: PoolClient,
  routeDirectionId: string,
  direction: SeedRouteDirection,
): Promise<number> {
  await client.query('delete from route_direction_stops where route_direction_id = $1', [
    routeDirectionId,
  ]);

  const { rowCount } = await client.query(
    `insert into route_direction_stops
       (route_direction_id, stop_id, sequence, cumulative_distance_meters,
        is_control_point, hold_suitable)
     select $1, stop_id, sequence, cumulative_distance_meters, is_control_point, hold_suitable
       from unnest($2::text[], $3::int[], $4::numeric[], $5::boolean[], $6::boolean[])
            as t(stop_id, sequence, cumulative_distance_meters, is_control_point, hold_suitable)`,
    [
      routeDirectionId,
      direction.stops.map((stop) => stop.stopId),
      direction.stops.map((stop) => stop.sequence),
      direction.stops.map((stop) => stop.cumulativeDistanceMeters),
      direction.stops.map((stop) => stop.isControlPoint),
      direction.stops.map((stop) => stop.holdSuitable),
    ],
  );
  return rowCount ?? 0;
}

/**
 * Versioned policy write: close the open row only when a value actually
 * changed, then insert the replacement.
 *
 * An unconditional close-and-insert would append a new version on every run and
 * turn the history into noise. The comparison is on the five values the seeder
 * owns; anything an operator tuned by hand in the other columns is preserved by
 * simply not touching the row.
 *
 * calibration_source is one of those five, and it must be, even though it never
 * changes what the controller computes. A policy whose H* is unchanged but
 * whose provenance moved from 'default' to a real derivation is a genuinely
 * different policy — that is the run where a route stopped being silently
 * excluded from bunching detection, and it has to appear in the version
 * history. (It is also how the rows this column's migration back-filled with
 * 'default' get corrected: the value is unchanged, the label is not.)
 *
 * effective_to is clamped strictly above effective_from because the table has
 * `check (effective_to is null or effective_to > effective_from)` and now() is
 * transaction time — a row created and closed inside one transaction would
 * otherwise violate it.
 */
export interface UpsertPolicyOptions {
  /**
   * Carry the open row's kf / kb / self_equalizing_k forward instead of writing
   * the supplied ones.
   *
   * The recalibration pass (src/seed/recalibrate.ts) changes ONLY H* and its
   * provenance. Those three gains are operator-tunable and this write path is
   * versioned, so re-stamping them with the seeder's defaults would silently
   * revert a hand-tuned route on a run that was never about gains. The supplied
   * values are still used when the open row has nulls, because
   * src/mpc/twoWayHold.ts returns [] when kf or kb is null and a null there
   * degrades the route to self-equalizing control with no error anywhere.
   */
  inheritGains?: boolean;
}

/**
 * Returns the policy write outcome plus what was there before, so a caller
 * reporting on a recalibration can show the old value next to the new one
 * without a second query.
 */
export interface PolicyWriteOutcome {
  inserted: boolean;
  previous: { targetHeadwaySeconds: number; calibrationSource: string | null } | null;
}

export async function upsertRoutePolicy(
  client: PoolClient,
  routeDirectionId: string,
  policy: SeedRoutePolicy,
  options: UpsertPolicyOptions = {},
): Promise<PolicyWriteOutcome> {
  const { rows } = await client.query<{
    id: string;
    target_headway_seconds: string;
    kf: string | null;
    kb: string | null;
    self_equalizing_k: string | null;
    calibration_source: string | null;
  }>(
    `select id, target_headway_seconds, kf, kb, self_equalizing_k, calibration_source
       from route_policies
      where route_direction_id = $1
        and operating_period = 'all'
        and day_type = 'all'
        and effective_to is null
      for update`,
    [routeDirectionId],
  );

  const current = rows[0];
  const previous = current
    ? {
        targetHeadwaySeconds: Number(current.target_headway_seconds),
        calibrationSource: current.calibration_source,
      }
    : null;

  const inherit = options.inheritGains === true && current !== undefined;
  const kf = inherit && current.kf !== null ? Number(current.kf) : policy.kf;
  const kb = inherit && current.kb !== null ? Number(current.kb) : policy.kb;
  const selfEqualizingK =
    inherit && current?.self_equalizing_k != null ? Number(current.self_equalizing_k) : policy.selfEqualizingK;

  if (current) {
    const unchanged =
      Number(current.target_headway_seconds) === policy.targetHeadwaySeconds &&
      current.calibration_source === policy.calibrationSource &&
      current.kf !== null &&
      Number(current.kf) === kf &&
      current.kb !== null &&
      Number(current.kb) === kb &&
      current.self_equalizing_k !== null &&
      Number(current.self_equalizing_k) === selfEqualizingK;
    if (unchanged) return { inserted: false, previous };

    await client.query(
      `update route_policies
          set effective_to = greatest(now(), effective_from + interval '1 microsecond')
        where id = $1`,
      [current.id],
    );
  }

  // operating_period/day_type are both 'all' because that is the row
  // loadActiveRoutePolicy() prefers (it orders by
  // `(operating_period = 'all' and day_type = 'all') desc`) and the only shape
  // a seeded default can honestly claim — the feed carries no peak/off-peak or
  // weekday/weekend structure.
  //
  // kf / kb / self_equalizing_k are always written: they are nullable with no
  // column default, and src/mpc/twoWayHold.ts returns [] when kf or kb is null,
  // so a null here silently degrades the route to self-equalizing control.
  //
  // calibration_source is written explicitly rather than left to its column
  // default for the same class of reason: the default is 'default', so an
  // omitted value would silently claim every row is fabricated.
  await client.query(
    `insert into route_policies
       (route_direction_id, operating_period, day_type, target_headway_seconds,
        kf, kb, self_equalizing_k, calibration_source, created_by)
     values ($1, 'all', 'all', $2, $3, $4, $5, $6, $7)`,
    [
      routeDirectionId,
      policy.targetHeadwaySeconds,
      kf,
      kb,
      selfEqualizingK,
      policy.calibrationSource,
      'network-seeder',
    ],
  );
  return { inserted: true, previous };
}

/**
 * Guarantee a rollout-stage row exists for the direction.
 *
 * An empty route_direction_rollout_stages plus DEFAULT_ROLLOUT_STAGE =
 * 'observation' means src/pilot/gate.ts 403s every command on the route, so the
 * row is not optional — it is what makes the command path reachable at all.
 *
 * `do nothing` by default (not `do update`): re-seeding must never demote a
 * route-direction an operator has promoted to 'advisory' or beyond. Pass
 * forceRolloutStage to overwrite deliberately. An audit row is written whenever
 * the stage actually changes, mirroring src/pilot/rolloutStages.ts#setRolloutStage
 * so the two write paths leave the same trail.
 */
async function upsertRolloutStage(
  client: PoolClient,
  routeDirectionId: string,
  direction: SeedRouteDirection,
  options: PersistOptions,
): Promise<boolean> {
  const updatedBy = options.updatedBy ?? 'network-seeder';

  const { rows: existingRows } = await client.query<{ stage: string }>(
    'select stage from route_direction_rollout_stages where route_direction_id = $1 for update',
    [routeDirectionId],
  );
  const existing = existingRows[0]?.stage ?? null;

  if (existing !== null && !options.forceRolloutStage) return false;
  if (existing === direction.rolloutStage) return false;

  await client.query(
    `insert into route_direction_rollout_stages (route_direction_id, stage, reason, updated_by)
     values ($1, $2, $3, $4)
     on conflict (route_direction_id) do update
        set stage = excluded.stage,
            reason = excluded.reason,
            updated_by = excluded.updated_by`,
    [routeDirectionId, direction.rolloutStage, 'seeded from UPSRTC network harvest', updatedBy],
  );

  await client.query(
    `insert into rollout_stage_audit_log
       (route_direction_id, previous_stage, new_stage, changed_by, reason)
     values ($1, $2, $3, $4, $5)`,
    [
      routeDirectionId,
      existing,
      direction.rolloutStage,
      updatedBy,
      'seeded from UPSRTC network harvest',
    ],
  );
  return true;
}

async function persistDirection(
  pool: Pool,
  seed: NetworkSeed,
  route: SeedRoute,
  direction: SeedRouteDirection,
  options: PersistOptions,
): Promise<DirectionWriteOutcome> {
  return withTransaction(pool, options.dryRun ?? false, async (client) => {
    await upsertRoute(client, route);
    const routeDirectionId = await upsertRouteDirection(client, direction);
    const postgisMeters = await upsertShape(client, routeDirectionId, direction);
    const stopsWritten = await upsertStops(client, seed, direction);
    const routeDirectionStopsWritten = await replaceDirectionStops(client, routeDirectionId, direction);
    const policy = await upsertRoutePolicy(client, routeDirectionId, direction.policy);
    const rolloutStageWritten = await upsertRolloutStage(client, routeDirectionId, direction, options);

    // The stored total is a JS haversine running sum over the very vertices
    // PostGIS just measured, so the two should agree to rounding. They are
    // compared on every write because estimator.ts clamps to the stored total
    // while findNearestStop compares against the cumulative sums — a mismatch
    // misclassifies stop state with no other symptom.
    const driftRatio =
      direction.totalDistanceMeters > 0
        ? Math.abs(postgisMeters - direction.totalDistanceMeters) / direction.totalDistanceMeters
        : 0;

    return {
      routeDirectionId,
      stopsWritten,
      routeDirectionStopsWritten,
      policyInserted: policy.inserted,
      rolloutStageWritten,
      drift:
        driftRatio > SHAPE_DRIFT_WARN_RATIO
          ? {
              routeId: route.id,
              directionCode: direction.directionCode,
              routeDirectionId,
              storedMeters: direction.totalDistanceMeters,
              postgisMeters,
              driftRatio,
            }
          : null,
    };
  });
}

// ============================================================================
// Entry point
// ============================================================================

export interface PersistProgress {
  (event: {
    routeId: string;
    directionCode: string;
    index: number;
    total: number;
    error?: string;
  }): void;
}

export async function persistNetworkSeed(
  pool: Pool,
  seed: NetworkSeed,
  options: PersistOptions = {},
  onProgress?: PersistProgress,
): Promise<PersistResult> {
  const result = emptyResult();

  result.vehiclesWritten = await persistVehicles(pool, seed.vehicles, options);

  const flattened = seed.routes.flatMap((route) =>
    route.directions.map((direction) => ({ route, direction })),
  );
  const writtenRouteIds = new Set<string>();
  const writtenStopIds = new Set<string>();

  for (const [index, { route, direction }] of flattened.entries()) {
    try {
      const outcome = await persistDirection(pool, seed, route, direction, options);
      writtenRouteIds.add(route.id);
      for (const stop of direction.stops) writtenStopIds.add(stop.stopId);

      result.directionsWritten += 1;
      result.shapesWritten += 1;
      result.routeDirectionStopsWritten += outcome.routeDirectionStopsWritten;
      if (outcome.policyInserted) result.policiesInserted += 1;
      else result.policiesUnchanged += 1;
      if (outcome.rolloutStageWritten) result.rolloutStagesWritten += 1;
      else result.rolloutStagesPreserved += 1;
      if (outcome.drift) result.shapeDrift.push(outcome.drift);

      onProgress?.({
        routeId: route.id,
        directionCode: direction.directionCode,
        index: index + 1,
        total: flattened.length,
      });
    } catch (error) {
      // One bad route-direction must never abort the run — that is the whole
      // reason each one gets its own transaction.
      const message = error instanceof Error ? error.message : String(error);
      result.failures.push({
        routeId: route.id,
        directionCode: direction.directionCode,
        error: message,
      });
      onProgress?.({
        routeId: route.id,
        directionCode: direction.directionCode,
        index: index + 1,
        total: flattened.length,
        error: message,
      });
    }
  }

  result.routesWritten = writtenRouteIds.size;
  result.stopsWritten = writtenStopIds.size;
  return result;
}
