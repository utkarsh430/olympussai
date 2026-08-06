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
