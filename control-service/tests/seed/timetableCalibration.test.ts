// The timetable as the AUTHORITATIVE source, end to end through the harvest,
// the recalibration pass and the migration that constrains what they write.
//
// No database and no network: the pool is a recording fake, every payload is a
// pinned fixture.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { normalizeTimetableRows } from '../../src/ingestion/upsrtc/staticData.js';
import {
  harvestNetwork,
  DEFAULT_HEADWAY_SECONDS,
  HEADWAY_CALIBRATION_SOURCES,
  UNCALIBRATED_HEADWAY_SENTINEL_SECONDS,
  type NetworkSeed,
  type SeedRouteDirection,
} from '../../src/seed/harvest.js';
import { buildTimetableIndex } from '../../src/seed/timetable.js';
import { recalibrateHeadways } from '../../src/seed/recalibrate.js';
import { liveFeed, loadFixture, probe } from './fixtures.js';

const timetable = buildTimetableIndex(normalizeTimetableRows(loadFixture('timetable-corpus')).rows);

const MIGRATION_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../db/migrations');

function direction(seed: NetworkSeed, routeId: string, directionCode: string): SeedRouteDirection {
  const route = seed.routes.find((entry) => entry.id === routeId)!;
  return route.directions.find((entry) => entry.directionCode === directionCode)!;
}

/** schedule-suffixed-pair is line 635, which the pinned timetable also carries. */
function harvestWithTimetable(...fixtures: string[]): NetworkSeed {
  return harvestNetwork(
    liveFeed,
    fixtures.map((name) => probe(name)),
    { timetable },
  );
}

// ============================================================================
// Harvest
// ============================================================================

describe('harvestNetwork with a timetable', () => {
  it('writes the MEASURED headway onto a route-direction the timetable covers', () => {
    const seed = harvestWithTimetable('schedule-suffixed-pair');

    expect(direction(seed, '635', 'OUT').policy).toMatchObject({
      targetHeadwaySeconds: 1500,
      calibrationSource: 'timetable',
    });
    expect(direction(seed, '635', 'IN').policy).toMatchObject({
      targetHeadwaySeconds: 2400,
      calibrationSource: 'timetable',
    });
    expect(seed.report.headwayCalibration.timetable).toBe(2);
    expect(seed.report.timetableMatches).toContainEqual({
      routeId: '635',
      directionCode: 'OUT',
      match: 'exact',
      targetHeadwaySeconds: 1500,
      sampleCount: 4,
      stopAreaCount: 2,
    });
  });

  it('writes NO NUMBER for a route-direction the timetable does not cover', () => {
    // HHH_700_ORD_OUT is deliberately absent from the pinned corpus. Without a
    // timetable this same fixture produces a fabricated 1,800s (asserted below),
    // which is the failure being removed: a plausible-looking value on a route
    // nobody measured, and no error anywhere.
    const seed = harvestWithTimetable('schedule-loop');
    const policy = direction(seed, '700', 'OUT').policy;

    expect(policy.calibrationSource).toBe('none');
    expect(policy.targetHeadwaySeconds).toBe(UNCALIBRATED_HEADWAY_SENTINEL_SECONDS);
    expect(policy.targetHeadwaySeconds).not.toBe(DEFAULT_HEADWAY_SECONDS);
    expect(seed.report.uncalibratedDirections).toContainEqual({
      routeId: '700',
      directionCode: 'OUT',
      reason: 'line_absent_from_timetable',
    });

    const withoutTimetable = harvestNetwork(liveFeed, [probe('schedule-loop')]);
    expect(direction(withoutTimetable, '700', 'OUT').policy).toMatchObject({
      targetHeadwaySeconds: DEFAULT_HEADWAY_SECONDS,
      calibrationSource: 'default',
    });
  });

  it('never falls back to a vehicle-derived estimate when a timetable is present', () => {
    // schedule-loop's own live fleet DOES supply enough departures for
    // 'fleet_span' (that is what the timetable-less run above proves). Topping
    // the timetable up with it would put an inferred number on exactly the rows
    // that have no timetable evidence.
    const seed = harvestWithTimetable('schedule-loop', 'schedule-same-direction-repeat');
    const sources = new Set(
      seed.routes.flatMap((route) => route.directions.map((d) => d.policy.calibrationSource)),
    );
    expect(sources.has('fleet_span')).toBe(false);
    expect(sources.has('journey_span')).toBe(false);
    expect(sources.has('default')).toBe(false);
  });

  it('takes direction_code from line_direction instead of inventing SINGLE', () => {
    // ALM_11_VPL carries no _IN/_OUT suffix, so the suffix rule invents
    // 'SINGLE'. The timetable states Inbound.
    const withTimetable = harvestWithTimetable('schedule-same-direction-repeat');
    expect(withTimetable.routes.find((route) => route.id === '7762')!.directions.map((d) => d.directionCode))
      .toEqual(['IN']);
    expect(withTimetable.report.derivedDirections.some((entry) => entry.basis === 'timetable_line_direction'))
      .toBe(true);
    expect(direction(withTimetable, '7762', 'IN').policy).toMatchObject({
      targetHeadwaySeconds: 1200,
      calibrationSource: 'timetable',
    });

    const without = harvestNetwork(liveFeed, [probe('schedule-same-direction-repeat')]);
    expect(without.routes.find((route) => route.id === '7762')!.directions.map((d) => d.directionCode))
      .toEqual(['SINGLE']);
  });

  it('carries the timetable\'s own audit into the harvest report', () => {
    const seed = harvestWithTimetable('schedule-suffixed-pair');
    expect(seed.report.timetable).toMatchObject({
      headwaysDerived: timetable.report.headwaysDerived,
      headwaysNoRepeatedDeparture: timetable.report.headwaysNoRepeatedDeparture,
    });
    expect(harvestNetwork(liveFeed, [probe('schedule-loop')]).report.timetable).toBeNull();
  });
});

