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
  /** false => the dispatcher_actions row does not exist at all (SELECT returns zero rows), which is a different failure from a row whose route_direction_id is null. */
  dispatcherActionExists?: boolean;
  stage?: string | null;
}): { client: PoolClient; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn((sql: string) => {
    const s = sql.trim().toLowerCase();
    if (s.startsWith('select route_direction_id from dispatcher_actions')) {
      if (responses.dispatcherActionExists === false) return Promise.resolve({ rows: [] });
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
  // FAIL-CLOSED. This case used to assert the opposite ("allows the command
  // when the dispatcher action carries no route-direction — nothing to
  // gate"), and that was the single largest hole in the gate: with a null
  // route_direction_id, resolveRouteDirectionId returned null and
  // assertRolloutStageAllowsCommand returned early, so the command was
  // ALLOWED without any stage check at all. Once the web app began mirroring
  // its approvals in over POST /v1/commands, a bridge that sent
  // routeDirectionId: null would have taken that branch on EVERY command and
  // silently disabled the rollout gate network-wide — commands reaching
  // routes still in 'observation'/'shadow'. A gate that opens when its input
  // is missing is not a gate. The assertion is inverted deliberately; it is a
  // behaviour change, not a relaxed expectation.
  it('refuses the command when the dispatcher action carries no route-direction (fails closed, never "nothing to gate")', async () => {
    const { client } = fakeClient({ dispatcherActionRouteDirectionId: null });
    const { pool, query } = fakeBreachPool();

    await expect(assertRolloutStageAllowsCommand(client, baseInput, pool)).rejects.toBeInstanceOf(AppError);
    await expect(assertRolloutStageAllowsCommand(client, baseInput, pool)).rejects.toMatchObject({
      code: 'route_direction_required',
      status: 422,
    });
    // Not a guardrail breach: nothing was *violated*, the request was simply
    // unenforceable and was refused before any stage lookup happened.
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses the command when the dispatcher action does not exist at all', async () => {
    const { client } = fakeClient({ dispatcherActionExists: false });
    const { pool, query } = fakeBreachPool();

    await expect(assertRolloutStageAllowsCommand(client, baseInput, pool)).rejects.toMatchObject({
      code: 'dispatcher_action_invalid',
      status: 422,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('never looks up a rollout stage once the route-direction cannot be resolved', async () => {
    const { client, query: clientQuery } = fakeClient({ dispatcherActionRouteDirectionId: null });
    const { pool } = fakeBreachPool();

    await expect(assertRolloutStageAllowsCommand(client, baseInput, pool)).rejects.toBeInstanceOf(AppError);
    expect(
      clientQuery.mock.calls.some((call: unknown[]) =>
        String(call[0]).toLowerCase().includes('route_direction_rollout_stages'),
      ),
    ).toBe(false);
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
