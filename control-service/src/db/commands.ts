// Command lifecycle against the `commands` table: persist (createCommand),
// authorize (the dispatcherActionId gate below, unchanged from before this
// ticket), TTL enforcement, deliver, ack (accept/unable/unsafe), and
// supersede (re-issue a version). The dispatcherActionId enforcement
// described in docs/CONTROL_SERVICE_INTEGRATION.md section 1 is ultimately
// a database-level guarantee: `commands.dispatcher_action_id` is NOT NULL +
// UNIQUE, and the `consume_dispatcher_action` trigger
// (control-service/db/migrations/20260805190000__core_data_model.sql)
// rejects an unknown or already-consumed id inside the same transaction as
// the insert - there is no window where a second command could reuse the
// same approval. This module maps that DB-level rejection to a structured
// AppError instead of leaking the raw Postgres error, and does the same for
// the "no conflicting commands per vehicle" and TTL-expiry guarantees added
// by control-service/db/migrations/20260806120000__command_lifecycle.sql.
import type { Pool, PoolClient } from 'pg';
import { getPool } from './pool.js';
import { setAuditContext } from './commandAudit.js';
import { AppError } from '../lib/errors.js';
import type {
  AcknowledgeCommandRequest,
  CreateCommandRequest,
  SupersedeCommandRequest,
} from '../models/schemas.js';

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
  version: number;
  supersedesCommandId: string | null;
  deliveredAt: string | null;
  acknowledgedAt: string | null;
  acknowledgementReason: string | null;
  ackOutcome: string | null;
  createdAt: string;
}

// Statuses that still count as "in flight" for the one-active-command-
// per-vehicle guarantee - must match the WHERE clause of
// commands_one_active_per_vehicle_idx exactly.
const ACTIVE_STATUSES = ['proposed', 'awaiting_approval', 'authorized', 'delivered', 'acknowledged', 'executing'];

const COMMAND_COLUMNS = `id, recommendation_id, vehicle_id, trip_id, action_type, target_stop_id,
                 parameters, dispatcher_action_id, ttl_seconds, valid_from, expires_at,
                 policy_version, status, version, supersedes_command_id, delivered_at,
                 acknowledged_at, acknowledgement_reason, ack_outcome, created_at`;

interface RawCommandRow {
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
  version: number;
  supersedes_command_id: string | null;
  delivered_at: string | null;
  acknowledged_at: string | null;
  acknowledgement_reason: string | null;
  ack_outcome: string | null;
  created_at: string;
}

function mapRow(row: RawCommandRow): CommandRow {
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
    version: row.version,
    supersedesCommandId: row.supersedes_command_id,
    deliveredAt: row.delivered_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgementReason: row.acknowledgement_reason,
    ackOutcome: row.ack_outcome,
    createdAt: row.created_at,
  };
}

interface PgErrorLike {
  code?: string;
  message: string;
}

function isPgError(err: unknown): err is PgErrorLike {
  return typeof err === 'object' && err !== null && 'message' in err;
}

/** Maps a raw pg insert/update rejection to a structured AppError; rethrows anything it doesn't recognize. */
function mapCommandWriteError(err: unknown): never {
  if (err instanceof AppError) throw err;
  if (isPgError(err)) {
    // Check the unique-violation code first: the dispatcher_action_id
    // unique constraint's own name (commands_dispatcher_action_id_key)
    // contains the substring "dispatcher_action", so checking the P0001/
    // regex branch first would misclassify it as the trigger's "invalid"
    // rejection instead of "already used". Two distinct unique
    // constraints can fire a 23505 here - tell them apart by constraint
    // name in the message.
    if (err.code === '23505') {
      if (/commands_one_active_per_vehicle_idx/.test(err.message)) {
        throw new AppError(
          'vehicle_has_active_command',
          'vehicleId already has an active (non-terminal) command in flight',
          409,
        );
      }
      throw new AppError('dispatcher_action_already_used', 'dispatcherActionId has already authorized a command', 409);
    }
    // control_service_consume_dispatcher_action() raises a plain
    // exception (SQLSTATE P0001) for "does not exist" / "already
    // consumed" - both map to the same client-facing rejection: the
    // supplied dispatcherActionId is not valid to authorize a command
    // right now.
    if (err.code === 'P0001' || /dispatcher_action/i.test(err.message)) {
      throw new AppError('dispatcher_action_invalid', err.message, 422);
    }
  }
  throw err;
}

