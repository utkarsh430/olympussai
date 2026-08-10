// Unit coverage for the transactional command-lifecycle functions in
// src/db/commands.ts: deliver (TTL + authorization gating), ack
// (accept/unable/unsafe, no penalty side effect), and supersede
// (version chain + vehicle-conflict mapping). Mocks a minimal
// PoolClient - these exercise the *application* branching logic; the
// actual TTL-sweep function, unique index and audit trigger live in
// control-service/db/migrations/20260806120000__command_lifecycle.sql
// and are Postgres's job to enforce, not something a mocked-pool test can
// prove.
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { deliverCommand, acknowledgeCommand, supersedeCommand } from '../src/db/commands.js';
import { listCommandAuditLog } from '../src/db/commandAudit.js';
import { AppError } from '../src/lib/errors.js';

function baseCommandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmd-1',
    recommendation_id: null,
    vehicle_id: 'veh-1',
    trip_id: null,
    action_type: 'self_equalizing_hold',
    target_stop_id: null,
    parameters: {},
    dispatcher_action_id: '00000000-0000-0000-0000-000000000000',
    ttl_seconds: 120,
    valid_from: new Date().toISOString(),
    expires_at: new Date(Date.now() + 120_000).toISOString(),
    policy_version: null,
    status: 'authorized',
    version: 1,
    supersedes_command_id: null,
    delivered_at: null,
    acknowledged_at: null,
    acknowledgement_reason: null,
    ack_outcome: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * A fake PoolClient whose query() branches on the SQL text rather than
 * call order, so a test only needs to say what the SELECT/UPDATE/INSERT
 * should return - begin/commit/rollback/set_config are always accepted.
 */
