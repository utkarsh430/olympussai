// Unit coverage for src/pilot/rolloutStages.ts#setRolloutStage: the write
// path an admin's PUT /v1/route-directions/:id/rollout-stage goes through
// (ticket AC1/AC4). Verifies the upsert + audit-log insert happen inside
// one transaction, and that an unknown route-direction is rejected before
// either write.
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { setRolloutStage } from '../src/pilot/rolloutStages.js';

function fakeTransactionalPool(options: {
  routeDirectionExists: boolean;
  previousStage?: string | null;
}): { pool: Pool; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn((sql: string) => {
    const s = sql.trim().toLowerCase();
    if (s.startsWith('begin') || s.startsWith('commit') || s.startsWith('rollback')) {
      return Promise.resolve({ rows: [] });
    }
    if (s.startsWith('select id from route_directions')) {
      return Promise.resolve({ rows: options.routeDirectionExists ? [{ id: 'rd-1' }] : [] });
    }
    if (s.startsWith('select stage from route_direction_rollout_stages') && s.includes('for update')) {
      return Promise.resolve({ rows: options.previousStage === undefined ? [] : [{ stage: options.previousStage }] });
    }
    if (s.startsWith('insert into route_direction_rollout_stages') || s.startsWith('insert into rollout_stage_audit_log')) {
      return Promise.resolve({ rows: [] });
    }
    // The post-commit re-read (getRolloutStage's join query)
    if (s.includes('left join route_direction_rollout_stages')) {
      return Promise.resolve({
        rows: [
          {
            route_direction_id: 'rd-1',
            route_id: 'route-1',
            direction_code: 'UP',
            direction_name: 'Northbound',
            public_name: 'Route 1',
            stage: 'shadow',
            reason: 'pilot week 2',
            updated_by: 'admin@example.com',
            updated_at: new Date().toISOString(),
          },
        ],
      });
    }
    return Promise.resolve({ rows: [] });
  });
  const client = { query, release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client), query } as unknown as Pool;
  return { pool, query };
}

describe('setRolloutStage', () => {
  it('upserts the stage and writes one audit-log row in the same transaction', async () => {
    const { pool, query } = fakeTransactionalPool({ routeDirectionExists: true, previousStage: 'observation' });

    const updated = await setRolloutStage(
      'rd-1',
      { stage: 'shadow', changedBy: 'admin@example.com', reason: 'pilot week 2' },
      pool,
    );

    expect(updated.stage).toBe('shadow');
    expect(query.mock.calls.some(([sql]) => String(sql).toLowerCase().startsWith('insert into route_direction_rollout_stages'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).toLowerCase().startsWith('insert into rollout_stage_audit_log'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).toLowerCase().startsWith('commit'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).toLowerCase().startsWith('rollback'))).toBe(false);

    const auditCall = query.mock.calls.find(([sql]) => String(sql).toLowerCase().startsWith('insert into rollout_stage_audit_log'));
    expect(auditCall?.[1]).toEqual(['rd-1', 'observation', 'shadow', 'admin@example.com', 'pilot week 2']);
  });

  it('rejects (404) an unknown route-direction without writing anything', async () => {
    const { pool, query } = fakeTransactionalPool({ routeDirectionExists: false });

    await expect(
      setRolloutStage('does-not-exist', { stage: 'shadow', changedBy: 'admin@example.com' }, pool),
    ).rejects.toMatchObject({ code: 'route_direction_not_found', status: 404 });

    expect(query.mock.calls.some(([sql]) => String(sql).toLowerCase().startsWith('insert into'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).toLowerCase().startsWith('rollback'))).toBe(true);
  });
});
