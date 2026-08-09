/**
 * Persistence + side effects for verified inbound control-service webhooks.
 *
 * Split out of the route handler so the transport concerns (raw bytes, HMAC,
 * status codes) and the data concerns (store-then-process, the mirror's
 * out-of-order write guard) can be read — and tested — separately.
 *
 * Backed by db/migrations/20260808120000__control_service_webhook_events.sql.
 * Node runtime only: pulls in src/lib/db/pool.ts (`pg`).
 *
 * NOTHING HERE WRITES ops_audit_log, by design. That table is for
 * human-attributed actions — `actor_user_id` is `not null references
 * ops_users (id)` behind an append-only trigger — and a control-service event
 * has no ops user behind it. `ops_control_service_webhook_events` is the
 * machine-event record instead; see the migration's header for the full
 * human -> machine join.
 */
import 'server-only';
import { getOpsPool } from '@/lib/db/pool';
import type { ControlServiceWebhookEvent, WebhookCommand } from '@/models/control';

/** SQLSTATE 42703 — a referenced column does not exist. */
const PG_UNDEFINED_COLUMN = '42703';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function pgErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export type StoreEventResult =
  /** The row is ours: this delivery is the first for its idempotency key. */
  | { inserted: true }
  /** A row already existed. `processedAt` decides whether to short-circuit or re-process. */
  | { inserted: false; processedAt: string | null };

/**
 * Store-then-process, step one: record the delivery before touching anything
 * else, so an accepted event survives a subsequent side-effect failure.
 *
 * The primary key IS the deduplication mechanism — no read-then-write race to
 * lose. Returning zero rows means "already seen"; the caller then inspects
 * `processed_at`, and a null there deliberately leads to a re-process rather
 * than a silent 200 (every side effect below is an idempotent upsert, so
 * re-running is always safe, and without that branch one transient failure
 * would swallow the event permanently — control-service has no outbox to
 * replay it from).
 */
export async function storeWebhookEvent(input: {
  idempotencyKey: string;
  eventType: string;
  commandId: string | null;
  payload: unknown;
}): Promise<StoreEventResult> {
  const pool = getOpsPool();
  const { rows } = await pool.query(
    `insert into ops_control_service_webhook_events
       (idempotency_key, event_type, command_id, payload)
     values ($1, $2, $3, $4)
     on conflict (idempotency_key) do nothing
     returning idempotency_key`,
    [
      input.idempotencyKey,
      input.eventType,
      isUuid(input.commandId) ? input.commandId : null,
      JSON.stringify(input.payload),
    ],
  );

  if (rows.length > 0) return { inserted: true };

  const existing = await pool.query(
    `select processed_at from ops_control_service_webhook_events where idempotency_key = $1 limit 1`,
    [input.idempotencyKey],
  );
  const processedAt = (existing.rows[0]?.processed_at ?? null) as string | Date | null;
  return {
    inserted: false,
    processedAt: processedAt instanceof Date ? processedAt.toISOString() : processedAt,
  };
}

/** Store-then-process, step three: every side effect succeeded. */
export async function markEventProcessed(idempotencyKey: string): Promise<void> {
  const pool = getOpsPool();
  await pool.query(
    `update ops_control_service_webhook_events
        set processed_at = now(), process_error = null, attempts = attempts + 1
      where idempotency_key = $1`,
    [idempotencyKey],
  );
}

/**
 * Store-then-process, failure path: record why and count the attempt, but
 * leave `processed_at` NULL so the sender's retry (a 500 is retryable for it)
 * takes the conflict-but-unprocessed branch and runs the side effects again.
 */
export async function markEventFailed(idempotencyKey: string, error: string): Promise<void> {
  const pool = getOpsPool();
  await pool.query(
    `update ops_control_service_webhook_events
        set process_error = $2, attempts = attempts + 1
      where idempotency_key = $1`,
    [idempotencyKey, error.slice(0, 2000)],
  );
}

/**
 * The event time a mirror write is ordered by — NEVER arrival time.
 *
 * control-service retries with backoff and does not serialize deliveries, so a
 * retried `command.delivered` can land after `command.acknowledged`. Ordering
 * by arrival would make a command visibly regress from acknowledged back to
 * delivered in the control room.
 *
 * Preference order, most to least precise:
 *   1. `command.updatedAt` — the row's own last-modified stamp. Not on
 *      control-service's CommandRow today, honoured if it ever appears.
 *   2. The event's own natural timestamp (acknowledgedAt / deliveredAt /
 *      createdAt). Sub-second and unambiguous, unlike (3).
 *   3. The verified `x-control-service-timestamp`, which is only
 *      second-resolution — hence the status-rank tiebreaker in the SQL.
 */
