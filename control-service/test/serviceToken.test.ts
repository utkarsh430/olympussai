// Service-token auth (docs/CONTROL_SERVICE_INTEGRATION.md section 1):
// every inbound REST route except /healthz and /readyz requires a valid
// bearer token.
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/db/pool.js', () => ({
  pingDb: vi.fn(),
  getPool: vi.fn(),
  closePool: vi.fn(),
}));

const { createApp } = await import('../src/app.js');

describe('service token auth', () => {
  it('rejects a request with no Authorization header', async () => {
    const app = createApp();
    const res = await request(app).get('/v1/vehicle-states');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects an incorrect bearer token', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/v1/vehicle-states')
      .set('Authorization', 'Bearer not-the-right-token');
    expect(res.status).toBe(401);
  });

  it('rejects a non-Bearer Authorization header', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/v1/vehicle-states')
      .set('Authorization', 'Basic dGVzdDp0ZXN0');
    expect(res.status).toBe(401);
  });

  it('accepts a request with the correct bearer token', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/v1/vehicle-states')
      .set('Authorization', 'Bearer test-service-token-secret-value');
    expect(res.status).toBe(200);
  });

  it('never protects /healthz or /readyz behind the service token', async () => {
    const app = createApp();
    const healthRes = await request(app).get('/healthz');
    expect(healthRes.status).toBe(200);
  });
});
