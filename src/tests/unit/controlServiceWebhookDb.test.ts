// @vitest-environment node
//
// Postgres-backed proof of the two guarantees that live in SQL rather than in
// TypeScript, and which a mocked pool therefore cannot actually establish:
//
//   1. ON CONFLICT (idempotency_key) DO NOTHING is the deduplication
//      mechanism — there is no read-then-write race to lose.
//   2. The mirror's write guard orders by EVENT time, so a `command.delivered`
//      retry landing after `command.acknowledged` cannot regress the row.
//
// src/tests/unit/controlServiceWebhook.test.ts asserts the handler EMITS these
// statements with the right binds; this file asserts Postgres actually behaves
// the way the statements claim. Both are needed: the first would still pass if
// the SQL were subtly wrong, the second would still pass if the handler never
// called it.
//
// Requires db/migrations/20260808120000__control_service_webhook_events.sql to
// have been applied:
//   OPS_DATABASE_URL=postgres://... pnpm migrate:ops
//
// SKIPPED, not failed, when OPS_DATABASE_URL is unset LOCALLY - the rest of
// the suite must stay runnable with no Postgres, matching how
// tests/e2e/pilot-driver-command.spec.ts gates on its own env. IN CI IT IS
// NOT OPTIONAL - see the hard-fail guard below.
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TEST_SECRET, buildCommand, buildSignedDelivery } from '@/tests/helpers/controlServiceWebhook';

const HAS_OPS_DB = Boolean(process.env.OPS_DATABASE_URL?.trim());

/** CI-ONLY hard failure on a missing database - see src/tests/unit/opsBreakdownReportsPaginationDb.test.ts's guard for the full rationale (this file skipped on every CI run for the same reason). */
if (process.env.CI === 'true' && !HAS_OPS_DB) {
  throw new Error(
    'CI=true but OPS_DATABASE_URL is unset. In CI this suite must RUN, never skip ' +
      '(.github/workflows/ci-web.yml provisions the ops-db service for it). ' +
      'Locally, leave CI unset and it skips as before.',
  );
}

const WEBHOOK_URL = 'http://localhost:3000/api/control-service/webhook';

/** Command ids minted per run, so a re-run never collides with its own leftovers. */
const createdCommandIds: string[] = [];
const createdIdempotencyKeys: string[] = [];

function newCommandId(): string {
  const id = randomUUID();
  createdCommandIds.push(id);
  return id;
}

async function deliver(input: {
  type: string;
  idempotencyKey: string;
  data: Record<string, unknown>;
  timestampSeconds?: number;
}): Promise<Response> {
  createdIdempotencyKeys.push(input.idempotencyKey);
  const { rawBody, headers } = buildSignedDelivery(input);
  const { POST } = await import('@/app/api/control-service/webhook/route');
  return POST(new NextRequest(WEBHOOK_URL, { method: 'POST', headers: new Headers(headers), body: rawBody }));
}

async function mirrorRow(commandId: string): Promise<Record<string, unknown> | null> {
  const { getOpsPool } = await import('@/lib/db/pool');
  const { rows } = await getOpsPool().query('select * from ops_command_mirror where command_id = $1', [
    commandId,
  ]);
  return rows[0] ?? null;
}

async function eventRow(idempotencyKey: string): Promise<Record<string, unknown> | null> {
  const { getOpsPool } = await import('@/lib/db/pool');
  const { rows } = await getOpsPool().query(
    'select * from ops_control_service_webhook_events where idempotency_key = $1',
    [idempotencyKey],
  );
  return rows[0] ?? null;
}

