// persist.ts against a recording fake pg Pool.
//
// No database is touched here; the live-database behaviour is verified by
// running the seeder for real. What these tests pin down is the SQL SHAPE —
// the transaction boundaries, the FK ordering, delete-then-insert on
// route_direction_stops, lon-before-lat in ST_MakePoint, policy versioning and
// the fail-closed rollout-stage rule. Those are exactly the properties that
// fail silently rather than loudly if they regress.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { harvestNetwork, type NetworkSeed } from '../../src/seed/harvest.js';
import { persistNetworkSeed, persistVehicles } from '../../src/seed/persist.js';
import { liveFeed, probe } from './fixtures.js';

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface FakePoolHandle {
  pool: Pool;
  queries: RecordedQuery[];
  /** Statements in order, whitespace-collapsed, for sequencing assertions. */
  sql: () => string[];
}

type Responder = (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number } | undefined;

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function fakePool(responder?: Responder): FakePoolHandle {
  const queries: RecordedQuery[] = [];

  const query = (sql: string, params: unknown[] = []) => {
    queries.push({ sql: normalize(sql), params });
    const custom = responder?.(normalize(sql), params);
    if (custom) return Promise.resolve(custom);
    if (/returning id/i.test(sql)) {
      return Promise.resolve({ rows: [{ id: 'rd-uuid-1' }], rowCount: 1 });
    }
    if (/returning ST_Length/i.test(sql)) {
      // Answer with the value the caller just asked us to store, so the drift
      // check sees agreement unless a test deliberately says otherwise.
      return Promise.resolve({ rows: [{ postgis_length: String(params[2]) }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  };

  const client = { query, release: vi.fn() };
  const pool = { connect: () => Promise.resolve(client), query } as unknown as Pool;
  return { pool, queries, sql: () => queries.map((entry) => entry.sql) };
}

function seedOf(fixture: string): NetworkSeed {
  return harvestNetwork(liveFeed, [probe(fixture)]);
}

describe('persistVehicles', () => {
  it('bulk-upserts the whole inventory in one transaction via unnest', () => {
    // ~9,300 rows must not become ~9,300 round trips.
    const handle = fakePool();
    const seed = seedOf('schedule-loop');
    return persistVehicles(handle.pool, seed.vehicles).then(() => {
      expect(handle.sql()[0]).toBe('begin');
      expect(handle.sql().at(-1)).toBe('commit');
      const insert = handle.queries.find((entry) => entry.sql.includes('insert into vehicles'))!;
      expect(insert.sql).toContain('unnest($1::text[], $2::text[], $3::text[], $4::text[])');
      expect((insert.params[0] as string[]).length).toBe(seed.vehicles.length);
      // An incoming null must not erase a depot an earlier run learned.
      expect(insert.sql).toContain('coalesce(excluded.depot_name, vehicles.depot_name)');
    });
  });

  it('does nothing at all when there are no vehicles', async () => {
    const handle = fakePool();
    await expect(persistVehicles(handle.pool, [])).resolves.toBe(0);
    expect(handle.queries).toHaveLength(0);
  });
});

describe('persistNetworkSeed transaction shape', () => {
  it('opens one transaction per route-direction, not one for the whole network', async () => {
    // 517 directions in a single lock window would make one bad route an
    // all-or-nothing failure for the entire network.
    const handle = fakePool();
    const seed = seedOf('schedule-suffixed-pair'); // one route, two directions
    await persistNetworkSeed(handle.pool, seed);
    const begins = handle.sql().filter((sql) => sql === 'begin');
    const commits = handle.sql().filter((sql) => sql === 'commit');
    // 1 vehicles transaction + 2 direction transactions.
    expect(begins).toHaveLength(3);
    expect(commits).toHaveLength(3);
  });

  it('writes tables in FK order inside the direction transaction', async () => {
    const handle = fakePool();
    await persistNetworkSeed(handle.pool, seedOf('schedule-loop'));
    const order = handle
      .sql()
      .map((sql): string | null => {
        if (sql.startsWith('insert into routes')) return 'routes';
        if (sql.startsWith('insert into route_directions')) return 'route_directions';
        if (sql.startsWith('insert into route_shapes')) return 'route_shapes';
        if (sql.startsWith('insert into stops')) return 'stops';
        if (sql.startsWith('delete from route_direction_stops')) return 'rds_delete';
        if (sql.startsWith('insert into route_direction_stops')) return 'rds_insert';
        if (sql.startsWith('insert into route_policies')) return 'route_policies';
        if (sql.startsWith('insert into route_direction_rollout_stages')) return 'rollout';
        return null;
      })
      .filter((label): label is string => label !== null);

    expect(order).toEqual([
      'routes',
      'route_directions',
      'route_shapes',
      'stops',
      'rds_delete',
      'rds_insert',
      'route_policies',
      'rollout',
    ]);
  });

  it('rolls back and commits nothing on a dry run, having executed every statement', async () => {
    const handle = fakePool();
    await persistNetworkSeed(handle.pool, seedOf('schedule-loop'), { dryRun: true });
    expect(handle.sql()).toContain('rollback');
    expect(handle.sql()).not.toContain('commit');
    // A dry run still exercises the real inserts, so constraint violations
    // still surface.
    expect(handle.sql().some((sql) => sql.startsWith('insert into route_shapes'))).toBe(true);
  });

  it('records a failed route-direction and keeps going', async () => {
    let seen = 0;
    const handle = fakePool((sql) => {
      if (sql.startsWith('insert into route_shapes')) {
        seen += 1;
        if (seen === 1) throw new Error('geometry rejected by PostGIS');
      }
      return undefined;
    });
    const seed = seedOf('schedule-suffixed-pair');
    const result = await persistNetworkSeed(handle.pool, seed);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.error).toContain('geometry rejected by PostGIS');
    // The other direction still landed — that is the point of per-direction
    // transactions.
    expect(result.directionsWritten).toBe(1);
    expect(handle.sql().filter((sql) => sql === 'rollback')).toHaveLength(1);
  });
});

describe('route_direction_stops', () => {
  it('is delete-then-insert, both inside the same transaction', async () => {
    // The table carries unique(route_direction_id, sequence) AND
    // unique(route_direction_id, stop_id). No `on conflict` clause can resolve
    // two stops swapping sequence between harvests.
    const handle = fakePool();
    await persistNetworkSeed(handle.pool, seedOf('schedule-loop'));
    const statements = handle.sql();
    const deleteIndex = statements.findIndex((sql) =>
      sql.startsWith('delete from route_direction_stops'),
    );
    const insertIndex = statements.findIndex((sql) =>
      sql.startsWith('insert into route_direction_stops'),
    );
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(deleteIndex);
    expect(statements.slice(deleteIndex, insertIndex)).not.toContain('commit');
    expect(statements[insertIndex]).not.toContain('on conflict');
  });

  it('sends dense sequences starting at 0', async () => {
    const handle = fakePool();
    await persistNetworkSeed(handle.pool, seedOf('schedule-loop'));
    const insert = handle.queries.find((entry) =>
      entry.sql.startsWith('insert into route_direction_stops'),
    )!;
    expect(insert.params[2]).toEqual([0, 1, 2]);
  });
});

describe('geography columns', () => {
  it('builds stop points longitude-first', async () => {
    const handle = fakePool();
    const seed = seedOf('schedule-loop');
    await persistNetworkSeed(handle.pool, seed);
    const insert = handle.queries.find((entry) => entry.sql.startsWith('insert into stops'))!;
    expect(insert.sql).toContain('ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography');
    // Param 3 is lon, param 4 is lat — never the other way round.
    expect(insert.params[2]).toEqual([80.9, 80.95, 80.92]);
    expect(insert.params[3]).toEqual([26.8, 26.85, 26.9]);
  });

  it('sends the shape as lon-lat WKT cast to geography 4326', async () => {
    const handle = fakePool();
    await persistNetworkSeed(handle.pool, seedOf('schedule-loop'));
    const insert = handle.queries.find((entry) => entry.sql.startsWith('insert into route_shapes'))!;
    expect(insert.sql).toContain('ST_GeomFromText($2, 4326)::geography');
    expect(insert.params[1]).toBe('LINESTRING(80.9 26.8,80.95 26.85,80.92 26.9)');
  });

  it('flags a stored total that disagrees with ST_Length beyond 1%', async () => {
    const handle = fakePool((sql, params) =>
      /returning ST_Length/i.test(sql)
        ? { rows: [{ postgis_length: String(Number(params[2]) * 1.05) }], rowCount: 1 }
        : undefined,
    );
    const result = await persistNetworkSeed(handle.pool, seedOf('schedule-loop'));
    expect(result.shapeDrift).toHaveLength(1);
    expect(result.shapeDrift[0]!.driftRatio).toBeCloseTo(0.05, 6);
  });

  it('reports no drift when the two agree', async () => {
    const handle = fakePool();
    const result = await persistNetworkSeed(handle.pool, seedOf('schedule-loop'));
    expect(result.shapeDrift).toEqual([]);
  });
});

/** The open policy row a re-run would find, as pg returns it (numerics as text). */
function openPolicyRow(overrides: Record<string, unknown> = {}) {
  return {
    rows: [
      {
        id: 'policy-1',
        target_headway_seconds: '1800',
        kf: '0.4',
        kb: '0.2',
        self_equalizing_k: '0.35',
        calibration_source: 'default',
        ...overrides,
      },
    ],
    rowCount: 1,
  };
}

describe('route_policies versioning', () => {
  it('inserts a first policy carrying kf / kb / self_equalizing_k', async () => {
    // All three are nullable with no default, and twoWayHold.ts returns []
    // when kf or kb is null.
    const handle = fakePool();
    await persistNetworkSeed(handle.pool, seedOf('schedule-loop'));
    const insert = handle.queries.find((entry) => entry.sql.startsWith('insert into route_policies'))!;
    expect(insert.sql).toContain('kf, kb, self_equalizing_k');
    expect(insert.params.slice(1, 5)).toEqual([1800, 0.4, 0.2, 0.35]);
    expect(handle.sql().some((sql) => sql.startsWith('update route_policies'))).toBe(false);
  });

  it('leaves an unchanged policy alone instead of versioning it on every run', async () => {
    const handle = fakePool((sql) =>
      sql.startsWith('select id, target_headway_seconds') ? openPolicyRow() : undefined,
    );
    const result = await persistNetworkSeed(handle.pool, seedOf('schedule-loop'));
    expect(result.policiesUnchanged).toBe(1);
    expect(result.policiesInserted).toBe(0);
    expect(handle.sql().some((sql) => sql.startsWith('insert into route_policies'))).toBe(false);
  });

  it('closes the open row before inserting when a value actually changed', async () => {
    const handle = fakePool((sql) =>
      sql.startsWith('select id, target_headway_seconds')
        ? openPolicyRow({ target_headway_seconds: '600' })
        : undefined,
    );
    const result = await persistNetworkSeed(handle.pool, seedOf('schedule-loop'));
    expect(result.policiesInserted).toBe(1);
    const statements = handle.sql();
    const closeIndex = statements.findIndex((sql) => sql.startsWith('update route_policies'));
    const insertIndex = statements.findIndex((sql) => sql.startsWith('insert into route_policies'));
    expect(closeIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(closeIndex);
    // effective_to must land strictly after effective_from — now() is
    // transaction time, so a same-transaction close would violate the check.
    expect(statements[closeIndex]).toContain("effective_from + interval '1 microsecond'");
  });

  it('re-versions a policy whose gains were nulled out', async () => {
    const handle = fakePool((sql) =>
      sql.startsWith('select id, target_headway_seconds')
        ? openPolicyRow({ kf: null, kb: null, self_equalizing_k: null })
        : undefined,
    );
    const result = await persistNetworkSeed(handle.pool, seedOf('schedule-loop'));
    expect(result.policiesInserted).toBe(1);
  });
});

describe('route_policies calibration_source', () => {
  it('writes the harvested source explicitly rather than letting the column default decide', async () => {
    // The column default is 'default', i.e. "fabricated" — omitting the value
    // would silently claim every seeded route has no real target.
    const handle = fakePool();
    const seed = seedOf('schedule-same-direction-repeat'); // two journeys -> journey_span
    expect(seed.routes[0]!.directions[0]!.policy.calibrationSource).toBe('journey_span');

    await persistNetworkSeed(handle.pool, seed);
    const insert = handle.queries.find((entry) => entry.sql.startsWith('insert into route_policies'))!;
    expect(insert.sql).toContain('calibration_source');
    // (route_direction_id, H*, kf, kb, self_equalizing_k, calibration_source, created_by)
    expect(insert.params[5]).toBe('journey_span');
    expect(insert.params[6]).toBe('network-seeder');
  });

  it("labels a fallback target 'default' all the way into the insert", async () => {
    const handle = fakePool();
    const seed = seedOf('schedule-loop'); // one journey, no live fleet -> fallback
    expect(seed.routes[0]!.directions[0]!.policy.calibrationSource).toBe('default');

    await persistNetworkSeed(handle.pool, seed);
    const insert = handle.queries.find((entry) => entry.sql.startsWith('insert into route_policies'))!;
    expect(insert.params[1]).toBe(1800);
    expect(insert.params[5]).toBe('default');
  });

  it('reads calibration_source back so it can take part in change detection', async () => {
    const handle = fakePool();
    await persistNetworkSeed(handle.pool, seedOf('schedule-loop'));
    const select = handle.queries.find((entry) =>
      entry.sql.startsWith('select id, target_headway_seconds'),
    )!;
    expect(select.sql).toContain('calibration_source');
  });

  it('re-versions a policy whose ONLY change is its provenance', async () => {
    // The run where a route stops being silently excluded from bunching
    // detection must appear in the version history even though H* itself did
    // not move — this is also how rows the migration back-filled as 'default'
    // get corrected.
    const handle = fakePool((sql) =>
      sql.startsWith('select id, target_headway_seconds')
        ? openPolicyRow({ target_headway_seconds: '23340', calibration_source: 'default' })
        : undefined,
    );
    const seed = seedOf('schedule-same-direction-repeat');
    expect(seed.routes[0]!.directions[0]!.policy).toMatchObject({
      targetHeadwaySeconds: 23_340,
      calibrationSource: 'journey_span',
    });

    const result = await persistNetworkSeed(handle.pool, seed);
    expect(result.policiesInserted).toBe(1);
    expect(result.policiesUnchanged).toBe(0);
    const statements = handle.sql();
    const closeIndex = statements.findIndex((sql) => sql.startsWith('update route_policies'));
    const insertIndex = statements.findIndex((sql) => sql.startsWith('insert into route_policies'));
    expect(closeIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(closeIndex);
    const insert = handle.queries.find((entry) => entry.sql.startsWith('insert into route_policies'))!;
    expect(insert.params[5]).toBe('journey_span');
  });

  it('sends only values the column CHECK constraint accepts', () => {
    // The seeder is the only writer of this column, so a source added in TS
    // without being added to the migration would not fail a type check, a lint
    // or any of the fake-pool tests above — it would fail in production, one
    // route-direction at a time, and each failure would be swallowed as a
    // per-direction `failure` while the route silently kept its old policy.
    const migration = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../db/migrations/20260809100000__route_policy_calibration.sql',
      ),
      'utf8',
    );
    const allowed = new Set(
      /check \(calibration_source in \(([^)]+)\)\)/
        .exec(migration)![1]!
        .split(',')
        .map((value) => value.trim().replace(/^'|'$/g, '')),
    );

    const seed = harvestNetwork(liveFeed, [
      probe('schedule-loop'),
      probe('schedule-same-direction-repeat'),
      probe('schedule-suffixed-pair'),
    ]);
    const emitted = new Set(
      seed.routes.flatMap((route) => route.directions.map((d) => d.policy.calibrationSource)),
    );
    expect(emitted.size).toBeGreaterThan(0);
    for (const source of emitted) expect(allowed).toContain(source);
    // And the migration must not have drifted away from what the seeder knows.
    expect([...allowed].sort()).toEqual(['default', 'fleet_span', 'journey_span']);
  });

  it('does not re-version when the source already matches', async () => {
    const handle = fakePool((sql) =>
      sql.startsWith('select id, target_headway_seconds')
        ? openPolicyRow({ target_headway_seconds: '23340', calibration_source: 'journey_span' })
        : undefined,
    );
    const result = await persistNetworkSeed(handle.pool, seedOf('schedule-same-direction-repeat'));
    expect(result.policiesUnchanged).toBe(1);
    expect(result.policiesInserted).toBe(0);
  });
});

describe('route_direction_rollout_stages', () => {
  it('creates a stage row and an audit entry for a new route-direction', async () => {
    // Without a row, gate.ts 403s every command on the route — the row is what
    // makes the command path reachable at all.
    const handle = fakePool();
    const result = await persistNetworkSeed(handle.pool, seedOf('schedule-loop'));
    expect(result.rolloutStagesWritten).toBe(1);
    const insert = handle.queries.find((entry) =>
      entry.sql.startsWith('insert into route_direction_rollout_stages'),
    )!;
    expect(insert.params[1]).toBe('observation');
    const audit = handle.queries.find((entry) =>
      entry.sql.startsWith('insert into rollout_stage_audit_log'),
    )!;
    expect(audit.params[1]).toBeNull();
    expect(audit.params[2]).toBe('observation');
  });

  it('never demotes a stage an operator promoted', async () => {
    const handle = fakePool((sql) =>
      sql.startsWith('select stage from route_direction_rollout_stages')
        ? { rows: [{ stage: 'advisory' }], rowCount: 1 }
        : undefined,
    );
    const result = await persistNetworkSeed(handle.pool, seedOf('schedule-loop'));
    expect(result.rolloutStagesPreserved).toBe(1);
    expect(result.rolloutStagesWritten).toBe(0);
    expect(
      handle.sql().some((sql) => sql.startsWith('insert into route_direction_rollout_stages')),
    ).toBe(false);
  });

  it('overwrites only when explicitly forced, and audits the change', async () => {
    const handle = fakePool((sql) =>
      sql.startsWith('select stage from route_direction_rollout_stages')
        ? { rows: [{ stage: 'advisory' }], rowCount: 1 }
        : undefined,
    );
    const result = await persistNetworkSeed(handle.pool, seedOf('schedule-loop'), {
      forceRolloutStage: true,
    });
    expect(result.rolloutStagesWritten).toBe(1);
    const audit = handle.queries.find((entry) =>
      entry.sql.startsWith('insert into rollout_stage_audit_log'),
    )!;
    expect(audit.params[1]).toBe('advisory');
    expect(audit.params[2]).toBe('observation');
  });
});

describe('idempotence', () => {
  it('replays byte-identical statements on a second run', async () => {
    // The already-seeded state is simulated by answering the policy lookup
    // with the values the first run wrote.
    const responder: Responder = (sql) =>
      sql.startsWith('select id, target_headway_seconds') ? openPolicyRow() : undefined;

    const seed = seedOf('schedule-suffixed-pair');
    const first = fakePool(responder);
    const second = fakePool(responder);
    await persistNetworkSeed(first.pool, seed);
    await persistNetworkSeed(second.pool, seed);
    expect(second.queries).toEqual(first.queries);
  });
});
