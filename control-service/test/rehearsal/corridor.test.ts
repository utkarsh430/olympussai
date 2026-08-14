// The refusal.
//
// 561 of 759 seeded route-directions carry `calibration_source = 'none'`
// and a target headway of 1 second, which is a sentinel and not a
// measurement. Every bunching threshold in this system is a ratio of that
// number, so a simulation run against it would produce a complete set of
// confident-looking results from a denominator nobody measured.
//
// These tests pin that the rehearsal loader refuses such a corridor, and
// that it refuses it by asking the SAME reader live detection asks, rather
// than by re-deriving the rule.
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { loadCorridorInputs } from '../../src/rehearsal/corridor.js';
import { AppError } from '../../src/lib/errors.js';

interface Recorded {
  sql: string;
  params: unknown[];
}

/**
 * A pool that answers each query by matching on a fragment of its SQL, so a
 * test can decide exactly which of the loader's reads finds rows.
 */
function fakePool(responses: { match: string; rows: unknown[] }[]): { pool: Pool; queries: Recorded[] } {
  const queries: Recorded[] = [];
  const query = (sql: string, params: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    queries.push({ sql: normalized, params });
    const hit = responses.find((r) => normalized.includes(r.match));
    return Promise.resolve({ rows: hit?.rows ?? [], rowCount: hit?.rows.length ?? 0 });
  };
  const pool = { query, connect: () => Promise.resolve({ query, release: vi.fn() }) } as unknown as Pool;
  return { pool, queries };
}

const CALIBRATED_GATE_ROW = {
  route_direction_id: 'rd-1',
  target_headway_seconds: '900',
  bunched_threshold_ratio: '0.25',
  warning_threshold_ratio: '0.5',
  required_samples: 3,
  operating_period: 'all',
  day_type: 'all',
};

const FULL_POLICY_ROW = {
  id: 'policy-1',
  route_direction_id: 'rd-1',
  operating_period: 'all',
  day_type: 'all',
  target_headway_seconds: '900',
  bunched_threshold_ratio: '0.25',
  warning_threshold_ratio: '0.5',
  kf: '0.6',
  kb: '0.3',
  self_equalizing_k: '0.5',
  max_hold_seconds: 90,
  cooldown_seconds: 60,
  prediction_horizon_control_points: 3,
  occupancy_stale_seconds: null,
  occupancy_capacity: null,
  calibration_source: 'od_timetable',
};

const DIRECTION_ROW = {
  route_id: '1348',
  route_name: 'Lucknow - Kanpur',
  direction_code: 'OUT',
  is_loop: false,
  total_distance_meters: '90000',
};

const STOP_ROWS = [
  { stop_id: 's1', name: 'Alambagh', sequence: 0, cumulative_distance_meters: '0', is_control_point: true, max_hold_seconds: null, latitude: 26.8, longitude: 80.9 },
  { stop_id: 's2', name: 'Banthra', sequence: 1, cumulative_distance_meters: '30000', is_control_point: false, max_hold_seconds: null, latitude: 26.7, longitude: 80.8 },
  { stop_id: 's3', name: 'Kanpur', sequence: 2, cumulative_distance_meters: '90000', is_control_point: true, max_hold_seconds: null, latitude: 26.4, longitude: 80.3 },
];

function calibratedResponses() {
  return [
    { match: 'required_samples', rows: [CALIBRATED_GATE_ROW] },
    { match: 'self_equalizing_k', rows: [FULL_POLICY_ROW] },
    { match: 'from route_directions rd', rows: [DIRECTION_ROW] },
    { match: 'from route_direction_stops rds', rows: STOP_ROWS },
    {
      match: 'ST_AsGeoJSON',
      rows: [{ points: JSON.stringify({ type: 'LineString', coordinates: [[80.9, 26.8], [80.8, 26.7], [80.3, 26.4]] }) }],
    },
  ];
}