// ============================================================================
// Recalibration against the existing network
// ============================================================================

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

/**
 * A fake pool that knows two things: which route-directions exist, and what
 * policy each currently has.
 */
function fakePool(
  directions: { id: string; route_id: string; direction_code: string }[],
  policies: Record<string, Record<string, unknown>> = {},
): { pool: Pool; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const query = (sql: string, params: unknown[] = []) => {
    const normalized = normalize(sql);
    queries.push({ sql: normalized, params });
    if (normalized.startsWith('select id, route_id, direction_code')) {
      return Promise.resolve({ rows: directions, rowCount: directions.length });
    }
    if (normalized.startsWith('select id, target_headway_seconds')) {
      const existing = policies[String(params[0])];
      return existing
        ? Promise.resolve({ rows: [existing], rowCount: 1 })
        : Promise.resolve({ rows: [], rowCount: 0 });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  };
  const client = { query, release: vi.fn() };
  const pool = { connect: () => Promise.resolve(client), query } as unknown as Pool;
  return { pool, queries };
}

const openPolicy = (overrides: Record<string, unknown> = {}) => ({
  id: 'policy-1',
  target_headway_seconds: '1800',
  kf: '0.4',
  kb: '0.2',
  self_equalizing_k: '0.35',
  calibration_source: 'default',
  ...overrides,
});

describe('recalibrateHeadways', () => {
  it('replaces a fabricated target with the measured one', () => {
    const handle = fakePool([{ id: 'rd-1', route_id: '635', direction_code: 'OUT' }], {
      'rd-1': openPolicy(),
    });

    return recalibrateHeadways(handle.pool, timetable).then((result) => {
      expect(result.calibrated).toBe(1);
      expect(result.uncalibrated).toBe(0);
      expect(result.matchesExact).toBe(1);
      expect(result.changed).toEqual([
        {
          routeDirectionId: 'rd-1',
          routeId: '635',
          directionCode: 'OUT',
          previousTargetHeadwaySeconds: 1800,
          previousCalibrationSource: 'default',
          targetHeadwaySeconds: 1500,
          calibrationSource: 'timetable',
          match: 'exact',
          sampleCount: 4,
          stopAreaCount: 2,
        },
      ]);

      const insert = handle.queries.find((entry) => entry.sql.startsWith('insert into route_policies'))!;
      expect(insert.params[1]).toBe(1500);
      expect(insert.params[5]).toBe('timetable');
      // The old row is closed before the new one is written.
      const sqls = handle.queries.map((entry) => entry.sql);
      expect(sqls.indexOf('update route_policies set effective_to = greatest(now(), effective_from + interval \'1 microsecond\') where id = $1'))
        .toBeLessThan(sqls.findIndex((sql) => sql.startsWith('insert into route_policies')));
    });
  });

  it('writes the sentinel and \'none\' — never the fallback — where the timetable is silent', () => {
    const handle = fakePool([{ id: 'rd-2', route_id: '700', direction_code: 'OUT' }], {
      'rd-2': openPolicy({ target_headway_seconds: '26130' }),
    });

    return recalibrateHeadways(handle.pool, timetable).then((result) => {
      expect(result.calibrated).toBe(0);
      expect(result.uncalibrated).toBe(1);
      const insert = handle.queries.find((entry) => entry.sql.startsWith('insert into route_policies'))!;
      expect(insert.params[1]).toBe(UNCALIBRATED_HEADWAY_SENTINEL_SECONDS);
      expect(insert.params[5]).toBe('none');
      expect(insert.params[1]).not.toBe(DEFAULT_HEADWAY_SECONDS);
    });
  });

  it('resolves a pseudo-direction only when the line runs one way', () => {
    const handle = fakePool(
      [
        { id: 'rd-3', route_id: '7762', direction_code: 'SINGLE' },
        { id: 'rd-4', route_id: '635', direction_code: 'SINGLE' },
      ],
      { 'rd-3': openPolicy(), 'rd-4': openPolicy() },
    );

    return recalibrateHeadways(handle.pool, timetable).then((result) => {
      expect(result.matchesSoleDirection).toBe(1);
      expect(result.matchesExact).toBe(0);
      expect(result.uncalibrated).toBe(1);
      expect(result.changed.find((entry) => entry.routeDirectionId === 'rd-3')).toMatchObject({
        calibrationSource: 'timetable',
        match: 'sole_direction',
      });
      expect(result.changed.find((entry) => entry.routeDirectionId === 'rd-4')).toMatchObject({
        calibrationSource: 'none',
      });
    });
  });

  it('inherits operator-tuned gains rather than re-stamping the seeder defaults', () => {
    // A recalibration is about H* and its provenance. Reverting a hand-tuned kf
    // as a side effect would be a change nobody asked for and nobody would see.
    const handle = fakePool([{ id: 'rd-5', route_id: '635', direction_code: 'OUT' }], {
      'rd-5': openPolicy({ kf: '0.9', kb: '0.7', self_equalizing_k: '0.5' }),
    });

    return recalibrateHeadways(handle.pool, timetable).then(() => {
      const insert = handle.queries.find((entry) => entry.sql.startsWith('insert into route_policies'))!;
      expect(insert.params.slice(2, 5)).toEqual([0.9, 0.7, 0.5]);
    });
  });

  it('does not re-version a policy that already says the same thing', () => {
    const handle = fakePool([{ id: 'rd-6', route_id: '635', direction_code: 'OUT' }], {
      'rd-6': openPolicy({ target_headway_seconds: '1500', calibration_source: 'timetable' }),
    });

    return recalibrateHeadways(handle.pool, timetable).then((result) => {
      expect(result.policiesInserted).toBe(0);
      expect(result.policiesUnchanged).toBe(1);
      expect(result.changed).toHaveLength(0);
      expect(handle.queries.some((entry) => entry.sql.startsWith('insert into route_policies'))).toBe(false);
    });
  });

  it('reports a failed direction and keeps going', () => {
    const handle = fakePool([
      { id: 'rd-7', route_id: '635', direction_code: 'OUT' },
      { id: 'rd-8', route_id: '635', direction_code: 'IN' },
    ]);
    const original = handle.pool.connect.bind(handle.pool);
    let call = 0;
    (handle.pool as unknown as { connect: () => Promise<unknown> }).connect = () => {
      call += 1;
      if (call === 1) return Promise.reject(new Error('connection lost'));
      return original();
    };

    return recalibrateHeadways(handle.pool, timetable).then((result) => {
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toMatchObject({ routeDirectionId: 'rd-7', error: 'connection lost' });
      expect(result.policiesInserted).toBe(1);
    });
  });
});

// ============================================================================
// The database has to accept what the seeder emits
// ============================================================================

describe('calibration_source CHECK constraint', () => {
  /** The constraint as the LAST migration that touches it leaves it. */
  function allowedSources(): string[] {
    const files = readdirSync(MIGRATION_DIR).filter((name) => name.endsWith('.sql')).sort();
    let allowed: string[] | null = null;
    for (const file of files) {
      const sql = readFileSync(join(MIGRATION_DIR, file), 'utf8');
      const match = /check \(calibration_source in \(([^)]+)\)\)/.exec(sql);
      if (match) {
        allowed = match[1]!.split(',').map((value) => value.trim().replace(/^'|'$/g, ''));
      }
    }
    return allowed!;
  }

  it('accepts every source the seeder knows how to emit', () => {
    // A source added in TS without being added to a migration would pass
    // typecheck, lint and every fake-pool test here, then fail in production one
    // route-direction at a time — each swallowed as a per-direction `failure`
    // while the route silently kept its old policy.
    expect([...allowedSources()].sort()).toEqual([...HEADWAY_CALIBRATION_SOURCES].sort());
  });

  it('emits nothing outside that set, with a timetable or without one', () => {
    const emitted = new Set(
      [
        harvestWithTimetable('schedule-loop', 'schedule-suffixed-pair', 'schedule-same-direction-repeat'),
        harvestNetwork(liveFeed, [
          probe('schedule-loop'),
          probe('schedule-suffixed-pair'),
          probe('schedule-same-direction-repeat'),
        ]),
      ].flatMap((seed) =>
        seed.routes.flatMap((route) => route.directions.map((d) => d.policy.calibrationSource)),
      ),
    );
    expect(emitted.size).toBeGreaterThan(1);
    for (const source of emitted) expect(allowedSources()).toContain(source);
  });

  it('pins the sentinel to \'none\' rows in the database, not only in TypeScript', () => {
    // Without this constraint a 'none' row could come to carry 1,800 and the
    // label would be the only thing saying otherwise.
    const sql = readFileSync(
      join(MIGRATION_DIR, '20260810120000__route_policy_timetable_calibration.sql'),
      'utf8',
    );
    const match = /check \(calibration_source <> 'none' or target_headway_seconds = (\d+)\)/.exec(sql);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(UNCALIBRATED_HEADWAY_SENTINEL_SECONDS);
  });
});