/**
 * Persists a command. `dispatcherActionId` is required and is consumed
 * atomically by the DB trigger, so by the time this returns the command is
 * already authorized - it is inserted directly as `status = 'authorized'`
 * rather than the table's `proposed` default. That authorized state *is*
 * the "approval-required actions route to a queue and can't deliver until
 * an authorized role approves" guarantee: the command sits there, not yet
 * delivered, until something calls `deliverCommand`, which refuses to act
 * on anything not in `authorized` status. `commands_one_active_per_vehicle_idx`
 * (control-service/db/migrations/20260806120000__command_lifecycle.sql)
 * additionally guarantees this insert fails with a 23505 -> 409
 * `vehicle_has_active_command` if the vehicle already has a non-terminal
 * command outstanding, closing the "no conflicting commands per vehicle"
 * gap the advisory `listActiveVehicleIds` pre-check alone leaves open.
 */
export async function createCommand(
  input: CreateCommandRequest,
  pool: Pool = getPool(),
): Promise<CommandRow> {
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await setAuditContext(client, { actorType: 'dispatcher', reason: 'command created against an authorized dispatcher action' });

    const { rows } = await client.query<RawCommandRow>(
      `insert into commands
         (recommendation_id, vehicle_id, trip_id, action_type, target_stop_id,
          parameters, dispatcher_action_id, ttl_seconds, expires_at, policy_version, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'authorized')
       returning ${COMMAND_COLUMNS}`,
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
      await client.query('rollback');
      throw new AppError('command_insert_failed', 'Command insert returned no row', 500);
    }

    await client.query('commit');
    return mapRow(row);
  } catch (err) {
    await client.query('rollback').catch(() => {});
    mapCommandWriteError(err);
  } finally {
    client.release();
  }
}

