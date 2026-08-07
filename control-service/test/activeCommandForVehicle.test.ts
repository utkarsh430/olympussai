// Unit coverage for getActiveDeliveredCommandForVehicle (src/db/commands.ts):
// the read path the driver PWA polls to find "the one active command" for
// its vehicle. Two-step transaction (find the candidate id, then re-use the
// same TTL-expiry lock as every other lifecycle mutation) so a lapsed TTL
// is expired in place rather than handed to the driver stale.
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { getActiveDeliveredCommandForVehicle } from '../src/db/commands.js';

function baseCommandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmd-1',
    recommendation_id: null,
    vehicle_id: 'veh-1',
    trip_id: null,
    action_type: 'speed_guidance',
    target_stop_id: null,
    parameters: { reason: 'Bunching with the vehicle ahead' },
    dispatcher_action_id: '00000000-0000-0000-0000-000000000000',
    ttl_seconds: 120,
    valid_from: new Date().toISOString(),
    expires_at: new Date(Date.now() + 120_000).toISOString(),
    policy_version: null,
    status: 'delivered',
    version: 1,
    supersedes_command_id: null,
    delivered_at: new Date().toISOString(),
    acknowledged_at: null,
    acknowledgement_reason: null,
    ack_outcome: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Fake PoolClient that tells apart the two SELECT statements
 * getActiveDeliveredCommandForVehicle issues by whether they select
 * `vehicle_id` (the candidate-id lookup) or a bare `id = $1` (the shared
 * lockAndExpireIfDue re-fetch).
 */
function fakePool(opts: { candidate?: { rows: unknown[] }; locked?: { rows: unknown[] }; updated?: { rows: unknown[] } }) {
  const query = vi.fn((sql: string) => {
    const s = sql.trim().toLowerCase();
    if (s.startsWith('begin') || s.startsWith('commit') || s.startsWith('rollback') || s.startsWith('select set_config')) {
      return Promise.resolve({ rows: [] });
    }
    if (s.includes('select id from commands')) {
      return Promise.resolve(opts.candidate ?? { rows: [] });
    }
    if (s.startsWith('select') && s.includes('for update')) {
      return Promise.resolve(opts.locked ?? { rows: [] });
    }
    if (s.startsWith('update commands')) {
      return Promise.resolve(opts.updated ?? { rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
  const client = { query, release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
  return { pool, query };
}

describe('getActiveDeliveredCommandForVehicle', () => {
  it('returns null when the vehicle has no delivered command', async () => {
    const { pool } = fakePool({ candidate: { rows: [] } });
    const result = await getActiveDeliveredCommandForVehicle('veh-1', pool);
    expect(result).toBeNull();
  });

  it('returns the delivered command when still within its TTL', async () => {
    const row = baseCommandRow();
    const { pool } = fakePool({
      candidate: { rows: [{ id: 'cmd-1' }] },
      locked: { rows: [row] },
    });

    const result = await getActiveDeliveredCommandForVehicle('veh-1', pool);
    expect(result).toMatchObject({ id: 'cmd-1', status: 'delivered', vehicleId: 'veh-1' });
  });

  it('expires a lapsed command in place and returns null rather than a stale delivered row', async () => {
    const pastTtl = baseCommandRow({ expires_at: new Date(Date.now() - 1000).toISOString() });
    const { pool, query } = fakePool({
      candidate: { rows: [{ id: 'cmd-1' }] },
      locked: { rows: [pastTtl] },
      updated: { rows: [{ ...pastTtl, status: 'expired' }] },
    });

    const result = await getActiveDeliveredCommandForVehicle('veh-1', pool);
    expect(result).toBeNull();
    expect(query.mock.calls.some(([sql]) => String(sql).toLowerCase().startsWith('update commands'))).toBe(true);
  });
});
