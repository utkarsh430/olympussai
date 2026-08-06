// Transaction-local audit context + read access for command_audit_log
// (control-service/db/migrations/20260806120000__command_lifecycle.sql).
//
// The DB trigger on `commands` is the sole writer of command_audit_log -
// it fires on every INSERT and every status-changing UPDATE, so the audit
// trail can never drift from the table it describes (a forgotten
// application-level write can't happen because there is no
// application-level write). What application code *can* attach is
// actor/reason context that isn't itself a `commands` column (who
// authorized a delivery, why a driver marked a command unsafe, ...) - it
// does that by setting three transaction-local Postgres settings
// immediately after `begin` and before the status-changing statement; the
// trigger reads them with `current_setting(..., true)` (missing -> null,
// never an error). Because these are `is_local = true` settings, they
// reset automatically at COMMIT/ROLLBACK, so a pooled connection can never
// leak one request's actor context into the next request's transaction.
import type { Pool, PoolClient } from 'pg';
import { getPool } from './pool.js';

export interface AuditContext {
  actorType: 'dispatcher' | 'driver' | 'system';
  actorId?: string | null;
  reason?: string | null;
}

/** Must be called after `begin` and before the INSERT/UPDATE it should annotate, on the same client/transaction. */
export async function setAuditContext(client: PoolClient, context: AuditContext): Promise<void> {
  await client.query(
    `select
       set_config('control_service.audit_actor_type', $1, true),
       set_config('control_service.audit_actor_id', $2, true),
       set_config('control_service.audit_reason', $3, true)`,
    [context.actorType, context.actorId ?? null, context.reason ?? null],
  );
}

export interface CommandAuditLogEntry {
  id: string;
  commandId: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string;
  actorType: string;
  actorId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

interface RawCommandAuditLogRow {
  id: string;
  command_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string;
  actor_type: string;
  actor_id: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

function mapAuditRow(row: RawCommandAuditLogRow): CommandAuditLogEntry {
  return {
    id: row.id,
    commandId: row.command_id,
    eventType: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorType: row.actor_type,
    actorId: row.actor_id,
    reason: row.reason,
    metadata: row.metadata,
    occurredAt: row.occurred_at,
  };
}

/**
 * The full, ordered transition history for one command - by design
 * sufficient on its own to reconstruct the command's entire lifecycle
 * (ticket AC), since it is the only thing that ever writes a row here.
 */
export async function listCommandAuditLog(
  commandId: string,
  pool: Pool = getPool(),
): Promise<CommandAuditLogEntry[]> {
  const { rows } = await pool.query<RawCommandAuditLogRow>(
    `select id, command_id, event_type, from_status, to_status, actor_type, actor_id, reason, metadata, occurred_at
       from command_audit_log
      where command_id = $1
      order by occurred_at asc, id asc`,
    [commandId],
  );
  return rows.map(mapAuditRow);
}
