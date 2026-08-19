/**
 * Deletes observation data once nothing needs it any more.
 *
 * WHAT THIS IS FOR. This service used to delete nothing at all. `headway_states`
 * grew by ~270,000 rows (~120 MB) a day for as long as the process ran, to
 * serve a bunching rule that reads the last THREE samples per vehicle pair
 * (`route_policies.required_samples`) and a live API that looks back 900
 * seconds. Over 99% of the table answered no query the system ever made.
 *
 * THE ONE RULE THAT MAKES THIS SAFE. A day's KPIs are computed FROM these raw
 * rows and kept in `daily_kpi_snapshots`. Delete the raw before the snapshot
 * exists and the day is unrecoverable - there is nothing left to recompute
 * from. So `headway_states` rows are only ever deleted for a
 * (route-direction, day) that ALREADY HAS a snapshot. That is a structural
 * guarantee in the `exists` clause below, not a matter of running the two jobs
 * in the right order: if the snapshot sweep is late, or failed, or has never
 * run, this sweep simply deletes nothing and tries again next hour.
 *
 * INCIDENTS THAT SOMETHING POINTS AT ARE KEPT REGARDLESS OF AGE.
 * `dispatcher_actions`, `recommendations` and `outcomes` reference incidents
 * with ON DELETE SET NULL, so deleting an incident does not fail - it quietly
 * strips the link out of an audit record that is supposed to be permanent.
 * A referenced incident is therefore retained past its window rather than
 * silently amputated from the decision it explains. These are a handful of
 * rows: real dispatcher actions, not machine-generated samples.
 */
import type { Pool } from 'pg';
import type { Env } from '../config/env.js';
import { loadEnv } from '../config/env.js';
import { getPool } from '../db/pool.js';
import { logger } from '../lib/logger.js';

export interface RetentionSweepResult {
  headwayStates: number;
  vehicleStates: number;
  incidents: number;
  /** Incidents past their window that were kept because an audit record points at them. */
  incidentsRetainedForAudit: number;
  durationMs: number;
}

/**
 * Raw headway samples whose day is already captured in daily_kpi_snapshots.
 *
 * The `exists` is the whole safety property - see this module's header. It is
 * matched on the snapshot's own (route_direction_id, snapshot_date) unique
 * key, so it is an index lookup per candidate row rather than a scan.
 */
async function pruneHeadwayStates(retentionHours: number, pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `delete from headway_states hs
      where hs.computed_at < now() - ($1 || ' hours')::interval
        and exists (
              select 1
                from daily_kpi_snapshots k
               where k.route_direction_id = hs.route_direction_id
                 and k.snapshot_date = hs.computed_at::date
            )`,
    [retentionHours],
  );
  return rowCount ?? 0;
}

/**
 * A vehicle that has not reported for this long stops being drawn. Unlike the
 * others this table is not a growth risk - it is keyed on `vehicle_id`, so a
 * new fix overwrites rather than appends and the row count is bounded by the
 * fleet - but a bus dark since last week is not live data, and it was showing
 * on the map as though it were.
 */
async function pruneVehicleStates(retentionHours: number, pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `delete from vehicle_states where observed_at < now() - ($1 || ' hours')::interval`,
    [retentionHours],
  );
  return rowCount ?? 0;
}

/**
 * "Something in the permanent record points at this incident." Shared by the
 * delete and the count it is reported alongside, so the number of rows kept
 * can never be computed from a different rule than the one that kept them.
 */
const AUDIT_REFERENCE_PREDICATE = `(
     exists (select 1 from dispatcher_actions da where da.incident_id = bi.id)
  or exists (select 1 from recommendations r where r.incident_id = bi.id)
  or exists (select 1 from outcomes o where o.incident_id = bi.id)
  or exists (select 1 from war_room_incident_reviews w where w.incident_id = bi.id)
)`;

/** Incidents past the window that an audit record still references, and so are kept. */
async function countIncidentsRetainedForAudit(retentionDays: number, pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from bunching_incidents bi
      where bi.started_at < now() - ($1 || ' days')::interval
        and ${AUDIT_REFERENCE_PREDICATE}`,
    [retentionDays],
  );
  return Number(rows[0]?.count ?? 0);
}

/** Members cascade (bunching_incident_members has ON DELETE CASCADE). */
async function pruneIncidents(retentionDays: number, pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `delete from bunching_incidents bi
      where bi.started_at < now() - ($1 || ' days')::interval
        and not ${AUDIT_REFERENCE_PREDICATE}`,
    [retentionDays],
  );
  return rowCount ?? 0;
}

export async function runRetentionSweep(
  env: Env = loadEnv(),
  pool: Pool = getPool(),
): Promise<RetentionSweepResult> {
  const startedAt = Date.now();

  // Sequential, not Promise.all: three concurrent bulk deletes against the
  // same pool would contend with the ingestion path this service exists to
  // keep running. Retention is never urgent.
  const headwayStates = await pruneHeadwayStates(env.HEADWAY_STATE_RETENTION_HOURS, pool);
  const vehicleStates = await pruneVehicleStates(env.VEHICLE_STATE_RETENTION_HOURS, pool);
  const incidentsRetainedForAudit = await countIncidentsRetainedForAudit(
    env.INCIDENT_RETENTION_DAYS,
    pool,
  );
  const incidents = await pruneIncidents(env.INCIDENT_RETENTION_DAYS, pool);

  const result: RetentionSweepResult = {
    headwayStates,
    vehicleStates,
    incidents,
    incidentsRetainedForAudit,
    durationMs: Date.now() - startedAt,
  };
  logger.info(result, 'retention sweep complete');
  return result;
}
