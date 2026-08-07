// Append-only guardrail-breach log (ticket AC4). See
// control-service/db/migrations/20260806190000__pilot_rollout_and_kpi.sql
// for this ticket's scope decision: right now the only breach type written
// is 'rollout_stage_violation', from src/pilot/gate.ts.
import type { Pool, PoolClient } from 'pg';
import { getPool } from '../db/pool.js';

export interface GuardrailBreachInput {
  routeDirectionId: string | null;
  breachType: string;
  severity?: 'info' | 'warning' | 'critical';
  detail?: Record<string, unknown>;
}

export interface GuardrailBreachRow {
  id: string;
  routeDirectionId: string | null;
  breachType: string;
  severity: string;
  detail: Record<string, unknown>;
  detectedAt: string;
}

interface RawGuardrailBreachRow {
  id: string;
  route_direction_id: string | null;
  breach_type: string;
  severity: string;
  detail: Record<string, unknown>;
  detected_at: string;
}

function mapRow(row: RawGuardrailBreachRow): GuardrailBreachRow {
  return {
    id: row.id,
    routeDirectionId: row.route_direction_id,
    breachType: row.breach_type,
    severity: row.severity,
    detail: row.detail,
    detectedAt: row.detected_at,
  };
}

/** Accepts a `PoolClient` too so a caller mid-transaction (src/pilot/gate.ts, called from createCommand's own transaction) can log the breach atomically with the command rejection rather than in a separate connection. */
export async function recordGuardrailBreach(
  input: GuardrailBreachInput,
  client: Pool | PoolClient = getPool(),
): Promise<GuardrailBreachRow> {
  const { rows } = await client.query<RawGuardrailBreachRow>(
    `insert into guardrail_breach_log (route_direction_id, breach_type, severity, detail)
     values ($1, $2, $3, $4)
     returning id, route_direction_id, breach_type, severity, detail, detected_at`,
    [input.routeDirectionId, input.breachType, input.severity ?? 'warning', JSON.stringify(input.detail ?? {})],
  );
  return mapRow(rows[0]!);
}

export async function listGuardrailBreaches(
  options: { routeDirectionId?: string; limit?: number } = {},
  pool: Pool = getPool(),
): Promise<GuardrailBreachRow[]> {
  const limit = options.limit ?? 200;
  if (options.routeDirectionId) {
    const { rows } = await pool.query<RawGuardrailBreachRow>(
      `select id, route_direction_id, breach_type, severity, detail, detected_at
         from guardrail_breach_log
        where route_direction_id = $1
        order by detected_at desc
        limit $2`,
      [options.routeDirectionId, limit],
    );
    return rows.map(mapRow);
  }
  const { rows } = await pool.query<RawGuardrailBreachRow>(
    `select id, route_direction_id, breach_type, severity, detail, detected_at
       from guardrail_breach_log
      order by detected_at desc
      limit $1`,
    [limit],
  );
  return rows.map(mapRow);
}