export async function getCommandById(id: string, pool: Pool = getPool()): Promise<CommandRow | null> {
  const { rows } = await pool.query<RawCommandRow>(`select ${COMMAND_COLUMNS} from commands where id = $1`, [id]);
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/**
 * The single command a driver's device should show right now for
 * `vehicleId` (ticket: "Driver PWA ... single-instruction command
 * interface"): the most recently created `delivered` command, i.e. one
 * already handed to the driver and awaiting ack — `authorized`-but-not-yet-
 * delivered commands are dispatcher-side state the driver never sees.
 * Reuses `lockAndExpireIfDue` so a command whose TTL has lapsed is flipped
 * to `expired` and returned as `null` here rather than handed to the driver
 * stale - "auto-expiry on TTL lapse" holds for the read path, not just the
 * write paths below. `commands_one_active_per_vehicle_idx` guarantees there
 * is at most one non-terminal command per vehicle, so `delivered` here is
 * unambiguous without needing an explicit `limit 1` tiebreak in practice;
 * the `order by created_at desc limit 1` is defensive only.
 */
export async function getActiveDeliveredCommandForVehicle(
  vehicleId: string,
  pool: Pool = getPool(),
): Promise<CommandRow | null> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<{ id: string }>(
      `select id from commands
        where vehicle_id = $1 and status = 'delivered'
        order by created_at desc
        limit 1
        for update`,
      [vehicleId],
    );
    const candidate = rows[0];
    if (!candidate) {
      await client.query('commit');
      return null;
    }
    const command = await lockAndExpireIfDue(client, candidate.id);
    await client.query('commit');
    if (!command || command.status !== 'delivered') return null;
    return command;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Row-locks `id`, transitions it to `expired` in place if its TTL has
 * already passed (never leaving it in a status a caller could still act
 * on), and returns the up-to-date row. Every lifecycle mutation below
 * calls this first so an expired command can never be delivered,
 * acknowledged, or superseded - "expired commands never delivered/executed"
 * holds regardless of which caller notices the expiry first.
 */
async function lockAndExpireIfDue(client: PoolClient, id: string): Promise<CommandRow | null> {
  const { rows } = await client.query<RawCommandRow>(`select ${COMMAND_COLUMNS} from commands where id = $1 for update`, [id]);
  const existing = rows[0];
  if (!existing) return null;

  const command = mapRow(existing);
  const isPastTtl = command.status !== 'expired' && new Date(command.expiresAt).getTime() <= Date.now();
  if (!isPastTtl) return command;

  await setAuditContext(client, { actorType: 'system', reason: 'ttl_exceeded' });
  const { rows: expiredRows } = await client.query<RawCommandRow>(
    `update commands set status = 'expired' where id = $1 returning ${COMMAND_COLUMNS}`,
    [id],
  );
  return mapRow(expiredRows[0]!);
}

/**
 * Transitions `authorized` -> `delivered`. Refuses (410) a command whose
 * TTL has passed - flipping it to `expired` first if this is the first
 * caller to notice - and refuses (409) anything not currently
 * `authorized`, which is the concrete enforcement of "approval-required
 * actions ... can't deliver until an authorized role approves": there is
 * no path from `proposed`/`awaiting_approval` straight to `delivered`.
 */
export async function deliverCommand(id: string, pool: Pool = getPool()): Promise<CommandRow> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const command = await lockAndExpireIfDue(client, id);
    if (!command) {
      await client.query('rollback');
      throw new AppError('command_not_found', `command ${id} not found`, 404);
    }
    if (command.status === 'expired') {
      await client.query('commit');
      throw new AppError('command_expired', `command ${id} has expired and cannot be delivered`, 410);
    }
    if (command.status !== 'authorized') {
      await client.query('rollback');
      throw new AppError(
        'command_not_authorized',
        `command ${id} cannot be delivered from status "${command.status}"; it must be authorized (by an approved dispatcher action) first`,
        409,
      );
    }

    await setAuditContext(client, { actorType: 'system', reason: 'delivered to recipient' });
    const { rows } = await client.query<RawCommandRow>(
      `update commands set status = 'delivered', delivered_at = now() where id = $1 returning ${COMMAND_COLUMNS}`,
      [id],
    );
    await client.query('commit');
    return mapRow(rows[0]!);
  } catch (err) {
    if (!(err instanceof AppError)) {
      await client.query('rollback').catch(() => {});
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Records the driver's ack (blueprint 9.2). `accept` moves the command
 * into `executing`; `unable`/`unsafe` end its lifecycle at `failed` right
 * there. All three are written identically - `acknowledged_at` +
 * `acknowledgement_reason` + `ack_outcome` - and none of them invokes a
 * penalty: there is no scoring/penalty subsystem in this service for this
 * path to call into, by design (ticket AC: "no penalty applied for
 * unable/unsafe"). Refuses (410) an expired command and (409) anything not
 * currently `delivered` - a proposed/authorized-but-undelivered command
 * can't be acked, nor can one already acked.
 */
export async function acknowledgeCommand(
  id: string,
  input: AcknowledgeCommandRequest,
  pool: Pool = getPool(),
): Promise<CommandRow> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const command = await lockAndExpireIfDue(client, id);
    if (!command) {
      await client.query('rollback');
      throw new AppError('command_not_found', `command ${id} not found`, 404);
    }
    if (command.status === 'expired') {
      await client.query('commit');
      throw new AppError('command_expired', `command ${id} has expired and cannot be acknowledged`, 410);
    }
    if (command.status !== 'delivered') {
      await client.query('rollback');
      throw new AppError(
        'command_not_deliverable',
        `command ${id} cannot be acknowledged from status "${command.status}"; it must be delivered first`,
        409,
      );
    }

    const nextStatus = input.outcome === 'accept' ? 'executing' : 'failed';
    await setAuditContext(client, { actorType: 'driver', actorId: input.actorId, reason: input.reason ?? input.outcome });
    const { rows } = await client.query<RawCommandRow>(
      `update commands
          set status = $2, acknowledged_at = now(), acknowledgement_reason = $3, ack_outcome = $4
        where id = $1
        returning ${COMMAND_COLUMNS}`,
      [id, nextStatus, input.reason ?? null, input.outcome],
    );
    await client.query('commit');
    return mapRow(rows[0]!);
  } catch (err) {
    if (!(err instanceof AppError)) {
      await client.query('rollback').catch(() => {});
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Re-issues `id` as a new command (version + 1), cancelling the prior
 * version in the same transaction as inserting the new one so the pair
 * never violates `commands_one_active_per_vehicle_idx`. Requires its own
 * fresh, unconsumed `dispatcherActionId` - superseding is a brand new
 * command for every purpose the non-negotiable dispatcher-authorization
 * rule cares about. Only a still-in-flight command (not already
 * delivered+acked/terminal) can be superseded.
 */
export async function supersedeCommand(
  id: string,
  input: SupersedeCommandRequest,
  pool: Pool = getPool(),
): Promise<CommandRow> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const prior = await lockAndExpireIfDue(client, id);
    if (!prior) {
      await client.query('rollback');
      throw new AppError('command_not_found', `command ${id} not found`, 404);
    }
    if (prior.status === 'expired') {
      await client.query('commit');
      throw new AppError('command_expired', `command ${id} has expired and cannot be superseded`, 410);
    }
    if (!ACTIVE_STATUSES.filter((s) => s !== 'executing').includes(prior.status)) {
      await client.query('rollback');
      throw new AppError(
        'command_not_supersedable',
        `command ${id} cannot be superseded from status "${prior.status}"`,
        409,
      );
    }

    await setAuditContext(client, {
      actorType: 'dispatcher',
      actorId: input.actorId,
      reason: input.reason ?? 'superseded by a re-issued command',
    });
    await client.query(`update commands set status = 'cancelled' where id = $1`, [id]);

    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();
    const { rows } = await client.query<RawCommandRow>(
      `insert into commands
         (recommendation_id, vehicle_id, trip_id, action_type, target_stop_id,
          parameters, dispatcher_action_id, ttl_seconds, expires_at, policy_version,
          status, version, supersedes_command_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'authorized', $11, $12)
       returning ${COMMAND_COLUMNS}`,
      [
        prior.recommendationId,
        prior.vehicleId,
        prior.tripId,
        input.actionType ?? prior.actionType,
        input.targetStopId !== undefined ? input.targetStopId : prior.targetStopId,
        JSON.stringify(input.parameters ?? prior.parameters),
        input.dispatcherActionId,
        input.ttlSeconds,
        expiresAt,
        input.policyVersion ?? prior.policyVersion,
        prior.version + 1,
        prior.id,
      ],
    );
    await client.query('commit');
    return mapRow(rows[0]!);
  } catch (err) {
    if (!(err instanceof AppError)) {
      await client.query('rollback').catch(() => {});
    }
    mapCommandWriteError(err);
  } finally {
    client.release();
  }
}

/**
 * Sweeps every non-terminal command past its TTL to `expired` (see
 * `control_service_expire_commands()`,
 * control-service/db/migrations/20260806120000__command_lifecycle.sql).
 * Called on a periodic timer from src/index.ts so a command that nobody
 * happens to deliver/ack/GET still gets expired promptly rather than only
 * lazily on next access.
 */
export async function sweepExpiredCommands(pool: Pool = getPool()): Promise<CommandRow[]> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await setAuditContext(client, { actorType: 'system', reason: 'periodic ttl sweep' });
    const { rows } = await client.query<RawCommandRow>('select * from control_service_expire_commands()');
    await client.query('commit');
    return rows.map(mapRow);
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Which of `vehicleIds` currently have an active (non-terminal-status)
 * command outstanding, per `commands_one_active_per_vehicle_idx`
 * (`status in ('proposed', 'awaiting_approval', 'authorized', 'delivered',
 * 'acknowledged', 'executing')`). The decision engine's hard safety filter
 * (`src/mpc/safety.ts`) uses this to reject a new candidate for a vehicle
 * that already has a command in flight - the "conflicting active
 * commands" guardrail, now backed by a DB-level unique index rather than
 * being the only thing enforcing it. Returns an empty set (never queries)
 * for an empty input so callers don't need to special-case "no candidates
 * yet".
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
        and status = any($2)`,
    [vehicleIds, ACTIVE_STATUSES],
  );
  return new Set(rows.map((r) => r.vehicle_id));
}