describe('loadCorridorInputs', () => {
  it('asks the live detection reader first, with its calibration_source predicate intact', async () => {
    const handle = fakePool(calibratedResponses());
    await loadCorridorInputs('rd-1', handle.pool);
    expect(handle.queries[0]!.sql).toContain("calibration_source <> 'none'");
    expect(handle.queries[0]!.sql).toContain('required_samples');
  });

  it('refuses an uncalibrated corridor with the same 404 the live headway path raises', async () => {
    // The gate query finds nothing, exactly as it does for a 'none' row.
    const handle = fakePool([]);
    await expect(loadCorridorInputs('rd-561', handle.pool)).rejects.toMatchObject({
      code: 'no_active_policy',
      status: 404,
    });
  });

  it('says WHY in words a planner can act on, not just a code', async () => {
    const handle = fakePool([]);
    const error = await loadCorridorInputs('rd-561', handle.pool).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).toMatch(/no measured target headway/i);
  });

  // The refusal must not be reachable around: if the gate somehow passed
  // but the full read did not find the same row, that is not a licence to
  // proceed with a partial policy.
  it('refuses when the gate passes but the full policy row cannot be read', async () => {
    const handle = fakePool([{ match: 'required_samples', rows: [CALIBRATED_GATE_ROW] }]);
    await expect(loadCorridorInputs('rd-1', handle.pool)).rejects.toMatchObject({ code: 'no_active_policy' });
  });

  it('loads a calibrated corridor with its real policy, stops and geometry', async () => {
    const handle = fakePool(calibratedResponses());
    const corridor = await loadCorridorInputs('rd-1', handle.pool);

    expect(corridor.policy.targetHeadwaySeconds).toBe(900);
    expect(corridor.policy.kf).toBe(0.6);
    expect(corridor.policy.selfEqualizingK).toBe(0.5);
    expect(corridor.policy.maxHoldSeconds).toBe(90);
    expect(corridor.calibrationSource).toBe('od_timetable');
    expect(corridor.stops.map((s) => s.stopId)).toEqual(['s1', 's2', 's3']);
    expect(corridor.stops[2]!.cumulativeDistanceMeters).toBe(90000);
    expect(corridor.totalDistanceMeters).toBe(90000);
    expect(corridor.shape).toHaveLength(3);
  });

  // Nulls are carried through rather than defaulted. A corridor with no
  // gains generates no candidates and the surface says so; substituting a
  // gain would be rehearsing a controller nobody configured.
  it('carries a missing controller gain through as null instead of substituting one', async () => {
    const handle = fakePool([
      ...calibratedResponses().filter((r) => r.match !== 'self_equalizing_k'),
      { match: 'self_equalizing_k', rows: [{ ...FULL_POLICY_ROW, kf: null, kb: null, self_equalizing_k: null }] },
    ]);
    const corridor = await loadCorridorInputs('rd-1', handle.pool);
    expect(corridor.policy.kf).toBeNull();
    expect(corridor.policy.kb).toBeNull();
    expect(corridor.policy.selfEqualizingK).toBeNull();
  });

  it('refuses a corridor with fewer than two mapped stops rather than simulating a point', async () => {
    const handle = fakePool([
      ...calibratedResponses().filter((r) => r.match !== 'from route_direction_stops rds'),
      { match: 'from route_direction_stops rds', rows: [STOP_ROWS[0]] },
    ]);
    await expect(loadCorridorInputs('rd-1', handle.pool)).rejects.toMatchObject({ code: 'corridor_too_short' });
  });

  // Losing the drawn shape degrades the picture; refusing the run over it
  // would be a worse answer to a smaller problem.
  it('still returns a runnable corridor when the route polyline cannot be read', async () => {
    const handle = fakePool([
      ...calibratedResponses().filter((r) => r.match !== 'ST_AsGeoJSON'),
      { match: 'ST_AsGeoJSON', rows: [{ points: 'not json' }] },
    ]);
    const corridor = await loadCorridorInputs('rd-1', handle.pool);
    expect(corridor.shape).toEqual([]);
    expect(corridor.stops).toHaveLength(3);
  });
});
