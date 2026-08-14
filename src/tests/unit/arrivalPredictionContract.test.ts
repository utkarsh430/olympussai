// @vitest-environment node
//
// The web side of the arrival-prediction contract: the wire schema, and the
// driver-facing route that serves it.
//
// The schema tests are not shape-checking for its own sake. This schema is the
// boundary at which a control-service response becomes something a driver's
// screen will render, and the properties asserted here are the ones that keep a
// timetable time, a stale number, or an unexplained blank from crossing it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  arrivalPredictionResponseSchema,
  predictionEnvelopeSchema,
  type ArrivalPredictionResponse,
} from '@/models/control';

const AVAILABLE: ArrivalPredictionResponse = {
  vehicleId: 'UP78JT5520',
  generatedAt: '2026-08-14T10:00:00.000Z',
  horizonSeconds: 3600,
  stopLimit: 6,
  prediction: {
    status: 'available',
    routeDirectionId: 'rd-1',
    observedAt: '2026-08-14T09:59:30.000Z',
    stateAgeSeconds: 30,
    vehicle: {
      distanceAlongRouteMeters: 4000,
      matchConfidence: 0.81,
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
    arrivals: [
      {
        stopId: 's2',
        stopName: 'Faridpur',
        sequence: 2,
        isControlPoint: false,
        distanceRemainingMeters: 4000,
        intermediateStopCount: 0,
        status: 'predicted',
        etaSeconds: 330,
        etaAt: '2026-08-14T10:05:30.000Z',
        lowerBoundSeconds: 264,
        upperBoundSeconds: 450,
        confidence: 0.68,
        confidenceBand: 'firm',
        components: {
          travelSeconds: 360,
          dwellSeconds: 0,
          currentStopDwellSeconds: 0,
          stateAgeSeconds: 30,
        },
      },
      {
        stopId: 's3',
        stopName: 'Tilhar',
        sequence: 3,
        isControlPoint: false,
        distanceRemainingMeters: 40000,
        intermediateStopCount: 1,
        status: 'unavailable',
        reason: 'beyond_prediction_horizon',
      },
    ],
  },
};

const UNAVAILABLE: ArrivalPredictionResponse = {
  vehicleId: 'UP78JT5520',
  generatedAt: '2026-08-14T10:00:00.000Z',
  horizonSeconds: 3600,
  stopLimit: 6,
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

describe('arrivalPredictionResponseSchema', () => {
  it('accepts a full prediction and a full refusal', () => {
    expect(arrivalPredictionResponseSchema.parse(AVAILABLE)).toEqual(AVAILABLE);
    expect(arrivalPredictionResponseSchema.parse(UNAVAILABLE)).toEqual(UNAVAILABLE);
  });

  it('refuses a refusal that smuggles arrivals in with it', () => {
    // The structural safety property: on the unavailable branch `arrivals` is
    // empty, so a consumer that ignores `status` and just maps the array shows
    // nothing. A payload that violated it would defeat every other guarantee.
    const smuggled = {
      ...UNAVAILABLE,
      prediction: {
        ...UNAVAILABLE.prediction,
        arrivals: [{ stopId: 's2', etaSeconds: 240 }],
      },
    };
    expect(arrivalPredictionResponseSchema.safeParse(smuggled).success).toBe(false);
  });

  it('refuses a dwell block that claims to be measured', () => {
    // `measured: false` is a literal, not a boolean. Dwell in this model is a
    // configured constant; a payload asserting otherwise is either a different
    // service or a bug, and either way must not render as evidence.
    const lying = structuredClone(AVAILABLE) as unknown as {
      prediction: { dwell: { measured: boolean; basis: string } };
    };
    lying.prediction.dwell.measured = true;
    expect(arrivalPredictionResponseSchema.safeParse(lying).success).toBe(false);
  });

  it('has nowhere to put a timetable time', () => {
    // The schema strips unknown keys rather than carrying them. A future caller
    // that tries to thread a scheduled time through this response finds it
    // silently dropped here instead of arriving at a renderer that cannot tell
    // it apart from a prediction.
    const withSchedule = structuredClone(AVAILABLE) as unknown as Record<string, unknown>;
    (withSchedule.prediction as Record<string, unknown>).scheduledArrival = '10:06:00';
    const parsed = arrivalPredictionResponseSchema.parse(withSchedule);
    expect(parsed.prediction).not.toHaveProperty('scheduledArrival');
  });

  it('rejects an unrecognised refusal reason rather than rendering it raw', () => {
    const unknownReason = structuredClone(UNAVAILABLE) as unknown as {
      prediction: { reason: string };
    };
    unknownReason.prediction.reason = 'we_just_did_not_feel_like_it';
    expect(arrivalPredictionResponseSchema.safeParse(unknownReason).success).toBe(false);
  });

  it('rejects a speed basis this service cannot actually measure', () => {
    // There is no configured-constant speed basis, and adding one has to be a
    // deliberate change to both ends rather than a value that just appears.
    const invented = structuredClone(AVAILABLE) as unknown as {
      prediction: { speed: { basis: string } };
    };
    invented.prediction.speed.basis = 'network_average_speed';
    expect(arrivalPredictionResponseSchema.safeParse(invented).success).toBe(false);
  });

  it('discriminates the envelope on status, so neither branch can be read as the other', () => {
    const noStatus = { ...UNAVAILABLE.prediction } as Record<string, unknown>;
    delete noStatus.status;
    expect(predictionEnvelopeSchema.safeParse(noStatus).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------

const requireOpsRole = vi.fn();
const findUserById = vi.fn();
const fetchVehicleArrivals = vi.fn();

vi.mock('@/lib/auth/rbac/guard', () => ({
  requireOpsRole: (...args: unknown[]) => requireOpsRole(...args),
}));
vi.mock('@/lib/auth/rbac/repo', () => ({
  getOpsRepo: () => ({ findUserById }),
}));
vi.mock('@/lib/controlService/arrivals', () => ({
  fetchVehicleArrivals: (...args: unknown[]) => fetchVehicleArrivals(...args),
}));

const CALLER_CLAIMS = { sub: 'driver-1', email: 'd1@example.com', role: 'pilot_driver' as const };
const ASSIGNED_VEHICLE = 'BUS-100';

describe('GET /api/ops/pilot-driver/arrivals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireOpsRole.mockResolvedValue({ ok: true, claims: CALLER_CLAIMS });
  });

  it('predicts only for the caller’s own assigned vehicle, and takes no input at all', async () => {
    findUserById.mockResolvedValue({ id: 'driver-1', vehicleId: ASSIGNED_VEHICLE });
    fetchVehicleArrivals.mockResolvedValue(AVAILABLE);

    const { GET } = await import('@/app/api/ops/pilot-driver/arrivals/route');
    // GET() takes no arguments by construction: there is no `?vehicleId=` for a
    // caller to smuggle another depot's bus through. A per-vehicle read that
    // accepts a client-supplied id is an enumeration endpoint for the whole
    // state fleet.
    expect(GET.length).toBe(0);

    const response = await GET();
    expect(response.status).toBe(200);
    expect(fetchVehicleArrivals).toHaveBeenCalledWith(ASSIGNED_VEHICLE, { limit: 6 });
    expect(await response.json()).toEqual(AVAILABLE);
  });

  it('restricts the route to the pilot_driver role', async () => {
    const { GET } = await import('@/app/api/ops/pilot-driver/arrivals/route');
    await GET().catch(() => undefined);
    expect(requireOpsRole).toHaveBeenCalledWith(['pilot_driver']);
  });

  it('refuses a rejected caller without touching the control service', async () => {
    requireOpsRole.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    });
    const { GET } = await import('@/app/api/ops/pilot-driver/arrivals/route');
    const response = await GET();
    expect(response.status).toBe(403);
    expect(fetchVehicleArrivals).not.toHaveBeenCalled();
  });

  it('tells a driver with no assigned bus to contact their admin, rather than polling forever', async () => {
    findUserById.mockResolvedValue({ id: 'driver-1', vehicleId: null });
    const { GET } = await import('@/app/api/ops/pilot-driver/arrivals/route');
    const response = await GET();
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('VEHICLE_NOT_ASSIGNED');
    expect(fetchVehicleArrivals).not.toHaveBeenCalled();
  });

  it('reports an unreachable control service as an outage, not as "no arrival times"', async () => {
    // These are different facts - "we looked and cannot predict this bus" versus
    // "nobody looked" - and collapsing them would let an outage read on a
    // driver's screen as a calm, normal absence of predictions.
    const { ControlServiceUnavailableError } = await import('@/lib/controlService/client');
    findUserById.mockResolvedValue({ id: 'driver-1', vehicleId: ASSIGNED_VEHICLE });
    fetchVehicleArrivals.mockRejectedValue(new ControlServiceUnavailableError('circuit open'));

    const { GET } = await import('@/app/api/ops/pilot-driver/arrivals/route');
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe('CONTROL_SERVICE_UNAVAILABLE');
    expect(body).not.toHaveProperty('prediction');
  });

  it('never lets a driver response be cached', async () => {
    // A cached countdown is a countdown computed from a position that was
    // already old when it was computed, re-served with no way to tell.
    findUserById.mockResolvedValue({ id: 'driver-1', vehicleId: ASSIGNED_VEHICLE });
    fetchVehicleArrivals.mockResolvedValue(UNAVAILABLE);
    const { GET } = await import('@/app/api/ops/pilot-driver/arrivals/route');
    const response = await GET();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('passes a refusal through verbatim, with its reason intact', async () => {
    findUserById.mockResolvedValue({ id: 'driver-1', vehicleId: ASSIGNED_VEHICLE });
    fetchVehicleArrivals.mockResolvedValue(UNAVAILABLE);
    const { GET } = await import('@/app/api/ops/pilot-driver/arrivals/route');
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.prediction.status).toBe('unavailable');
    expect(body.prediction.reason).toBe('off_route');
    expect(body.prediction.arrivals).toEqual([]);
  });
});
