// Per-route-direction rollout stage: read/write route_direction_rollout_stages,
// writing rollout_stage_audit_log in the same transaction as every change
// (ticket AC1 "admin sets a route-direction's rollout stage ... without a
// deploy", AC4 "stage changes ... audit-logged and visible without waiting
// for day-end"). This is the sole write path to the stage column - src/pilot/gate.ts
// only ever reads it.
import type { Pool } from 'pg';
import { getPool } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import type { RolloutStage, SetRolloutStageRequest } from '../models/pilotSchemas.js';

export const DEFAULT_ROLLOUT_STAGE: RolloutStage = 'observation';

export interface RolloutStageRow {
  routeDirectionId: string;
  routeId: string;
  directionCode: string;
  directionName: string | null;
  publicName: string;
  stage: RolloutStage;
  reason: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface RolloutStageAuditEntry {
  id: string;
  routeDirectionId: string;
  previousStage: string | null;
  newStage: string;
  changedBy: string;
  reason: string | null;
  createdAt: string;
}

interface RawRolloutStageRow {
  route_direction_id: string;
  route_id: string;
  direction_code: string;
  direction_name: string | null;
  public_name: string;
  stage: string | null;
  reason: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

function mapRow(row: RawRolloutStageRow): RolloutStageRow {
  return {
    routeDirectionId: row.route_direction_id,
    routeId: row.route_id,
    directionCode: row.direction_code,
    directionName: row.direction_name,
    publicName: row.public_name,
    stage: (row.stage ?? DEFAULT_ROLLOUT_STAGE) as RolloutStage,
    reason: row.reason,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

// LEFT JOIN so a route-direction with no row yet still appears, defaulted
// to 'observation' - the safest posture, and the reason a missing row is
// never treated as "unrestricted" anywhere in this module or in
// src/pilot/gate.ts.
const LIST_SQL = `
  select rd.id as route_direction_id, rd.route_id, rd.direction_code, rd.direction_name,
         r.public_name, s.stage, s.reason, s.updated_by, s.updated_at
    from route_directions rd
    join routes r on r.id = rd.route_id
    left join route_direction_rollout_stages s on s.route_direction_id = rd.id
   where rd.is_active
   order by r.public_name, rd.direction_code
`;

export async function listRolloutStages(pool: Pool = getPool()): Promise<RolloutStageRow[]> {
  const { rows } = await pool.query<RawRolloutStageRow>(LIST_SQL);
  return rows.map(mapRow);
}

export async function getRolloutStage(
  routeDirectionId: string,
  pool: Pool = getPool(),
): Promise<RolloutStageRow | null> {
  const { rows } = await pool.query<RawRolloutStageRow>(
    `select rd.id as route_direction_id, rd.route_id, rd.direction_code, rd.direction_name,
            r.public_name, s.stage, s.reason, s.updated_by, s.updated_at
       from route_directions rd
       join routes r on r.id = rd.route_id
       left join route_direction_rollout_stages s on s.route_direction_id = rd.id
      where rd.id = $1`,
    [routeDirectionId],
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/** Reads just the stage, defaulted to 'observation' for an unset or unknown route-direction — used by the hot path in src/pilot/gate.ts, which doesn't need the route metadata this module's other reads carry. */
export async function readCurrentStage(routeDirectionId: string, pool: Pool = getPool()): Promise<RolloutStage> {
  const { rows } = await pool.query<{ stage: string }>(
    `select stage from route_direction_rollout_stages where route_direction_id = $1`,
    [routeDirectionId],
  );
  return (rows[0]?.stage as RolloutStage | undefined) ?? DEFAULT_ROLLOUT_STAGE;
}

/**
 * Upserts the stage and writes one rollout_stage_audit_log row in the same
 * transaction — an admin flipping a route-direction's stage takes effect
 * for the very next POST /v1/commands (no deploy, no restart, no cache to
 * bust: src/pilot/gate.ts reads the table directly) and is immediately
 * visible via GET /v1/route-directions/:id/rollout-stage/audit.
 */
export async function setRolloutStage(
  routeDirectionId: string,
  input: SetRolloutStageRequest,
  pool: Pool = getPool(),
): Promise<RolloutStageRow> {
  const client = await pool.connect();
  try {
    await client.query('begin');

    const { rows: rdRows } = await client.query<{ id: string }>(
      `select id from route_directions where id = $1`,
      [routeDirectionId],
    );
    if (!rdRows[0]) {
      await client.query('rollback');
      throw new AppError('route_direction_not_found', `route-direction ${routeDirectionId} not found`, 404);
    }

    const { rows: previousRows } = await client.query<{ stage: string }>(
      `select stage from route_direction_rollout_stages where route_direction_id = $1 for update`,
      [routeDirectionId],
    );
    const previousStage = previousRows[0]?.stage ?? null;

    await client.query(
      `insert into route_direction_rollout_stages (route_direction_id, stage, reason, updated_by)
       values ($1, $2, $3, $4)
       on conflict (route_direction_id)
       do update set stage = excluded.stage, reason = excluded.reason, updated_by = excluded.updated_by`,
      [routeDirectionId, input.stage, input.reason ?? null, input.changedBy],
    );

    await client.query(
      `insert into rollout_stage_audit_log (route_direction_id, previous_stage, new_stage, changed_by, reason)
       values ($1, $2, $3, $4, $5)`,
      [routeDirectionId, previousStage, input.stage, input.changedBy, input.reason ?? null],
    );

    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const updated = await getRolloutStage(routeDirectionId, pool);
  if (!updated) {
    throw new AppError('route_direction_not_found', `route-direction ${routeDirectionId} not found`, 404);
  }
  return updated;
}

export async function listRolloutStageAudit(
  routeDirectionId: string,
  limit = 100,
  pool: Pool = getPool(),
): Promise<RolloutStageAuditEntry[]> {
  const { rows } = await pool.query<{
    id: string;
    route_direction_id: string;
    previous_stage: string | null;
    new_stage: string;
    changed_by: string;
    reason: string | null;
    created_at: string;
  }>(
    `select id, route_direction_id, previous_stage, new_stage, changed_by, reason, created_at
       from rollout_stage_audit_log
      where route_direction_id = $1
      order by created_at desc
      limit $2`,
    [routeDirectionId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    routeDirectionId: r.route_direction_id,
    previousStage: r.previous_stage,
    newStage: r.new_stage,
    changedBy: r.changed_by,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}
