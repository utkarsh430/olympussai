// HTTP layer for the rehearsal endpoint: auth, validation, and the refusal
// reaching the caller as a 404 rather than as a 500 or, worse, as a run.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/rehearsal/corridor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/rehearsal/corridor.js')>();
  return { ...actual, loadCorridorInputs: vi.fn() };
});

const { createApp } = await import('../../src/app.js');
const { loadCorridorInputs, uncalibratedCorridorError } = await import('../../src/rehearsal/corridor.js');
const { DEFAULT_MODELLED_INPUTS } = await import('../../src/rehearsal/run.js');
type CorridorInputs = Awaited<ReturnType<typeof loadCorridorInputs>>;

const AUTH_HEADER = 'Bearer test-service-token-secret-value';
const PATH = '/v1/route-directions/rd-1/rehearsal';

function corridor(): CorridorInputs {
  const stops = Array.from({ length: 6 }, (_, index) => ({
    stopId: `stop-${index}`,
    name: `Stop ${index}`,
    sequence: index,
    cumulativeDistanceMeters: index * 10_000,
    isControlPoint: index > 0 && index % 2 === 0,
    maxHoldSeconds: null,
    latitude: 26.8 - index * 0.05,
    longitude: 80.9 - index * 0.05,
  }));
  return {
    routeDirectionId: 'rd-1',
    routeId: '1348',
    routeName: 'Lucknow - Kanpur',
    directionCode: 'OUT',
    isLoop: false,
    totalDistanceMeters: 50_000,
    calibrationSource: 'timetable',
    policy: {
      id: 'policy-1',
      routeDirectionId: 'rd-1',
      operatingPeriod: 'all',
      dayType: 'all',
      targetHeadwaySeconds: 900,
      bunchedThresholdRatio: 0.25,
      warningThresholdRatio: 0.5,
      kf: 0.6,
      kb: 0.3,
      selfEqualizingK: 0.5,
      maxHoldSeconds: 90,
      cooldownSeconds: 60,
      predictionHorizonControlPoints: 3,
      occupancyStaleSeconds: null,
      occupancyCapacity: null,
    },
    stops,
    shape: stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
  };
}

describe('POST /v1/route-directions/:routeDirectionId/rehearsal', () => {
  beforeEach(() => {
    vi.mocked(loadCorridorInputs).mockReset();
  });

  it('requires the service token like every other /v1 route', async () => {
    const response = await request(createApp()).post(PATH).send({});
    expect(response.status).toBe(401);
    expect(loadCorridorInputs).not.toHaveBeenCalled();
  });

  // THE ONE THAT MATTERS. 561 of 759 corridors are in this state, and the
  // answer has to be a refusal a surface can explain, not a simulation run
  // against a sentinel.
  it('refuses an uncalibrated corridor with 404 no_active_policy', async () => {
    vi.mocked(loadCorridorInputs).mockRejectedValue(uncalibratedCorridorError('rd-561'));

    const response = await request(createApp())
      .post('/v1/route-directions/rd-561/rehearsal')
      .set('Authorization', AUTH_HEADER)
      .send({});

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('no_active_policy');
    expect(response.body.error.message).toMatch(/no measured target headway/i);
  });

  it('runs a calibrated corridor and returns both arms with a provenance manifest', async () => {
    vi.mocked(loadCorridorInputs).mockResolvedValue(corridor());

    const response = await request(createApp()).post(PATH).set('Authorization', AUTH_HEADER).send({});

    expect(response.status).toBe(200);
    expect(response.body.arms.uncontrolled.name).toBe('no-control');
    expect(response.body.arms.controlled.name).toBe('deployed-control-laws');
    const provenance = response.body.provenance as { source: string }[];
    expect(provenance.some((entry) => entry.source === 'modelled')).toBe(true);
    expect(response.body.policy.targetHeadwaySeconds).toBe(900);
    expect(response.body.inputs).toMatchObject({ vehicleCount: DEFAULT_MODELLED_INPUTS.vehicleCount });
  });

  it('accepts operator-supplied modelled inputs and echoes exactly what it ran', async () => {
    vi.mocked(loadCorridorInputs).mockResolvedValue(corridor());

    const response = await request(createApp())
      .post(PATH)
      .set('Authorization', AUTH_HEADER)
      .send({ vehicleCount: 8, cruiseSpeedKmph: 45, disturbance: 'demand_burst' });

    expect(response.status).toBe(200);
    expect(response.body.inputs.vehicleCount).toBe(8);
    expect(response.body.inputs.cruiseSpeedKmph).toBe(45);
    expect(response.body.inputs.disturbance).toBe('demand_burst');
  });

  // Refuse, do not clamp. A clamped run is a different simulation returned
  // as though it were the one that was asked for.
  it('refuses an out-of-range input rather than quietly running a different simulation', async () => {
    vi.mocked(loadCorridorInputs).mockResolvedValue(corridor());

    const response = await request(createApp())
      .post(PATH)
      .set('Authorization', AUTH_HEADER)
      .send({ vehicleCount: 500 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_request');
    expect(loadCorridorInputs).not.toHaveBeenCalled();
  });

  it('refuses an unknown disturbance rather than falling back to none', async () => {
    vi.mocked(loadCorridorInputs).mockResolvedValue(corridor());

    const response = await request(createApp())
      .post(PATH)
      .set('Authorization', AUTH_HEADER)
      .send({ disturbance: 'earthquake' });

    expect(response.status).toBe(400);
  });
});
