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
import { assertRolloutStageAllowsCommand } from '../pilot/gate.js';
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
  valid_from: string | Date;
  expires_at: string | Date;
  policy_version: string | null;
  status: string;
  version: number;
  supersedes_command_id: string | null;
  delivered_at: string | Date | null;
  acknowledged_at: string | Date | null;
  acknowledgement_reason: string | null;
  ack_outcome: string | null;
  created_at: string | Date;
}

/**
 * Normalize a timestamptz column to an ISO-8601 string.
 *
 * `node-postgres` parses timestamptz into a JS `Date`, but RawCommandRow
 * declares these columns as `string` — a type assertion at the driver
 * boundary that TypeScript cannot verify, so the lie compiles and every
 * consumer downstream believes it has a string.
 *
 * JSON.stringify hides it (Date serializes to ISO), so the webhook BODY was
 * always correct. String interpolation does not, and that is where it bit:
 * `${command.acknowledgedAt}` in routes/commands.ts produced a webhook
 * idempotency key of
 *   <id>:ack:Sun Aug 09 2026 23:00:52 GMT-0400 (Eastern Daylight Time)
 * instead of `<id>:ack:<iso>`. That key is Date.prototype.toString() — it
 * embeds the SENDER'S LOCAL TIMEZONE, so the same logical event emitted from
 * two instances in different zones, or from one instance after a TZ change,
 * dedupes as two distinct events. Observed live in ops_control_service_
 * webhook_events, which recorded both spellings for a single acknowledgement.
 *
 * Converting here makes the declared types true for every consumer at once,
 * rather than patching each interpolation site as it is discovered.
 */
