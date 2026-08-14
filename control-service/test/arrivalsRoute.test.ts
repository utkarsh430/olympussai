// HTTP-layer tests for the arrivals route: auth, validation, and - most
// importantly - that a refusal travels as a 200 with a reason rather than as an
// error the caller has to invent a substitute for.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../src/arrival-prediction/service.js', () => ({
  getVehicleArrivals: vi.fn(),
}));

const { createApp } = await import('../src/app.js');
const { getVehicleArrivals } = await import('../src/arrival-prediction/service.js');
const { MAX_STOP_LIMIT, MAX_HORIZON_SECONDS } = await import('../src/arrival-prediction/predict.js');
type ArrivalPredictionResponse = Awaited<ReturnType<typeof getVehicleArrivals>>;

const AUTH_HEADER = 'Bearer test-service-token-secret-value';

const available: ArrivalPredictionResponse = {
  vehicleId: 'UP78JT5520',
  generatedAt: '2026-08-14T10:00:00.000Z',
  horizonSeconds: 3_600,
  stopLimit: 8,
  prediction: {
    status: 'available',
    routeDirectionId: 'rd-1',
    observedAt: '2026-08-14T09:59:30.000Z',
    stateAgeSeconds: 30,
    vehicle: {
      distanceAlongRouteMeters: 4_000,
      matchConfidence: 0.8,
      stopState: 'departed_stop',
      currentStopId: null,
    },
    speed: {
      basis: 'vehicle_smoothed_speed',
      speedKmph: 40,
      sampleCount: 1,
      relativeSpread: 0.25,
      peerWindowMeters: null,
    },
    dwell: {
      basis: 'configured_default',
      measured: false,
      secondsPerIntermediateStop: 45,
      currentStop: { basis: 'not_at_stop', remainingSeconds: 0 },
    },
    arrivals: [],
  },
};

const unavailable: ArrivalPredictionResponse = {
  vehicleId: 'UP78JT5520',
  generatedAt: '2026-08-14T10:00:00.000Z',
  horizonSeconds: 3_600,
  stopLimit: 8,
  prediction: {
    status: 'unavailable',
    reason: 'off_route',
    detail: 'This vehicle could not be matched to a route.',
    routeDirectionId: null,
    observedAt: '2026-08-14T09:59:30.000Z',
    stateAgeSeconds: 30,
    arrivals: [],
  },
};

describe('GET /v1/vehicles/:vehicleId/arrivals', () => {
  beforeEach(() => {
    vi.mocked(getVehicleArrivals).mockReset();
  });

  it('requires the service token', async () => {
    const res = await request(createApp()).get('/v1/vehicles/UP78JT5520/arrivals');
    expect(res.status).toBe(401);
    expect(getVehicleArrivals).not.toHaveBeenCalled();
  });

  it('returns the prediction', async () => {
    vi.mocked(getVehicleArrivals).mockResolvedValue(available);
    const res = await request(createApp())
      .get('/v1/vehicles/UP78JT5520/arrivals')
      .set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.body.prediction.status).toBe('available');
    expect(getVehicleArrivals).toHaveBeenCalledWith('UP78JT5520', {
      stopLimit: undefined,
      horizonSeconds: undefined,
    });
  });

  it('returns 200 with a named reason when no prediction can be made', async () => {
    // The load-bearing case. A 4xx here would push every caller into a catch
    // block, and on this product the nearest thing to hand in a catch block is
    // the published timetable - which is exactly the substitution this whole
    // subsystem exists to prevent.
    vi.mocked(getVehicleArrivals).mockResolvedValue(unavailable);
    const res = await request(createApp())
      .get('/v1/vehicles/UP78JT5520/arrivals')
      .set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.body.prediction.status).toBe('unavailable');
    expect(res.body.prediction.reason).toBe('off_route');
    expect(res.body.prediction.arrivals).toEqual([]);
  });

  it('always ships an arrivals array, so a caller that ignores status renders nothing', async () => {
    vi.mocked(getVehicleArrivals).mockResolvedValue(unavailable);
    const res = await request(createApp())
      .get('/v1/vehicles/UP78JT5520/arrivals')
      .set('Authorization', AUTH_HEADER);
    expect(Array.isArray(res.body.prediction.arrivals)).toBe(true);
    expect(res.body.prediction.arrivals).toHaveLength(0);
  });

  it('passes through limit and horizon', async () => {
    vi.mocked(getVehicleArrivals).mockResolvedValue(available);
    await request(createApp())
      .get('/v1/vehicles/UP78JT5520/arrivals?limit=3&horizonSeconds=900')
      .set('Authorization', AUTH_HEADER);
    expect(getVehicleArrivals).toHaveBeenCalledWith('UP78JT5520', {
      stopLimit: 3,
      horizonSeconds: 900,
    });
  });

  it.each([
    ['limit=0', 'limit=0'],
    ['a limit past the cap', `limit=${MAX_STOP_LIMIT + 1}`],
    ['a non-numeric limit', 'limit=all'],
    ['a horizon past the cap', `horizonSeconds=${MAX_HORIZON_SECONDS + 1}`],
    ['a negative horizon', 'horizonSeconds=-5'],
  ])('rejects %s with 400 rather than quietly clamping it', async (_label, query) => {
    const res = await request(createApp())
      .get(`/v1/vehicles/UP78JT5520/arrivals?${query}`)
      .set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
    expect(getVehicleArrivals).not.toHaveBeenCalled();
  });

  it('surfaces an unexpected failure as a 500 without leaking internals', async () => {
    vi.mocked(getVehicleArrivals).mockRejectedValue(new Error('connection terminated unexpectedly'));
    const res = await request(createApp())
      .get('/v1/vehicles/UP78JT5520/arrivals')
      .set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal_error');
    expect(JSON.stringify(res.body)).not.toContain('connection terminated');
  });
});
