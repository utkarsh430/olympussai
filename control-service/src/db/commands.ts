// Command creation against the `commands` table. The dispatcherActionId
// enforcement described in docs/CONTROL_SERVICE_INTEGRATION.md section 1 is
// ultimately a database-level guarantee: `commands.dispatcher_action_id` is
// NOT NULL + UNIQUE, and the `consume_dispatcher_action` trigger
// (control-service/db/migrations/20260805190000__core_data_model.sql)
// rejects an unknown or already-consumed id inside the same transaction as
// the insert - there is no window where a second command could reuse the
// same approval. This module maps that DB-level rejection to a structured
// AppError instead of leaking the raw Postgres error.
import type { Pool } from 'pg';
import { getPool } from './pool.js';
import { AppError } from '../lib/errors.js';
import type { CreateCommandRequest } from '../models/schemas.js';

export interface CommandRow {
  id: string;
  recommendationId: string | null;
  vehicleId: string;
  tripId: string | null;
  actionType: string;
  targetStopId: string | null;
  parameters: Record<string, unknown>;
  dispatcherActionId: string;
  ttlSeconds: number;
  validFrom: string;
  expiresAt: string;
  policyVersion: string | null;
  status: string;
  createdAt: string;
}

interface PgErrorLike {
  code?: string;
  message: string;
}

function isPgError(err: unknown): err is PgErrorLike {
  return typeof err === 'object' && err !== null && 'message' in err;
}

export async function createCommand(
  input: CreateCommandRequest,
  pool: Pool = getPool(),
): Promise<CommandRow> {
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();

  try {
    const { rows } = await pool.query<{
      id: string;
      recommendation_id: string | null;
      vehicle_id: string;
      trip_id: string | null;
      action_type: string;
      target_stop_id: string | null;
      parameters: Record<string, unknown>;
      dispatcher_action_id: string;
      ttl_seconds: number;
      valid_from: string;
      expires_at: string;
      policy_version: string | null;
      status: string;
      created_at: string;
    }>(
      `insert into commands
         (recommendation_id, vehicle_id, trip_id, action_type, target_stop_id,
          parameters, dispatcher_action_id, ttl_seconds, expires_at, policy_version)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id, recommendation_id, vehicle_id, trip_id, action_type, target_stop_id,
                 parameters, dispatcher_action_id, ttl_seconds, valid_from, expires_at,
                 policy_version, status, created_at`,
      [
        input.recommendationId ?? null,
        input.vehicleId,
        input.tripId ?? null,
        input.actionType,
        input.targetStopId ?? null,
        JSON.stringify(input.parameters ?? {}),
        input.dispatcherActionId,
        input.ttlSeconds,
        expiresAt,
        input.policyVersion ?? null,
      ],
    );

    const row = rows[0];
    if (!row) {
      throw new AppError('command_insert_failed', 'Command insert returned no row', 500);
    }

    return {
      id: row.id,
      recommendationId: row.recommendation_id,
      vehicleId: row.vehicle_id,
      tripId: row.trip_id,
      actionType: row.action_type,
      targetStopId: row.target_stop_id,
      parameters: row.parameters,
      dispatcherActionId: row.dispatcher_action_id,
      ttlSeconds: row.ttl_seconds,
      validFrom: row.valid_from,
      expiresAt: row.expires_at,
      policyVersion: row.policy_version,
      status: row.status,
      createdAt: row.created_at,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (isPgError(err)) {
      // control_service_consume_dispatcher_action() raises a plain
      // exception (SQLSTATE P0001) for "does not exist" / "already
      // consumed" - both map to the same client-facing rejection: the
      // supplied dispatcherActionId is not valid to authorize a command
      // right now.
      if (err.code === 'P0001' || /dispatcher_action/i.test(err.message)) {
        throw new AppError('dispatcher_action_invalid', err.message, 422);
      }
      if (err.code === '23505') {
        throw new AppError('dispatcher_action_already_used', 'dispatcherActionId has already authorized a command', 409);
      }
    }
    throw err;
  }
}

/**
 * Which of `vehicleIds` currently have an active (non-terminal-status)
 * command outstanding, per `commands_active_idx`
 * (`status in ('proposed', 'awaiting_approval', 'authorized', 'delivered',
 * 'acknowledged', 'executing')`). The decision engine's hard safety filter
 * (`src/mpc/safety.ts`) uses this to reject a new candidate for a vehicle
 * that already has a command in flight - the "conflicting active
 * commands" guardrail. Returns an empty set (never queries) for an empty
 * input so callers don't need to special-case "no candidates yet".
 */
export async function listActiveVehicleIds(
  vehicleIds: string[],
  pool: Pool = getPool(),
): Promise<Set<string>> {
  if (vehicleIds.length === 0) return new Set();
  const { rows } = await pool.query<{ vehicle_id: string }>(
    `select distinct vehicle_id
       from commands
      where vehicle_id = any($1)
        and status in ('proposed', 'awaiting_approval', 'authorized', 'delivered', 'acknowledged', 'executing')`,
    [vehicleIds],
  );
  return new Set(rows.map((r) => r.vehicle_id));
}
