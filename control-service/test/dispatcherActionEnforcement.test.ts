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

function fakePool(insertResult: { rows: unknown[] } | (Error & { code?: string })): Pool {
  const query = vi.fn((sql: string) => {
    const s = sql.trim().toLowerCase();
    if (s.startsWith('insert into commands')) {
      if (insertResult instanceof Error) return Promise.reject(insertResult);
      return Promise.resolve(insertResult);
    }
    // begin / select set_config(...) / commit / rollback all no-op ok.
    return Promise.resolve({ rows: [] });
  });
  const client = { query, release: vi.fn() };
  return { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
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
