// HTTP layer for the telemetry intake. The pipeline itself is covered by
// test/ingestionPipeline.test.ts; here it is mocked, the same way
// test/headwayRoutes.test.ts mocks the headway service.
//
// The response contract is the unusual part and is deliberate: a poll
// cycle carries ~665 vehicles, so partial success cannot be expressed by a
// status code. The route answers 200 with a per-event `rejected` array,
// and reserves non-200 for a malformed ENVELOPE - the one case where we
// cannot even tell how many events were sent.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../src/ingestion/pipeline.js', () => ({
  ingestPositionEvents: vi.fn(),
  getIngestStats: vi.fn(() => ({ lastEventAt: null, eventsLastCycle: 0 })),
  _resetIngestStatsForTests: vi.fn(),
}));

vi.mock('../src/state-estimation/singleton.js', () => ({
  getNetworkGeometryCache: vi.fn(),
  getStateEstimationService: vi.fn(() => ({ isRehydrated: false })),
}));

const { createApp } = await import('../src/app.js');
const { ingestPositionEvents } = await import('../src/ingestion/pipeline.js');
const { getNetworkGeometryCache } = await import('../src/state-estimation/singleton.js');

const AUTH_HEADER = 'Bearer test-service-token-secret-value';

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    vehicleId: 'UP77AN2509',
    lat: 26.8467,
    lon: 80.9462,
    headingDegrees: 91,
    speedKmph: 32,
    observedAt: '2026-08-05T08:00:00.000Z',
    ...overrides,
  };
}

describe('POST /v1/positions', () => {
  beforeEach(() => {
    vi.mocked(ingestPositionEvents).mockReset();
    vi.mocked(ingestPositionEvents).mockResolvedValue({ accepted: 1, rejected: [] });
  });

  it('is registered and requires the service token', async () => {
    const res = await request(createApp())
      .post('/v1/positions')
      .send({ events: [validEvent()] });

    expect(res.status).toBe(401);
    expect(ingestPositionEvents).not.toHaveBeenCalled();
  });

  it('accepts a batch and returns {accepted, rejected}', async () => {
    const res = await request(createApp())
      .post('/v1/positions')
      .set('authorization', AUTH_HEADER)
      .send({ events: [validEvent(), validEvent({ vehicleId: 'UP32BN1111' })] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: 1, rejected: [] });
  });

  it('answers 200 with per-event verdicts on a PARTIAL failure, not a 4xx for the whole batch', async () => {
    // One unregistered bus must never fail the other 664 good fixes.
    vi.mocked(ingestPositionEvents).mockResolvedValue({
      accepted: 1,
      rejected: [
        { index: 1, vehicleId: 'ghost', code: 'unknown_vehicle', message: 'not registered' },
      ],
    });

    const res = await request(createApp())
      .post('/v1/positions')
      .set('authorization', AUTH_HEADER)
      .send({ events: [validEvent(), validEvent({ vehicleId: 'ghost' })] });

    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0]).toMatchObject({ index: 1, code: 'unknown_vehicle' });
  });

  it('rejects a malformed envelope with 400 - the one case with no per-event result set', async () => {
    const res = await request(createApp())
      .post('/v1/positions')
      .set('authorization', AUTH_HEADER)
      .send({ notEvents: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
    expect(ingestPositionEvents).not.toHaveBeenCalled();
  });

  it('rejects an empty batch', async () => {
    const res = await request(createApp())
      .post('/v1/positions')
      .set('authorization', AUTH_HEADER)
      .send({ events: [] });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown field rather than silently dropping it', async () => {
    // `.strict()`: a caller sending `lng` instead of `lon` gets a loud 400
    // instead of a bus that never moves.
    const res = await request(createApp())
      .post('/v1/positions')
      .set('authorization', AUTH_HEADER)
      .send({ events: [{ ...validEvent(), lng: 80.9 }] });
    expect(res.status).toBe(400);
  });

  it('CLAMPS a bare 360 heading instead of rejecting an otherwise good fix', async () => {
    await request(createApp())
      .post('/v1/positions')
      .set('authorization', AUTH_HEADER)
      .send({ events: [validEvent({ headingDegrees: 360 })] });

    const events = vi.mocked(ingestPositionEvents).mock.calls[0]?.[0];
    expect(events?.[0]?.headingDegrees).toBe(0);
  });

  it('defaults autoRegisterVehicles to FALSE so an ad-hoc caller cannot create master data', async () => {
    await request(createApp())
      .post('/v1/positions')
      .set('authorization', AUTH_HEADER)
      .send({ events: [validEvent()] });

    expect(vi.mocked(ingestPositionEvents).mock.calls[0]?.[1]).toEqual({
      autoRegisterVehicles: false,
    });
  });

  it('honours an explicit autoRegisterVehicles: true', async () => {
    await request(createApp())
      .post('/v1/positions')
      .set('authorization', AUTH_HEADER)
      .send({ events: [validEvent()], autoRegisterVehicles: true });

    expect(vi.mocked(ingestPositionEvents).mock.calls[0]?.[1]).toEqual({
      autoRegisterVehicles: true,
    });
  });

  it('propagates a datastore outage as a 503 rather than a 200 that claims success', async () => {
    const { AppError } = await import('../src/lib/errors.js');
    vi.mocked(ingestPositionEvents).mockRejectedValue(
      new AppError('ingest_unavailable', 'not accepting writes', 503),
    );

    const res = await request(createApp())
      .post('/v1/positions')
      .set('authorization', AUTH_HEADER)
      .send({ events: [validEvent()] });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ingest_unavailable');
  });
});

describe('POST /v1/admin/geometry/refresh', () => {
  it('requires the service token', async () => {
    const res = await request(createApp()).post('/v1/admin/geometry/refresh');
    expect(res.status).toBe(401);
  });

  it('invalidates and re-warms the geometry cache', async () => {
    // The TTL is only a backstop; this is the intended path after an
    // operator re-runs the seeder, so new shapes go live immediately
    // rather than up to SHAPE_CACHE_TTL_MS later.
    const invalidate = vi.fn();
    const warm = vi.fn().mockResolvedValue({ version: 2, shapes: [{ routeDirectionId: 'rd-1' }] });
    vi.mocked(getNetworkGeometryCache).mockReturnValue({
      invalidate,
      warm,
      stats: { version: 2, shapeCount: 1, loadedAt: '2026-08-05T08:00:00.000Z' },
    } as unknown as ReturnType<typeof getNetworkGeometryCache>);

    const res = await request(createApp())
      .post('/v1/admin/geometry/refresh')
      .set('authorization', AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(invalidate).toHaveBeenCalled();
    expect(warm).toHaveBeenCalled();
    expect(res.body).toMatchObject({ refreshed: true, version: 2, shapeCount: 1 });
  });
});