function fakeTransactionalPool(responses: {
  select?: { rows: unknown[] } | Error;
  update?: { rows: unknown[] } | Error;
  insert?: { rows: unknown[] } | Error;
  /** Rollout-gate answers, only consulted by supersedeCommand. Defaults let the gate pass. */
  dispatcherActionRouteDirectionId?: string | null;
  rolloutStage?: string;
}): { pool: Pool; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn((sql: string) => {
    const s = sql.trim().toLowerCase();
    if (s.startsWith('begin') || s.startsWith('commit') || s.startsWith('rollback') || s.startsWith('select set_config')) {
      return Promise.resolve({ rows: [] });
    }
    // The rollout gate's two SELECTs (src/pilot/gate.ts), which supersedeCommand
    // runs on this client before its insert. Matched BEFORE the generic
    // `select ... for update` branch below, which the stage lookup would
    // otherwise hit and be answered with a command row.
    //
    // These have to be answered explicitly now that the gate FAILS CLOSED: it
    // used to read a missing dispatcher_actions row / null route_direction_id
    // as "nothing to gate against — allow", so the fallthrough `{ rows: [] }`
    // used to be enough. It is now a 422, which is the point of the change —
    // superseding is a brand-new command and must not bypass the stage gate.
    if (s.startsWith('select route_direction_id from dispatcher_actions')) {
      return Promise.resolve({
        rows: [{ route_direction_id: responses.dispatcherActionRouteDirectionId ?? 'rd-1' }],
      });
    }
    if (s.startsWith('select stage from route_direction_rollout_stages')) {
      return Promise.resolve({ rows: [{ stage: responses.rolloutStage ?? 'limited_auto' }] });
    }
    if (s.startsWith('select') && s.includes('for update')) {
      if (responses.select instanceof Error) return Promise.reject(responses.select);
      return Promise.resolve(responses.select ?? { rows: [] });
    }
    if (s.startsWith('update commands')) {
      if (responses.update instanceof Error) return Promise.reject(responses.update);
      return Promise.resolve(responses.update ?? { rows: [] });
    }
    if (s.startsWith('insert into commands')) {
      if (responses.insert instanceof Error) return Promise.reject(responses.insert);
      return Promise.resolve(responses.insert ?? { rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
  const client = { query, release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
  return { pool, query };
}

describe('deliverCommand', () => {
  it('delivers an authorized, non-expired command', async () => {
    const { pool, query } = fakeTransactionalPool({
      select: { rows: [baseCommandRow({ status: 'authorized' })] },
      update: { rows: [baseCommandRow({ status: 'delivered', delivered_at: new Date().toISOString() })] },
    });

    const command = await deliverCommand('cmd-1', pool);

    expect(command.status).toBe('delivered');
    expect(query.mock.calls.some(([sql]) => String(sql).toLowerCase().startsWith('commit'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).toLowerCase().startsWith('rollback'))).toBe(false);
  });

  it('expires and refuses to deliver a command past its TTL instead of delivering it', async () => {
    const { pool } = fakeTransactionalPool({
      select: { rows: [baseCommandRow({ status: 'authorized', expires_at: new Date(Date.now() - 1000).toISOString() })] },
      update: { rows: [baseCommandRow({ status: 'expired' })] },
    });

    await expect(deliverCommand('cmd-1', pool)).rejects.toMatchObject({
      code: 'command_expired',
      status: 410,
    });
  });

  it('refuses to deliver a command that has not been authorized yet', async () => {
    const { pool } = fakeTransactionalPool({
      select: { rows: [baseCommandRow({ status: 'proposed' })] },
    });

    await expect(deliverCommand('cmd-1', pool)).rejects.toMatchObject({
      code: 'command_not_authorized',
      status: 409,
    });
  });

  it('404s for an unknown command id', async () => {
    const { pool } = fakeTransactionalPool({ select: { rows: [] } });

    await expect(deliverCommand('does-not-exist', pool)).rejects.toBeInstanceOf(AppError);
    await expect(deliverCommand('does-not-exist', pool)).rejects.toMatchObject({ code: 'command_not_found', status: 404 });
  });
});

describe('acknowledgeCommand', () => {
  it('records an accept ack and moves the command to executing', async () => {
    const { pool } = fakeTransactionalPool({
      select: { rows: [baseCommandRow({ status: 'delivered' })] },
      update: {
        rows: [
          baseCommandRow({ status: 'executing', ack_outcome: 'accept', acknowledged_at: new Date().toISOString() }),
        ],
      },
    });

    const command = await acknowledgeCommand('cmd-1', { outcome: 'accept', actorId: 'driver-1' }, pool);

    expect(command.status).toBe('executing');
    expect(command.ackOutcome).toBe('accept');
  });

  it.each(['unable', 'unsafe'] as const)(
    'records a %s ack, ends the command at failed, and applies no penalty side effect',
    async (outcome) => {
      const { pool, query } = fakeTransactionalPool({
        select: { rows: [baseCommandRow({ status: 'delivered' })] },
        update: {
          rows: [
            baseCommandRow({ status: 'failed', ack_outcome: outcome, acknowledgement_reason: 'brakes flagged' }),
          ],
        },
      });

      const command = await acknowledgeCommand('cmd-1', { outcome, reason: 'brakes flagged', actorId: 'driver-1' }, pool);

      expect(command.status).toBe('failed');
      expect(command.ackOutcome).toBe(outcome);
      expect(command.acknowledgementReason).toBe('brakes flagged');
      // Exactly one SELECT-for-update, one UPDATE, plus begin/set_config/commit -
      // no extra query indicating a penalty/scoring call was made.
      const updateCalls = query.mock.calls.filter(([sql]) => String(sql).toLowerCase().startsWith('update commands'));
      expect(updateCalls).toHaveLength(1);
    },
  );

  it('refuses to acknowledge a command that has not been delivered yet', async () => {
    const { pool } = fakeTransactionalPool({
      select: { rows: [baseCommandRow({ status: 'authorized' })] },
    });

    await expect(acknowledgeCommand('cmd-1', { outcome: 'accept', actorId: 'driver-1' }, pool)).rejects.toMatchObject({
      code: 'command_not_deliverable',
      status: 409,
    });
  });

  it('refuses to acknowledge an expired command', async () => {
    const { pool } = fakeTransactionalPool({
      select: { rows: [baseCommandRow({ status: 'delivered', expires_at: new Date(Date.now() - 1000).toISOString() })] },
      update: { rows: [baseCommandRow({ status: 'expired' })] },
    });

    await expect(acknowledgeCommand('cmd-1', { outcome: 'accept', actorId: 'driver-1' }, pool)).rejects.toMatchObject({
      code: 'command_expired',
      status: 410,
    });
  });
});

describe('supersedeCommand', () => {
  const supersedeInput = {
    dispatcherActionId: '11111111-1111-1111-1111-111111111111',
    ttlSeconds: 90,
  };

  it('cancels the prior version and inserts version + 1 for the same vehicle', async () => {
    const { pool } = fakeTransactionalPool({
      select: { rows: [baseCommandRow({ status: 'authorized', version: 1 })] },
      insert: { rows: [baseCommandRow({ id: 'cmd-2', status: 'authorized', version: 2, supersedes_command_id: 'cmd-1' })] },
    });

    const command = await supersedeCommand('cmd-1', supersedeInput, pool);

    expect(command.version).toBe(2);
    expect(command.supersedesCommandId).toBe('cmd-1');
  });

  it('refuses to supersede a command already in a terminal state', async () => {
    const { pool } = fakeTransactionalPool({
      select: { rows: [baseCommandRow({ status: 'completed' })] },
    });

    await expect(supersedeCommand('cmd-1', supersedeInput, pool)).rejects.toMatchObject({
      code: 'command_not_supersedable',
      status: 409,
    });
  });

  it('maps a vehicle-conflict unique violation on the replacement insert to a 409', async () => {
    const { pool } = fakeTransactionalPool({
      select: { rows: [baseCommandRow({ status: 'authorized' })] },
      insert: Object.assign(new Error('duplicate key value violates unique constraint "commands_one_active_per_vehicle_idx"'), {
        code: '23505',
      }),
    });

    await expect(supersedeCommand('cmd-1', supersedeInput, pool)).rejects.toMatchObject({
      code: 'vehicle_has_active_command',
      status: 409,
    });
  });
});

describe('listCommandAuditLog', () => {
  it('returns the ordered transition history for a command, mapped to camelCase', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'audit-1',
          command_id: 'cmd-1',
          event_type: 'created',
          from_status: null,
          to_status: 'authorized',
          actor_type: 'dispatcher',
          actor_id: null,
          reason: null,
          metadata: { version: 1 },
          occurred_at: new Date().toISOString(),
        },
        {
          id: 'audit-2',
          command_id: 'cmd-1',
          event_type: 'delivered',
          from_status: 'authorized',
          to_status: 'delivered',
          actor_type: 'system',
          actor_id: null,
          reason: 'delivered to recipient',
          metadata: { version: 1 },
          occurred_at: new Date().toISOString(),
        },
      ],
    });
    const pool = { query } as unknown as Pool;

    const log = await listCommandAuditLog('cmd-1', pool);

    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ eventType: 'created', fromStatus: null, toStatus: 'authorized' });
    expect(log[1]).toMatchObject({ eventType: 'delivered', fromStatus: 'authorized', toStatus: 'delivered', reason: 'delivered to recipient' });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('order by occurred_at asc'), ['cmd-1']);
  });
});

