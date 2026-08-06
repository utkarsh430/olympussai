// Pre-merge gate from docs/CONTROL_SERVICE_INTEGRATION.md section 5: "A
// concrete implementation of the dispatcherActionId check ... with a test
// proving a command without a valid id is refused." The DB trigger
// (control_service_consume_dispatcher_action) is the actual source of
// truth; this test proves createCommand() maps its rejection to a
// structured, client-facing error instead of leaking the raw Postgres
// error or silently succeeding.
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { createCommand } from '../src/db/commands.js';
import { AppError } from '../src/lib/errors.js';
import type { CreateCommandRequest } from '../src/models/schemas.js';

function fakePool(query: ReturnType<typeof vi.fn>): Pool {
  return { query } as unknown as Pool;
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
    const query = vi.fn().mockRejectedValue({
      code: 'P0001',
      message: 'dispatcher_action 00000000-0000-0000-0000-000000000000 does not exist',
    });

    await expect(createCommand(baseInput, fakePool(query))).rejects.toBeInstanceOf(AppError);
    await expect(createCommand(baseInput, fakePool(query))).rejects.toMatchObject({
      code: 'dispatcher_action_invalid',
      status: 422,
    });
  });

  it('refuses a command whose dispatcherActionId was already consumed', async () => {
    const query = vi.fn().mockRejectedValue({
      code: 'P0001',
      message: 'dispatcher_action 00000000-0000-0000-0000-000000000000 is already consumed',
    });

    await expect(createCommand(baseInput, fakePool(query))).rejects.toMatchObject({
      code: 'dispatcher_action_invalid',
      status: 422,
    });
  });

  it('maps a unique-violation on dispatcher_action_id to a 409', async () => {
    const query = vi.fn().mockRejectedValue({ code: '23505', message: 'duplicate key value' });

    await expect(createCommand(baseInput, fakePool(query))).rejects.toMatchObject({
      code: 'dispatcher_action_already_used',
      status: 409,
    });
  });

  it('creates the command when the dispatcherActionId is valid and unconsumed', async () => {
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
      status: 'proposed',
      created_at: new Date().toISOString(),
    };
    const query = vi.fn().mockResolvedValue({ rows: [returnedRow] });

    const command = await createCommand(baseInput, fakePool(query));

    expect(command.id).toBe('cmd-1');
    expect(command.dispatcherActionId).toBe(baseInput.dispatcherActionId);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