describe.skipIf(!HAS_OPS_DB)('control-service webhook — against a real ops Postgres', () => {
  beforeAll(async () => {
    const { getOpsPool } = await import('@/lib/db/pool');
    // Fail loudly rather than silently green if the migration is not applied.
    const { rows } = await getOpsPool().query(
      `select table_name from information_schema.tables
        where table_name in ('ops_control_service_webhook_events', 'ops_command_mirror')`,
    );
    if (rows.length !== 2) {
      throw new Error(
        'ops_control_service_webhook_events / ops_command_mirror are missing. Run: OPS_DATABASE_URL=... pnpm migrate:ops',
      );
    }
  });

  beforeEach(() => {
    process.env.CONTROL_SERVICE_WEBHOOK_SECRET = TEST_SECRET;
  });

  afterAll(async () => {
    const { getOpsPool } = await import('@/lib/db/pool');
    const pool = getOpsPool();
    if (createdCommandIds.length > 0) {
      await pool.query('delete from ops_command_mirror where command_id = any($1::uuid[])', [createdCommandIds]);
    }
    if (createdIdempotencyKeys.length > 0) {
      await pool.query('delete from ops_control_service_webhook_events where idempotency_key = any($1::text[])', [
        createdIdempotencyKeys,
      ]);
    }
    // The pool is process-wide and would otherwise keep vitest alive.
    await pool.end();
    delete process.env.CONTROL_SERVICE_WEBHOOK_SECRET;
  });

  it('lands a command.acknowledged in the mirror with its ack outcome', async () => {
    const id = newCommandId();
    const acknowledgedAt = '2026-08-08T06:00:45.000Z';
    const response = await deliver({
      type: 'command.acknowledged',
      idempotencyKey: `${id}:ack:${acknowledgedAt}`,
      data: {
        command: buildCommand({
          id,
          status: 'acknowledged',
          acknowledgedAt,
          ackOutcome: 'unsafe',
          acknowledgementReason: 'level crossing closed',
        }),
      },
    });

    expect(response.status).toBe(200);
    const row = await mirrorRow(id);
    expect(row).not.toBeNull();
    expect(row?.status).toBe('acknowledged');
    expect(row?.ack_outcome).toBe('unsafe');
    expect(row?.acknowledgement_reason).toBe('level crossing closed');
    expect((row?.last_event_at as Date).toISOString()).toBe(acknowledgedAt);
  });

  it('does NOT regress the mirror when a delivered retry lands after the acknowledgement', async () => {
    // The out-of-order case, for real. control-service retries with backoff
    // and does not serialize deliveries, so this ordering genuinely happens;
    // arrival-ordered last-write-wins would show the command flipping back to
    // `delivered` in the control room.
    const id = newCommandId();
    const deliveredAt = '2026-08-08T06:00:10.000Z';
    const acknowledgedAt = '2026-08-08T06:00:45.000Z';

    const ack = await deliver({
      type: 'command.acknowledged',
      idempotencyKey: `${id}:ack:${acknowledgedAt}`,
      data: {
        command: buildCommand({ id, status: 'acknowledged', deliveredAt, acknowledgedAt, ackOutcome: 'accept' }),
      },
    });
    expect(ack.status).toBe(200);

    // ... and only now does the retried `delivered` arrive.
    const late = await deliver({
      type: 'command.delivered',
      idempotencyKey: `${id}:delivered:v1`,
      data: { command: buildCommand({ id, status: 'delivered', deliveredAt, acknowledgedAt: null }) },
    });
    // Still a 200: the event was accepted and recorded, it simply lost the
    // ordering contest. Answering 5xx would make the sender retry forever.
    expect(late.status).toBe(200);

    const row = await mirrorRow(id);
    expect(row?.status).toBe('acknowledged');
    expect(row?.ack_outcome).toBe('accept');
    expect((row?.last_event_at as Date).toISOString()).toBe(acknowledgedAt);
    // The older event's own facts are still preserved where they do not conflict.
    expect((row?.delivered_at as Date).toISOString()).toBe(deliveredAt);
  });

  it('advances the mirror when the events arrive in order', async () => {
    const id = newCommandId();
    const createdAt = '2026-08-08T07:00:00.000Z';
    const deliveredAt = '2026-08-08T07:00:10.000Z';
    const acknowledgedAt = '2026-08-08T07:00:45.000Z';

    await deliver({
      type: 'command.created',
      idempotencyKey: id,
      data: { command: buildCommand({ id, status: 'authorized', createdAt, deliveredAt: null }) },
    });
    expect((await mirrorRow(id))?.status).toBe('authorized');

    await deliver({
      type: 'command.delivered',
      idempotencyKey: `${id}:delivered:v1`,
      data: { command: buildCommand({ id, status: 'delivered', createdAt, deliveredAt }) },
    });
    expect((await mirrorRow(id))?.status).toBe('delivered');

    await deliver({
      type: 'command.acknowledged',
      idempotencyKey: `${id}:ack:${acknowledgedAt}`,
      data: {
        command: buildCommand({ id, status: 'acknowledged', createdAt, deliveredAt, acknowledgedAt, ackOutcome: 'accept' }),
      },
    });
    const row = await mirrorRow(id);
    expect(row?.status).toBe('acknowledged');
    expect((row?.last_event_at as Date).toISOString()).toBe(acknowledgedAt);
  });

  it('breaks an event-time tie by lifecycle rank, never by arrival', async () => {
    // Both events fall back to the same second-resolution timestamp (neither
    // carries its own natural stamp). Arrival order would say "delivered
    // wins"; lifecycle rank says acknowledged does.
    //
    // The header timestamp must be a LIVE clock reading, unlike the fixed
    // payload stamps elsewhere in this file: this is the one case whose event
    // time comes from the header, and the handler rejects anything more than
    // 300s from now as STALE_TIMESTAMP.
    const id = newCommandId();
    const stamp = Math.floor(Date.now() / 1000);
    const noStamps = { deliveredAt: null, acknowledgedAt: null, createdAt: undefined };

    await deliver({
      type: 'command.acknowledged',
      idempotencyKey: `${id}:ack:tie`,
      data: { command: buildCommand({ id, status: 'acknowledged', ...noStamps }) },
      timestampSeconds: stamp,
    });
    await deliver({
      type: 'command.delivered',
      idempotencyKey: `${id}:delivered:tie`,
      data: { command: buildCommand({ id, status: 'delivered', ...noStamps }) },
      timestampSeconds: stamp,
    });

    expect((await mirrorRow(id))?.status).toBe('acknowledged');
  });

  it('deduplicates a replayed delivery in Postgres and leaves the mirror untouched', async () => {
    const id = newCommandId();
    const acknowledgedAt = '2026-08-08T09:00:45.000Z';
    const key = `${id}:ack:${acknowledgedAt}`;
    const payload = {
      type: 'command.acknowledged',
      idempotencyKey: key,
      data: {
        command: buildCommand({ id, status: 'acknowledged', acknowledgedAt, ackOutcome: 'unable' }),
      },
    };

    expect((await deliver(payload)).status).toBe(200);
    const first = await mirrorRow(id);
    const firstEvent = await eventRow(key);
    expect(firstEvent?.processed_at).not.toBeNull();
    expect(firstEvent?.attempts).toBe(1);

    // The sender re-delivers (its 5s timeout fired even though we answered).
    const replay = await deliver(payload);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ duplicate: true });

    const second = await mirrorRow(id);
    expect(second).toEqual(first);
    // Exactly one event row, and its attempt count did not move: the duplicate
    // short-circuited before any side effect.
    expect((await eventRow(key))?.attempts).toBe(1);
  });

  it('re-processes a stored-but-unprocessed duplicate instead of swallowing it', async () => {
    const { getOpsPool } = await import('@/lib/db/pool');
    const id = newCommandId();
    const acknowledgedAt = '2026-08-08T10:00:45.000Z';
    const key = `${id}:ack:${acknowledgedAt}`;
    const payload = {
      type: 'command.acknowledged',
      idempotencyKey: key,
      data: {
        command: buildCommand({ id, status: 'acknowledged', acknowledgedAt, ackOutcome: 'accept' }),
      },
    };

    await deliver(payload);

    // Simulate the state a side-effect failure leaves behind: the event row
    // exists but processed_at is null, and the mirror write never happened.
    await getOpsPool().query(
      `update ops_control_service_webhook_events
          set processed_at = null, process_error = 'simulated transient failure'
        where idempotency_key = $1`,
      [key],
    );
    await getOpsPool().query('delete from ops_command_mirror where command_id = $1', [id]);
    expect(await mirrorRow(id)).toBeNull();

    // The sender's retry must repair this, not short-circuit on the duplicate.
    const retry = await deliver(payload);
    expect(retry.status).toBe(200);
    expect(await retry.json()).not.toMatchObject({ duplicate: true });
    expect((await mirrorRow(id))?.ack_outcome).toBe('accept');

    const repaired = await eventRow(key);
    expect(repaired?.processed_at).not.toBeNull();
    expect(repaired?.process_error).toBeNull();
  });

  it('cancels the replaced command on command.superseded', async () => {
    const oldId = newCommandId();
    const newId = newCommandId();

    await deliver({
      type: 'command.delivered',
      idempotencyKey: `${oldId}:delivered:v1`,
      data: {
        command: buildCommand({ id: oldId, status: 'delivered', deliveredAt: '2026-08-08T11:00:10.000Z' }),
      },
    });
    expect((await mirrorRow(oldId))?.status).toBe('delivered');

    await deliver({
      type: 'command.superseded',
      idempotencyKey: `${newId}:superseded`,
      data: {
        command: buildCommand({
          id: newId,
          status: 'authorized',
          supersedesCommandId: oldId,
          deliveredAt: null,
          createdAt: '2026-08-08T11:05:00.000Z',
        }),
        supersedesCommandId: oldId,
      },
    });

    expect((await mirrorRow(oldId))?.status).toBe('cancelled');
    const replacement = await mirrorRow(newId);
    expect(replacement?.status).toBe('authorized');
    expect(replacement?.supersedes_command_id).toBe(oldId);
  });

  it('stores an unknown event type verbatim without touching the mirror', async () => {
    const id = newCommandId();
    const key = `${id}:escalated`;
    const response = await deliver({
      type: 'command.escalated',
      idempotencyKey: key,
      data: { command: buildCommand({ id }) },
    });

    expect(response.status).toBe(200);
    const stored = await eventRow(key);
    expect(stored?.event_type).toBe('command.escalated');
    expect(stored?.command_id).toBe(id);
    // The full envelope is retained: control-service has no outbox, so this is
    // the only durable copy from which the event could ever be replayed.
    expect((stored?.payload as { type: string }).type).toBe('command.escalated');
    expect(stored?.processed_at).not.toBeNull();
    expect(await mirrorRow(id)).toBeNull();
  });

  it('never writes ops_audit_log', async () => {
    // SCOPED TO THIS COMMAND, NOT A GLOBAL ROW COUNT. This used to compare
    // `count(*)` on the whole table before and after, which silently assumed
    // no other test file writes an audit row while this one runs. Vitest runs
    // files in parallel and another Postgres-backed suite now does exactly
    // that (opsSupabaseBackfillApplyDb.test.ts), so the global count was a
    // race waiting to fire. Any audit row this delivery could have written
    // would necessarily reference the command it processed, so scoping by
    // that id is both race-free and more specific about what would be wrong.
    // The total "no ops_audit_log query is ever issued" guarantee is asserted
    // separately and race-free by the mock-backed twin in
    // controlServiceWebhook.test.ts.
    const { getOpsPool } = await import('@/lib/db/pool');
    const id = newCommandId();

    await deliver({
      type: 'command.acknowledged',
      idempotencyKey: `${id}:ack:audit-check`,
      data: {
        command: buildCommand({ id, status: 'acknowledged', acknowledgedAt: '2026-08-08T12:00:00.000Z' }),
      },
    });

    const written = await getOpsPool().query(
      `select id, action, resource_id from ops_audit_log
        where resource_id = $1 or metadata::text like $2`,
      [id, `%${id}%`],
    );
    expect(written.rows).toEqual([]);
  });

  it('reconciles the dispatcher action when the sibling migration has landed, and skips it otherwise', async () => {
    // ops_dispatcher_actions.control_service_command_id is added by migration
    // 20260808110000, which belongs to a different change set. Both states are
    // legitimate here, and the important assertion is the same either way: the
    // mirror write survives regardless. Losing a command's lifecycle state
    // because an optional back-link column is not deployed yet would be a far
    // worse trade than skipping the back-link.
    const { getOpsPool } = await import('@/lib/db/pool');
    const { rows: columns } = await getOpsPool().query(
      `select 1 from information_schema.columns
        where table_name = 'ops_dispatcher_actions' and column_name = 'control_service_command_id'`,
    );
    const columnExists = columns.length > 0;

    const id = newCommandId();
    const response = await deliver({
      type: 'command.created',
      idempotencyKey: id,
      data: { command: buildCommand({ id, status: 'authorized', deliveredAt: null }) },
    });

    expect(response.status).toBe(200);
    expect((await mirrorRow(id))?.status).toBe('authorized');
    expect((await eventRow(id))?.processed_at).not.toBeNull();

    if (columnExists) {
      // The command references a dispatcher action that does not exist locally
      // (control-service owns command identity), so the guarded UPDATE simply
      // matches no rows — it must not error and must not invent a link.
      const { rows } = await getOpsPool().query(
        'select count(*)::int as n from ops_dispatcher_actions where control_service_command_id = $1',
        [id],
      );
      expect(rows[0].n).toBe(0);
    }
  });
});