describe('timestamptz normalization (webhook idempotency-key regression)', () => {
  // REGRESSION. node-postgres parses timestamptz into a JS Date, but
  // RawCommandRow declared these columns as `string` - an assertion at the
  // driver boundary TypeScript cannot verify. JSON.stringify hid it (Date
  // serializes to ISO), so the webhook BODY was always right. String
  // interpolation did not, and routes/commands.ts builds the webhook
  // idempotency key as `${command.id}:ack:${command.acknowledgedAt}`.
  //
  // The key therefore came out as Date.prototype.toString():
  //   <id>:ack:Sun Aug 09 2026 23:00:52 GMT-0400 (Eastern Daylight Time)
  // which embeds the SENDER'S LOCAL TIMEZONE. Two instances in different
  // zones - or one instance after a TZ change - emit different keys for the
  // same logical event, so the receiver's dedupe stores it twice. Observed
  // live: ops_control_service_webhook_events held both spellings for a
  // single acknowledgement.
  it('returns ISO strings when pg hands back Date objects', async () => {
    const acknowledgedAt = new Date('2026-08-10T03:00:52.213Z');
    const { pool } = fakeTransactionalPool({
      select: { rows: [baseCommandRow({ status: 'delivered' })] },
      update: {
        rows: [
          baseCommandRow({
            status: 'failed',
            ack_outcome: 'unsafe',
            // What the driver ACTUALLY returns for a timestamptz column.
            acknowledged_at: acknowledgedAt,
            delivered_at: new Date('2026-08-10T03:00:15.096Z'),
            created_at: new Date('2026-08-10T02:59:10.712Z'),
          }),
        ],
      },
    });

    const command = await acknowledgeCommand(
      'cmd-1',
      { outcome: 'unsafe', reason: 'blind bend', actorId: 'driver-1' },
      pool,
    );

    expect(command.acknowledgedAt).toBe('2026-08-10T03:00:52.213Z');
    expect(command.deliveredAt).toBe('2026-08-10T03:00:15.096Z');
    expect(command.createdAt).toBe('2026-08-10T02:59:10.712Z');

    // The property that actually matters: the interpolated key is stable and
    // timezone-independent, not a locale string.
    const key = `${command.id}:ack:${command.acknowledgedAt}`;
    expect(key).toBe('cmd-1:ack:2026-08-10T03:00:52.213Z');
    expect(key).not.toMatch(/GMT|Daylight|Standard/);
  });

  it('passes ISO strings through unchanged', async () => {
    // Defensive: a caller (or a future driver config) may already hand back
    // strings. Normalizing must be idempotent, not double-convert.
    const { pool } = fakeTransactionalPool({
      select: { rows: [baseCommandRow({ status: 'delivered' })] },
      update: {
        rows: [baseCommandRow({ status: 'acknowledged', acknowledged_at: '2026-08-10T03:00:52.213Z' })],
      },
    });

    const command = await acknowledgeCommand(
      'cmd-1',
      { outcome: 'accept', reason: null, actorId: 'driver-1' },
      pool,
    );

    expect(command.acknowledgedAt).toBe('2026-08-10T03:00:52.213Z');
  });
});
