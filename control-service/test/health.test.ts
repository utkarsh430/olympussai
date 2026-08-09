// /healthz and /readyz contract per
// docs/CONTROL_SERVICE_DEPLOYMENT.md "Health/readiness contract".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

vi.mock('../src/db/pool.js', () => ({
  pingDb: vi.fn(),
  getPool: vi.fn(),
  closePool: vi.fn(),
}));

const { pingDb } = await import('../src/db/pool.js');
const { stateStore } = await import('../src/state/store.js');
const { createApp } = await import('../src/app.js');
const { _resetEnvCacheForTests } = await import('../src/config/env.js');
const { rehydrateState, getNetworkCounts, _resetNetworkCountsForTests } = await import(
  '../src/db/rehydrate.js'
);
const { _resetIngestStatsForTests } = await import('../src/ingestion/pipeline.js');

describe('GET /healthz', () => {
  it('returns 200 without touching the database, even before rehydration', async () => {
    stateStore._resetForTests();
    const app = createApp();
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(pingDb).not.toHaveBeenCalled();
  });

  it('does not require a service token', async () => {
    const app = createApp();
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
  });
});

describe('GET /readyz', () => {
  beforeEach(() => {
    stateStore._resetForTests();
    vi.mocked(pingDb).mockReset();
  });

  afterEach(() => {
    stateStore._resetForTests();
  });

  it('returns 503 while state rehydration has not completed', async () => {
    stateStore.setStatus('in_progress');
    const app = createApp();
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body.stateRehydrationComplete).toBe(false);
  });

  it('returns 503 if rehydration failed', async () => {
    stateStore.setStatus('failed', 'boom');
    const app = createApp();
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
  });

  it('returns 503 when rehydrated but the DB round-trip fails', async () => {
    stateStore.setStatus('complete');
    vi.mocked(pingDb).mockRejectedValueOnce(new Error('connection refused'));
    const app = createApp();
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body.dbReachable).toBe(false);
  });

  it('returns 200 with rehydration-complete + db round-trip once ready', async () => {
    stateStore.setStatus('complete');
    vi.mocked(pingDb).mockResolvedValueOnce(undefined);
    const app = createApp();
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ready',
      stateRehydrationComplete: true,
      dbReachable: true,
    });
  });
});

// An instance with no seeded network is the nastiest kind of broken: every
// query succeeds, rehydration "completes", the DB pings fine - and every
// position fix short-circuits to `off_route` because there is no geometry
// to map-match against, so headway, bunching detection and MPC all
// silently produce nothing. Readiness exists to catch exactly this, so the
// probe has to look at whether the network is there, not just whether the
// database answered.
describe('GET /readyz network-seeding gate', () => {
  /** Serves the shape of every rehydration query, with the network counts under test. */
  function fakePool(routeDirectionsWithShape: number, vehicles: number) {
    return {
      query: vi.fn((sql: string) => {
        if (sql.includes('route_directions_with_shape')) {
          return Promise.resolve({
            rows: [{ route_directions_with_shape: String(routeDirectionsWithShape), vehicles: String(vehicles) }],
          });
        }
        return Promise.resolve({ rows: [] });
      }),
    } as unknown as Parameters<typeof rehydrateState>[0];
  }

  beforeEach(() => {
    stateStore._resetForTests();
    _resetNetworkCountsForTests();
    _resetIngestStatsForTests();
    vi.mocked(pingDb).mockReset();
    vi.mocked(pingDb).mockResolvedValue(undefined);
    process.env.REQUIRE_SEEDED_NETWORK = 'true';
    _resetEnvCacheForTests();
  });

  afterEach(() => {
    delete process.env.REQUIRE_SEEDED_NETWORK;
    _resetEnvCacheForTests();
    _resetNetworkCountsForTests();
    stateStore._resetForTests();
  });

  it('returns 503 network_not_seeded when no active route-direction has a shape', async () => {
    await rehydrateState(fakePool(0, 0));
    expect(getNetworkCounts().routeDirectionsWithShape).toBe(0);

    const res = await request(createApp()).get('/readyz');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'not_ready', reason: 'network_not_seeded' });
    // Rehydration itself succeeded - the instance is refusing traffic for
    // the network, not for a database failure, and the body must say so.
    expect(res.body.stateRehydrationComplete).toBe(true);
    expect(res.body.dbReachable).toBe(true);
  });

  it('returns 200 once at least one active route-direction has a shape', async () => {
    await rehydrateState(fakePool(1020, 9261));

    const res = await request(createApp()).get('/readyz');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.counts).toMatchObject({ routeDirectionsWithShape: 1020, vehicles: 9261 });
  });

  it('reports estimator + ingest observability fields on the 200', async () => {
    await rehydrateState(fakePool(5, 5));

    const res = await request(createApp()).get('/readyz');

    expect(res.body.estimator).toMatchObject({ rehydrated: expect.any(Boolean) });
    expect(res.body.estimator).toHaveProperty('shapeCacheVersion');
    expect(res.body.estimator).toHaveProperty('shapeCacheLoadedAt');
    expect(res.body.ingest).toEqual({ lastEventAt: null, eventsLastCycle: 0 });
  });

  it('keeps a silent GPS poller a 200 field, NOT a 503 trigger', async () => {
    // Pulling a healthy instance out of rotation because an upstream feed
    // went quiet would take the fleet's whole API down mid-deploy for a
    // problem no restart can fix. lastEventAt is for alerting, not routing.
    await rehydrateState(fakePool(5, 5));

    const res = await request(createApp()).get('/readyz');

    expect(res.status).toBe(200);
    expect(res.body.ingest.lastEventAt).toBeNull();
  });

  it('does not gate on the network when REQUIRE_SEEDED_NETWORK is off (the default in tests)', async () => {
    process.env.REQUIRE_SEEDED_NETWORK = 'false';
    _resetEnvCacheForTests();
    await rehydrateState(fakePool(0, 0));

    const res = await request(createApp()).get('/readyz');
    expect(res.status).toBe(200);
  });
});