export function eventTimeFor(
  event: ControlServiceWebhookEvent,
  headerTimestampSeconds: number,
): string {
  const command = event.data.command;
  const candidates: Array<string | null | undefined> = [command.updatedAt];

  if (event.type === 'command.acknowledged') candidates.push(command.acknowledgedAt);
  else if (event.type === 'command.delivered') candidates.push(command.deliveredAt);
  else candidates.push(command.createdAt);

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }

  return new Date(headerTimestampSeconds * 1000).toISOString();
}

/**
 * Upserts one command into the mirror.
 *
 * The `where` clause is the whole point. `>` on event time handles the normal
 * out-of-order case; the equal-timestamps branch falls back to lifecycle rank
 * so that when two events share a second-resolution fallback timestamp, the
 * later lifecycle state still wins. Fields that only ever move forward
 * (delivered_at, acknowledged_at, ack_outcome, …) are coalesced against the
 * stored value so a winning event that happens not to carry one cannot erase
 * it.
 */
async function upsertMirror(command: WebhookCommand, lastEventAt: string): Promise<void> {
  const pool = getOpsPool();
  const dispatcherActionId = isUuid(command.dispatcherActionId) ? command.dispatcherActionId : null;

  await pool.query(
    `insert into ops_command_mirror (
       command_id, dispatcher_action_id, vehicle_id, route_direction_id, action_type,
       status, version, supersedes_command_id, ttl_seconds, expires_at,
       delivered_at, acknowledged_at, ack_outcome, acknowledgement_reason, last_event_at
     ) values (
       $1, $2, $3,
       -- route_direction_id is not on CommandRow; backfill it from the human
       -- approval this command was issued against so route-scoped reads of the
       -- mirror do not need a join.
       coalesce($4, (select route_direction_id from ops_dispatcher_actions where id = $2)),
       $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
     )
     on conflict (command_id) do update set
       dispatcher_action_id   = coalesce(excluded.dispatcher_action_id, ops_command_mirror.dispatcher_action_id),
       vehicle_id             = coalesce(excluded.vehicle_id, ops_command_mirror.vehicle_id),
       route_direction_id     = coalesce(excluded.route_direction_id, ops_command_mirror.route_direction_id),
       action_type            = coalesce(excluded.action_type, ops_command_mirror.action_type),
       status                 = excluded.status,
       version                = coalesce(excluded.version, ops_command_mirror.version),
       supersedes_command_id  = coalesce(excluded.supersedes_command_id, ops_command_mirror.supersedes_command_id),
       ttl_seconds            = coalesce(excluded.ttl_seconds, ops_command_mirror.ttl_seconds),
       expires_at             = coalesce(excluded.expires_at, ops_command_mirror.expires_at),
       delivered_at           = coalesce(excluded.delivered_at, ops_command_mirror.delivered_at),
       acknowledged_at        = coalesce(excluded.acknowledged_at, ops_command_mirror.acknowledged_at),
       ack_outcome            = coalesce(excluded.ack_outcome, ops_command_mirror.ack_outcome),
       acknowledgement_reason = coalesce(excluded.acknowledgement_reason, ops_command_mirror.acknowledgement_reason),
       last_event_at          = excluded.last_event_at
     where excluded.last_event_at > ops_command_mirror.last_event_at
        or (excluded.last_event_at = ops_command_mirror.last_event_at
            and ops_command_status_rank(excluded.status) >= ops_command_status_rank(ops_command_mirror.status))`,
    [
      command.id,
      dispatcherActionId,
      command.vehicleId,
      command.routeDirectionId ?? null,
      command.actionType,
      command.status,
      command.version ?? null,
      isUuid(command.supersedesCommandId) ? command.supersedesCommandId : null,
      command.ttlSeconds,
      command.expiresAt,
      command.deliveredAt,
      command.acknowledgedAt,
      command.ackOutcome ?? null,
      command.acknowledgementReason,
      lastEventAt,
    ],
  );
}

/**
 * Marks the command a `command.superseded` event replaced as cancelled.
 *
 * Inserts a stub row when the superseded command was never mirrored (its own
 * events may have been among the ones control-service dropped): knowing it is
 * cancelled is strictly better than having no row at all, and any later event
 * for that command with a newer event time still wins.
 */
