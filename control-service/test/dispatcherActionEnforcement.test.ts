// Pre-merge gate from docs/CONTROL_SERVICE_INTEGRATION.md section 5: "A
// concrete implementation of the dispatcherActionId check ... with a test
// proving a command without a valid id is refused." The DB trigger
// (control_service_consume_dispatcher_action) is the actual source of
// truth; this test proves createCommand() maps its rejection to a
// structured, client-facing error instead of leaking the raw Postgres
// error or silently succeeding. createCommand runs inside its own
// begin/commit/rollback transaction (control-service/db/migrations/
// 20260806120000__command_lifecycle.sql adds the audit-context settings
// and the vehicle-conflict unique index it also has to roll back on), so
// the fake pool here provides a client via pool.connect() rather than a
// bare pool.query().
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { createCommand } from '../src/db/commands.js';
import { AppError } from '../src/lib/errors.js';
import type { CreateCommandRequest } from '../src/models/schemas.js';

/**
 * The two SELECTs the rollout gate (src/pilot/gate.ts) runs on this same
 * client before the insert. They have to be answered explicitly now that the
 * gate FAILS CLOSED: it used to treat "no dispatcher_actions row" /
 * "route_direction_id is null" as "nothing to gate against — allow", so the
 * bare `{ rows: [] }` fallback below used to sail straight through it. It now
 * raises a 422 instead, which is the whole point of that change. These tests
 * are about mapCommandWriteError, so they hand the gate a route-direction on
 * an already-promoted stage and let it pass.
 */
function answerRolloutGate(sql: string): Promise<{ rows: unknown[] }> | null {
  const s = sql.trim().toLowerCase();
  if (s.startsWith('select route_direction_id from dispatcher_actions')) {
    return Promise.resolve({ rows: [{ route_direction_id: 'rd-1' }] });
  }
  if (s.startsWith('select stage from route_direction_rollout_stages')) {
    return Promise.resolve({ rows: [{ stage: 'limited_auto' }] });
  }
  return null;
}

function fakePool(
  insertResult: { rows: unknown[] } | (Error & { code?: string }),
): Pool & { queries: string[] } {
  const queries: string[] = [];
  const query = vi.fn((sql: string) => {
    queries.push(sql);
    const gated = answerRolloutGate(sql);
    if (gated) return gated;
    const s = sql.trim().toLowerCase();
    if (s.startsWith('insert into commands')) {
      if (insertResult instanceof Error) return Promise.reject(insertResult);
      return Promise.resolve(insertResult);
    }
    // begin / select set_config(...) / commit / rollback / the inline
    // dispatcher-action mirror all no-op ok.
    return Promise.resolve({ rows: [] });
  });
  const client = { query, release: vi.fn() };
  return { connect: vi.fn().mockResolvedValue(client), queries } as unknown as Pool & { queries: string[] };
}

const baseInput: CreateCommandRequest = {
  vehicleId: 'veh-1',
  tripId: null,
  recommendationId: null,
  actionType: 'self_equalizing_hold',
  targetStopId: null,
  parameters: {},
  dispatcherActionId: '00000000-0000-0000-0000-000000000000',
  ttlSeconds: 120,
  policyVersion: null,
};