function toIso(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
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
    // Non-null in the schema, so the `?? ''` is unreachable in practice; it
    // exists only to satisfy the non-nullable field types without a cast.
    validFrom: toIso(row.valid_from) ?? '',
    expiresAt: toIso(row.expires_at) ?? '',
    policyVersion: row.policy_version,
    status: row.status,
    version: row.version,
    supersedesCommandId: row.supersedes_command_id,
    deliveredAt: toIso(row.delivered_at),
    acknowledgedAt: toIso(row.acknowledged_at),
    acknowledgementReason: row.acknowledgement_reason,
    ackOutcome: row.ack_outcome,
    createdAt: toIso(row.created_at) ?? '',
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
    // Foreign-key violations. MUST be checked BEFORE the P0001 branch
    // below: that branch also fires on any message merely *containing*
    // "dispatcher_action", and a 23503 on `dispatcher_actions_vehicle_id_fkey`
    // (raised while mirroring an inline approval) does exactly that. Getting
    // the order wrong reports "your approval is invalid" for what is really
    // "that vehicle isn't in this service's fleet yet".
    //
    // Before this branch existed both of these fell through to the raw
    // rethrow at the bottom, i.e. an opaque 500 for what is squarely a
    // caller-supplied-id problem.
    if (err.code === '23503') {
      if (/route_direction_id_fkey/.test(err.message)) {
        throw new AppError(
          'unknown_route_direction',
          'routeDirectionId does not reference a route-direction known to this service',
          422,
        );
      }
      if (/vehicle_id_fkey/.test(err.message)) {
        throw new AppError('unknown_vehicle', 'vehicleId does not reference a vehicle known to this service', 422);
      }
      // Any other FK on this write path (e.g. incident_id, trip_id,
      // target_stop_id, recommendation_id) is the same class of problem:
      // the caller named something this service has never heard of. A 422
      // naming the constraint beats an opaque 500 for every one of them.
      throw new AppError('unknown_reference', `a referenced id does not exist in this service: ${err.message}`, 422);
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
 *
 * If `input.dispatcherAction` is present it is mirrored into
 * `dispatcher_actions` first, inside this same transaction — see the block
 * below. That is the bridge that lets a human approval recorded in the WEB
 * app's own datastore authorize a command here, which nothing could do
 * before: no code path in this service ever inserted a `dispatcher_actions`
 * row, so the trigger could only ever reject.
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

    // Mirror the caller's own human approval into this service's
    // dispatcher_actions, in this transaction, BEFORE both the rollout gate
    // (which SELECTs this exact row on this same client, so it has to be
    // visible by then) and the insert into `commands` (whose BEFORE INSERT
    // trigger locks and consumes it).
    //
    // `do nothing`, deliberately NOT `do update`: a retry must never rewrite
    // the terms of an approval that already exists. If the row is there and
    // already consumed, the trigger raises P0001 and mapCommandWriteError
    // turns it into the correct client-facing rejection — which is exactly
    // the behaviour that makes a retried dispatch safe.
    if (input.dispatcherAction) {
      const action = input.dispatcherAction;
      await client.query(
        `insert into dispatcher_actions
           (id, dispatcher_id, action_type, route_direction_id, vehicle_id, incident_id, reason, authorized_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do nothing`,
        [
          action.id,
          action.dispatcherId,
          action.actionType,
          action.routeDirectionId,
          action.vehicleId ?? null,
          action.incidentId ?? null,
          action.reason,
          action.authorizedAt,
        ],
      );
    }

    // Pilot-staging rollout gate (ticket: "Pilot-staging dashboard with
    // per-route rollout gates ..."): reads the route-direction's current
    // stage inside this transaction and throws (with its own guardrail-
    // breach record already durably written) if the stage is
    // 'observation'/'shadow' — no command may be issued at all yet.
    await assertRolloutStageAllowsCommand(client, input, pool);

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
 * The command (if any) a given dispatcher action authorized. One indexed
 * lookup — `commands.dispatcher_action_id` is already UNIQUE, so this can
 * never return more than one row.
 *
 * This is the reconciliation primitive for the one failure the caller cannot
 * otherwise resolve: this service commits a command and returns 201, but the
 * caller never sees the response (timeout, crash, dropped connection). On
 * retry the caller re-sends the same dispatcherActionId, gets the 409
 * `dispatcher_action_already_used` the UNIQUE constraint produces, and needs
 * some way to learn WHICH command it already created rather than guessing or
 * — far worse — issuing a second one. This is that way.
 */
export async function getCommandByDispatcherActionId(
  dispatcherActionId: string,
  pool: Pool = getPool(),
): Promise<CommandRow | null> {
  const { rows } = await pool.query<RawCommandRow>(
    `select ${COMMAND_COLUMNS} from commands where dispatcher_action_id = $1`,
    [dispatcherActionId],
  );
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

    // Same pilot-staging rollout gate as createCommand — superseding is a
    // brand-new command in every sense the dispatcher-authorization rule
    // cares about, so it must not bypass the stage gate either.
    await assertRolloutStageAllowsCommand(
      client,
      { dispatcherActionId: input.dispatcherActionId, vehicleId: prior.vehicleId, actionType: input.actionType ?? prior.actionType },
      pool,
    );

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
 * Sweeps every `executing` command whose ACTION HAS FINISHED to `completed`
 * (see `control_service_complete_finished_commands()`,
 * control-service/db/migrations/20260907093000__command_completion.sql).
 *
 * The mirror of `sweepExpiredCommands` above, and the two never contend for a
 * row: `control_service_expire_commands()` covers every non-terminal status
 * EXCEPT `executing`, this covers `executing` and nothing else.
 *
 * WHY IT EXISTS. `executing` is inside `commands_one_active_per_vehicle_idx`,
 * and nothing in this service ever wrote `completed` - so a command a driver
 * ACCEPTED had no exit from `executing` at all and held its vehicle's slot on
 * that unique index permanently. Measured on the live control database
 * 2026-09-06: four `executing` rows, all `ack_outcome = 'accept'`, aged 24-26
 * days and past their own `expires_at` by the same margin; the only
 * non-terminal rows in the database past their TTL, because the TTL sweep
 * structurally cannot reach them.
 *
 * "Finished" is defined in SQL, in the migration, and it is the whole fix:
 * `acknowledged_at + parameters.holdSeconds` capped at `expires_at` when the
 * action states a duration, and `expires_at` alone when it does not. Ack is
 * the START of the action and never frees the slot on its own; `expired` is
 * not reused for an accepted command, because it means "the driver never did
 * it" and would record a served hold as unserved.
 *
 * Gated in the scheduler by `COMMAND_COMPLETION_SWEEP_ENABLED` (default
 * false). Nothing else calls it, so with that flag off this function never
 * runs and no command status changes.
 */
export async function sweepCompletedCommands(pool: Pool = getPool()): Promise<CommandRow[]> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await setAuditContext(client, { actorType: 'system', reason: 'action finished' });
    const { rows } = await client.query<RawCommandRow>('select * from control_service_complete_finished_commands()');
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
 * Ids of commands sitting in `authorized`, not yet expired, oldest first -
 * the candidate set for `commandDeliverySweep`
 * (control-service/src/scheduler/commandDeliverySweep.ts). A command only
 * lingers here after the inline delivery attempt in createCommand/
 * supersedeCommand's callers failed or never ran (a crash between commit
 * and delivery) - this is the backstop that lets those self-heal without
 * waiting for a human to notice. `expires_at > now()` is a plain filter,
 * not `lockAndExpireIfDue`: a row already past its TTL is commandTtlSweep's
 * job, not this one's - the two candidate sets are disjoint by construction
 * (this one requires `expires_at > now()`, commandTtlSweep's requires the
 * opposite), so a command is never simultaneously due for both.
 */
export async function listCommandsAwaitingDelivery(limit: number, pool: Pool = getPool()): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from commands where status = 'authorized' and expires_at > now() order by created_at asc limit $1`,
    [limit],
  );
  return rows.map((r) => r.id);
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
/**
 * Vehicles issued any command within the last `cooldownSeconds`.
 *
 * The cooldown's whole purpose is to stop the controller talking to the same
 * driver over and over, so it counts EVERY command regardless of how it
 * ended - a hold the driver declined, or one that expired unacknowledged,
 * still consumed their attention and still means the next instruction
 * arrives too soon. Filtering to successful commands would make a rejected
 * instruction free, which is the opposite of true.
 *
 * Distinct from `listActiveVehicleIds`, which asks whether an instruction is
 * still IN FLIGHT. That is a conflict; this is a rate limit.
 */
export async function listRecentlyCommandedVehicleIds(
  vehicleIds: string[],
  cooldownSeconds: number,
  pool: Pool = getPool(),
): Promise<Set<string>> {
  if (vehicleIds.length === 0 || cooldownSeconds <= 0) return new Set();
  const { rows } = await pool.query<{ vehicle_id: string }>(
    `select distinct vehicle_id
       from commands
      where vehicle_id = any($1)
        and created_at > now() - ($2 || ' seconds')::interval`,
    [vehicleIds, String(cooldownSeconds)],
  );
  return new Set(rows.map((r) => r.vehicle_id));
}

/**
 * How many alighting-only instructions this corridor has ISSUED in a window.
 *
 * The meter behind the refusal tripwire in `mpc/boardingLimit.ts`. Three
 * things about it a reader has to know, because each is a place the number
 * could be mistaken for something it is not:
 *
 *  - It counts INSTRUCTIONS, not people. Nobody counts the people a bus
 *    refuses: `headway/deniedBoarding.ts` returns "cannot say" on every visit
 *    on this deployment, for want of an occupancy feed and a fitted dwell
 *    model. So the unit here is "one bus told to take nobody on at one stop",
 *    which is the finest grain that is actually measured. A bound expressed in
 *    passengers would be a bound on a number this system cannot read.
 *
 *  - It counts every status, including `expired` and `cancelled`. An expired
 *    command may never have reached a driver, so this OVER-counts, and that is
 *    the deliberate direction: a harm bound that errs must err toward tripping
 *    early. Filtering to delivered commands would make an instruction that
 *    failed on the way to the driver free, and the tripwire would then be
 *    loosest exactly when the delivery path was least healthy.
 *
 *  - The corridor comes from the APPROVAL, not from the command. `commands`
 *    has no route_direction_id (it is keyed to a vehicle), and a vehicle can be
 *    reassigned; `dispatcher_actions.route_direction_id` records the corridor
 *    the human was actually deciding about. The join is on a primary key and
 *    `dispatcher_action_id` is `not null unique`, so this cannot double-count.
 */
export async function countBoardingLimitCommands(
  routeDirectionId: string,
  windowSeconds: number,
  pool: Pool = getPool(),
): Promise<number> {
  if (windowSeconds <= 0) return 0;
  const { rows } = await pool.query<{ refusals: string }>(
    `select count(*) as refusals
       from commands c
       join dispatcher_actions da on da.id = c.dispatcher_action_id
      where c.action_type = 'boarding_limit'
        and da.route_direction_id = $1
        and c.created_at > now() - ($2 || ' seconds')::interval`,
    [routeDirectionId, String(windowSeconds)],
  );
  return Number(rows[0]?.refusals ?? 0);
}

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