async function cancelSupersededMirror(commandId: string, lastEventAt: string): Promise<void> {
  const pool = getOpsPool();
  await pool.query(
    `insert into ops_command_mirror (command_id, status, last_event_at)
     values ($1, 'cancelled', $2)
     on conflict (command_id) do update set
       status        = 'cancelled',
       last_event_at = excluded.last_event_at
     where excluded.last_event_at > ops_command_mirror.last_event_at
        or (excluded.last_event_at = ops_command_mirror.last_event_at
            and ops_command_status_rank('cancelled') >= ops_command_status_rank(ops_command_mirror.status))`,
    [commandId, lastEventAt],
  );
}

/**
 * Self-healing link-up for the "control-service returned 201 but this app
 * crashed before recording the command id" case.
 *
 * Only fills a gap — never rewrites an existing link, and never steals a
 * command id already claimed by another dispatcher action. Closes the loop as
 * soon as `command.created` arrives, rather than waiting for the stale-claim
 * reclaim sweep.
 *
 * `ops_dispatcher_actions.control_service_command_id` is added by migration
 * 20260808110000, which sorts before this feature's own migration. If an
 * environment somehow runs this code without that column, Postgres raises
 * 42703 — treated as "reconciliation not available here", logged, and skipped,
 * because failing the delivery would cost the far more valuable mirror write.
 */
async function reconcileDispatcherAction(command: WebhookCommand): Promise<void> {
  if (!isUuid(command.dispatcherActionId)) {
    console.warn('[control-service/webhook] command.created has a non-UUID dispatcherActionId', {
      commandId: command.id,
    });
    return;
  }

  const pool = getOpsPool();
  try {
    await pool.query(
      `update ops_dispatcher_actions
          set control_service_command_id = $1
        where id = $2
          and control_service_command_id is null
          and not exists (
            select 1 from ops_dispatcher_actions claimed
             where claimed.control_service_command_id = $1
          )`,
      [command.id, command.dispatcherActionId],
    );
  } catch (error) {
    if (pgErrorCode(error) === PG_UNDEFINED_COLUMN) {
      console.warn(
        '[control-service/webhook] ops_dispatcher_actions.control_service_command_id is missing; skipping reconciliation',
        { commandId: command.id },
      );
      return;
    }
    throw error;
  }
}

/**
 * Store-then-process, step two. Every effect is an idempotent upsert guarded
 * by event time, so running this twice for the same event is a no-op — which
 * is what makes the "duplicate row, still unprocessed, re-process it" branch
 * safe.
 */
export async function applyWebhookSideEffects(
  event: ControlServiceWebhookEvent,
  lastEventAt: string,
): Promise<void> {
  switch (event.type) {
    case 'command.created':
      // Seed the mirror as well as reconciling: a command that is created but
      // never delivered still needs a row, otherwise the past-TTL sweep for
      // non-terminal commands cannot see that it exists at all.
      await upsertMirror(event.data.command, lastEventAt);
      await reconcileDispatcherAction(event.data.command);
      return;

    case 'command.delivered':
    case 'command.acknowledged':
      // command.acknowledged is the operationally important one: it is how the
      // control room learns a driver answered UNABLE or UNSAFE without polling
      // for it (ack_outcome / acknowledgement_reason).
      await upsertMirror(event.data.command, lastEventAt);
      return;

    case 'command.superseded':
      await upsertMirror(event.data.command, lastEventAt);
      await cancelSupersededMirror(event.data.supersedesCommandId, lastEventAt);
      return;
  }
}

export interface StaleMirrorCommand {
  commandId: string;
  vehicleId: string | null;
  status: string | null;
  expiresAt: string | null;
  lastEventAt: string;
}

/**
 * Commands the mirror still believes are in flight although their TTL has
 * already elapsed — the compensating control for control-service having no
 * persistent outbox (an event it fails to deliver three times is gone, and the
 * mirror would sit on a stale status forever).
 *
 * Read-only and deliberately not a daemon: an authenticated ops route calls
 * this, then re-reads GET /v1/commands/:id for each id returned and applies
 * the authoritative state. Control-service stays the source of truth.
 */
export async function listStaleMirrorCommands(limit = 50): Promise<StaleMirrorCommand[]> {
  const pool = getOpsPool();
  const { rows } = await pool.query(
    `select command_id, vehicle_id, status, expires_at, last_event_at
       from ops_command_mirror
      where status is not null
        and status not in ('completed', 'expired', 'cancelled', 'failed')
        and expires_at is not null
        and expires_at < now()
      order by expires_at asc
      limit $1`,
    [limit],
  );

  return rows.map((row) => ({
    commandId: String(row.command_id),
    vehicleId: row.vehicle_id ?? null,
    status: row.status ?? null,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : (row.expires_at ?? null),
    lastEventAt:
      row.last_event_at instanceof Date ? row.last_event_at.toISOString() : String(row.last_event_at),
  }));
}
