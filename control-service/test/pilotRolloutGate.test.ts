// Unit coverage for the pilot-staging rollout-stage gate
// (src/pilot/gate.ts) — the enforcement point for ticket AC1 ("control/
// command services respect it without a deploy"). Mocks a minimal
// PoolClient/Pool pair, same style as test/commandLifecycleDb.test.ts:
// query() branches on SQL text so a test only has to say what the
// SELECT should return.
import { describe, it, expect, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { assertRolloutStageAllowsCommand } from '../src/pilot/gate.js';
import { AppError } from '../src/lib/errors.js';

function fakeClient(responses: {
  dispatcherActionRouteDirectionId?: string | null;
  stage?: string | null;
}): { client: PoolClient; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn((sql: string) => {
    const s = sql.trim().toLowerCase();
    if (s.startsWith('select route_direction_id from dispatcher_actions')) {
      return Promise.resolve({ rows: [{ route_direction_id: responses.dispatcherActionRouteDirectionId ?? null }] });
    }
    if (s.startsWith('select stage from route_direction_rollout_stages')) {
      const stage = responses.stage;
      return Promise.resolve({ rows: stage === undefined ? [] : [{ stage }] });
    }
    return Promise.resolve({ rows: [] });
  });
  return { client: { query } as unknown as PoolClient, query };
}

function fakeBreachPool(): { pool: Pool; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn().mockResolvedValue({
    rows: [{ id: 'breach-1', route_direction_id: 'rd-1', breach_type: 'rollout_stage_violation', severity: 'warning', detail: {}, detected_at: new Date().toISOString() }],
  });
  return { pool: { query } as unknown as Pool, query };
}

const baseInput = { dispatcherActionId: 'da-1', vehicleId: 'veh-1', actionType: 'self_equalizing_hold' as const };

describe('assertRolloutStageAllowsCommand', () => {
  it('allows the command when the dispatcher action carries no route-direction (nothing to gate)', async () => {
    const { client } = fakeClient({ dispatcherActionRouteDirectionId: null });
    const { pool, query } = fakeBreachPool();

    await expect(assertRolloutStageAllowsCommand(client, baseInput, pool)).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it('defaults an unset stage to observation and rejects the command', async () => {
    const { client } = fakeClient({ dispatcherActionRouteDirectionId: 'rd-1', stage: undefined });
    const { pool, query } = fakeBreachPool();

    await expect(assertRolloutStageAllowsCommand(client, baseInput, pool)).rejects.toMatchObject({
      code: 'rollout_stage_forbids_commands',
      status: 403,
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0]!;
    expect(String(sql).toLowerCase()).toContain('insert into guardrail_breach_log');
    expect(params).toContain('rollout_stage_violation');
  });

  it.each(['observation', 'shadow'] as const)('rejects a command while the route-direction is in "%s"', async (stage) => {
    const { client } = fakeClient({ dispatcherActionRouteDirectionId: 'rd-1', stage });
    const { pool } = fakeBreachPool();

    await expect(assertRolloutStageAllowsCommand(client, baseInput, pool)).rejects.toBeInstanceOf(AppError);
  });

  it.each(['advisory', 'limited_auto', 'expanded'] as const)('allows a command once the route-direction reaches "%s"', async (stage) => {
    const { client } = fakeClient({ dispatcherActionRouteDirectionId: 'rd-1', stage });
    const { pool, query } = fakeBreachPool();

    await expect(assertRolloutStageAllowsCommand(client, baseInput, pool)).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it('records the guardrail breach on a pool independent of the caller transaction (survives a rollback)', async () => {
    const { client, query: clientQuery } = fakeClient({ dispatcherActionRouteDirectionId: 'rd-1', stage: 'shadow' });
    const { pool, query: breachQuery } = fakeBreachPool();

    await expect(assertRolloutStageAllowsCommand(client, baseInput, pool)).rejects.toBeInstanceOf(AppError);

    // The breach insert went through the separate `pool`, never through the
    // transactional `client` — so it is unaffected by whatever the caller
    // (createCommand) does with `client`'s transaction afterwards.
    expect(breachQuery).toHaveBeenCalledTimes(1);
    expect(clientQuery.mock.calls.some((call: unknown[]) => String(call[0]).toLowerCase().includes('guardrail_breach_log'))).toBe(false);
  });
});
