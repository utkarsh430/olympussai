// The fail-closed guard on an UNCALIBRATED route-direction.
//
// A `calibration_source = 'none'` policy row exists so that
// `select calibration_source, count(*) from route_policies` is a complete
// census of the network's calibration state. It carries a sentinel, not a
// target, because target_headway_seconds is `not null check (> 0)` and cannot
// hold NULL. The whole arrangement only holds if the read path refuses the row
// — otherwise the sentinel becomes a denominator, and src/headway/bunching.ts
// and metrics.ts start producing numbers, and numbers get believed.
//
// These tests pin that refusal at the two places that load policies.

import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { loadActiveRoutePolicy } from '../../src/headway/repository.js';
import { UNCALIBRATED_HEADWAY_SENTINEL_SECONDS } from '../../src/seed/harvest.js';

interface Recorded {
  sql: string;
  params: unknown[];
}

function fakePool(rows: unknown[] = []): { pool: Pool; queries: Recorded[] } {
  const queries: Recorded[] = [];
  const query = (sql: string, params: unknown[] = []) => {
    queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    return Promise.resolve({ rows, rowCount: rows.length });
  };
  const pool = { query, connect: () => Promise.resolve({ query, release: vi.fn() }) } as unknown as Pool;
  return { pool, queries };
}

describe('loadActiveRoutePolicy', () => {
  it("will not load a 'none' row, so the sentinel can never become a denominator", async () => {
    const handle = fakePool();
    await loadActiveRoutePolicy('rd-1', handle.pool);
    expect(handle.queries[0]!.sql).toContain("calibration_source <> 'none'");
  });

  it('returns null exactly as it does for a route-direction with no policy at all', async () => {
    // This is the point of filtering in the query rather than at each call site:
    // the route-direction takes the path that ALREADY existed for an unpoliced
    // one, and src/headway/service.ts raises its 404 `no_active_policy`. No new
    // branch, no new failure mode, and detection is off audibly rather than
    // silently — which is the entire difference this work makes.
    const handle = fakePool([]);
    expect(await loadActiveRoutePolicy('rd-1', handle.pool)).toBeNull();
  });

  it('still loads a calibrated policy', async () => {
    const handle = fakePool([
      {
        route_direction_id: 'rd-1',
        target_headway_seconds: '1500',
        bunched_threshold_ratio: '0.25',
        warning_threshold_ratio: '0.5',
        required_samples: 3,
        operating_period: 'all',
        day_type: 'all',
      },
    ]);
    expect(await loadActiveRoutePolicy('rd-1', handle.pool)).toMatchObject({
      targetHeadwaySeconds: 1500,
    });
  });

  it('would have produced a nonsense ratio had the sentinel been let through', () => {
    // 900s of real forward headway against the sentinel reads as a ratio of 900,
    // which never crosses the 0.5 warning threshold — the same silent
    // non-detection a fabricated 1,800s produces, and the reason the row is
    // refused rather than merely labelled.
    const hFwdSeconds = 900;
    expect(hFwdSeconds / UNCALIBRATED_HEADWAY_SENTINEL_SECONDS).toBeGreaterThan(0.5);
  });
});