describe('createCommand dispatcherActionId enforcement', () => {
  it('refuses a command whose dispatcherActionId does not exist', async () => {
    const err = Object.assign(new Error('dispatcher_action 00000000-0000-0000-0000-000000000000 does not exist'), {
      code: 'P0001',
    });

    await expect(createCommand(baseInput, fakePool(err))).rejects.toBeInstanceOf(AppError);
    await expect(createCommand(baseInput, fakePool(err))).rejects.toMatchObject({
      code: 'dispatcher_action_invalid',
      status: 422,
    });
  });

  it('refuses a command whose dispatcherActionId was already consumed', async () => {
    const err = Object.assign(new Error('dispatcher_action 00000000-0000-0000-0000-000000000000 is already consumed'), {
      code: 'P0001',
    });

    await expect(createCommand(baseInput, fakePool(err))).rejects.toMatchObject({
      code: 'dispatcher_action_invalid',
      status: 422,
    });
  });

  it('maps a unique-violation on dispatcher_action_id to a 409', async () => {
    const err = Object.assign(new Error('duplicate key value violates unique constraint "commands_dispatcher_action_id_key"'), {
      code: '23505',
    });

    await expect(createCommand(baseInput, fakePool(err))).rejects.toMatchObject({
      code: 'dispatcher_action_already_used',
      status: 409,
    });
  });

  it('maps a unique-violation on the one-active-command-per-vehicle index to a 409', async () => {
    const err = Object.assign(new Error('duplicate key value violates unique constraint "commands_one_active_per_vehicle_idx"'), {
      code: '23505',
    });

    await expect(createCommand(baseInput, fakePool(err))).rejects.toMatchObject({
      code: 'vehicle_has_active_command',
      status: 409,
    });
  });

  it('creates the command, already authorized, when the dispatcherActionId is valid and unconsumed', async () => {
    const returnedRow = {
      id: 'cmd-1',
      recommendation_id: null,
      vehicle_id: 'veh-1',
      trip_id: null,
      action_type: 'self_equalizing_hold',
      target_stop_id: null,
      parameters: {},
      dispatcher_action_id: baseInput.dispatcherActionId,
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
    };
    const pool = fakePool({ rows: [returnedRow] });

    const command = await createCommand(baseInput, pool);

    expect(command.id).toBe('cmd-1');
    expect(command.status).toBe('authorized');
    expect(command.dispatcherActionId).toBe(baseInput.dispatcherActionId);
    expect(command.version).toBe(1);
  });
});

/**
 * 23503 (foreign_key_violation) mapping. Before these branches existed both
 * of these fell through to the bare rethrow at the bottom of
 * mapCommandWriteError — an opaque 500 for what is squarely a
 * caller-supplied-id problem, and one the caller can only fix by being told
 * WHICH id this service has never heard of.
 *
 * The ordering assertion below is the load-bearing one: the P0001 branch
 * fires on any message merely *containing* "dispatcher_action", and a 23503
 * on `dispatcher_actions_vehicle_id_fkey` (raised while mirroring an inline
 * approval) contains exactly that. Checked in the wrong order it would
 * report "your approval is invalid" for what is really "that vehicle is not
 * in this service's fleet".
 */
describe('createCommand referenced-id mapping (23503)', () => {
  function fkError(constraint: string) {
    return Object.assign(
      new Error(`insert or update on table "commands" violates foreign key constraint "${constraint}"`),
      { code: '23503' },
    );
  }

  it('maps a route-direction FK violation to a 422 unknown_route_direction', async () => {
    await expect(createCommand(baseInput, fakePool(fkError('dispatcher_actions_route_direction_id_fkey')))).rejects.toMatchObject({
      code: 'unknown_route_direction',
      status: 422,
    });
  });

  it('maps a vehicle FK violation to a 422 unknown_vehicle, not to dispatcher_action_invalid', async () => {
    // The constraint name contains "dispatcher_action", which is precisely
    // the string the P0001 branch matches on. This asserts the 23503 check
    // wins.
    const err = fkError('dispatcher_actions_vehicle_id_fkey');

    await expect(createCommand(baseInput, fakePool(err))).rejects.toMatchObject({
      code: 'unknown_vehicle',
      status: 422,
    });
  });

  it('maps any other FK violation on this write path to a 422 rather than an opaque 500', async () => {
    await expect(createCommand(baseInput, fakePool(fkError('commands_recommendation_id_fkey')))).rejects.toMatchObject({
      code: 'unknown_reference',
      status: 422,
    });
  });

  it('still maps a P0001 mentioning dispatcher_action to dispatcher_action_invalid', async () => {
    // The counterpart of the ordering test above: adding the 23503 branch
    // ahead of P0001 must not have shadowed the trigger's own rejection.
    const err = Object.assign(new Error('dispatcher_action 00000000-0000-0000-0000-000000000000 is already consumed'), {
      code: 'P0001',
    });

    await expect(createCommand(baseInput, fakePool(err))).rejects.toMatchObject({
      code: 'dispatcher_action_invalid',
      status: 422,
    });
  });
});
