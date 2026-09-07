// The terminal success state the lifecycle never had.
//
// `executing` is inside `commands_one_active_per_vehicle_idx`, and
// `control_service_expire_commands()` deliberately EXCLUDES it ("a command
// already being carried out is not retroactively expired mid-execution, it
// runs to completed/failed" -- 20260806120000__command_lifecycle.sql). But
// nothing ever wrote `completed`, so "runs to completed/failed" was only ever
// true for a driver REFUSAL. An accepted command therefore held its vehicle's
// slot on that unique index FOREVER, not for the TTL.
//
// MEASURED on the live control database, 2026-09-06: four commands in
// `executing`, every one `ack_outcome = 'accept'`, aged 24-26 days and past
// their own `expires_at` by the same margin. They are the only non-terminal
// rows in that database past their TTL -- the TTL sweep had cleared every
// other status and could not clear these.
//
// These are mocked-pool tests in the house style (see commandLifecycleDb.test.ts):
// they pin the application layer's gating and SQL shape. The finished-at
// arithmetic itself lives in SQL and is Postgres's job.
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { sweepCompletedCommands } from '../src/db/commands.js';

function executingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmd-1',
    recommendation_id: null,
    vehicle_id: 'veh-1',
    trip_id: null,
    action_type: 'self_equalizing_hold',
    target_stop_id: null,
    parameters: { holdSeconds: 20 },
    dispatcher_action_id: '00000000-0000-0000-0000-000000000000',
    ttl_seconds: 120,
    valid_from: new Date().toISOString(),
    expires_at: new Date(Date.now() + 100_000).toISOString(),
    policy_version: null,
    status: 'completed',
    version: 1,
    supersedes_command_id: null,
    delivered_at: new Date().toISOString(),
    acknowledged_at: new Date().toISOString(),
    acknowledgement_reason: null,
    ack_outcome: 'accept',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function fakePool(sweepRows: unknown[]): { pool: Pool; calls: string[] } {
  const calls: string[] = [];
  const query = vi.fn((sql: string) => {
    calls.push(sql);
    if (sql.includes('control_service_complete_finished_commands')) return { rows: sweepRows };
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  return { pool: { connect: vi.fn(() => Promise.resolve(client)) } as unknown as Pool, calls };
}

describe('sweepCompletedCommands', () => {
  it('flips finished executing commands to completed, freeing the unique-index slot', async () => {
    const { pool, calls } = fakePool([executingRow()]);

    const completed = await sweepCompletedCommands(pool);

    expect(completed).toHaveLength(1);
    expect(completed[0]!.status).toBe('completed');
    expect(completed[0]!.vehicleId).toBe('veh-1');
    expect(calls.some((s) => s.includes('control_service_complete_finished_commands'))).toBe(true);
  });

  it('stamps the audit actor before the write, so the append-only log records why', async () => {
    // The audit trigger reads control_service.audit_* transaction-locals. A
    // sweep that skipped them would write an audit row whose reason is null,
    // and "full lifecycle reconstructable from audit log alone" would quietly
    // stop being true for the one transition this change adds.
    const { pool, calls } = fakePool([executingRow()]);

    await sweepCompletedCommands(pool);

    const setConfigIndex = calls.findIndex((s) => s.includes('set_config'));
    const sweepIndex = calls.findIndex((s) => s.includes('control_service_complete_finished_commands'));
    expect(setConfigIndex).toBeGreaterThanOrEqual(0);
    expect(setConfigIndex).toBeLessThan(sweepIndex);
  });

  it('commits, so the freed slot is visible to the next INSERT', async () => {
    const { pool, calls } = fakePool([]);

    await sweepCompletedCommands(pool);

    expect(calls).toContain('commit');
  });
});
