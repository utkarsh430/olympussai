// @vitest-environment node
//
// GET /api/ops/pilot-driver/journey - the one request the driver's route
// screen makes.
//
// Two things it exists to guarantee, and both are tested here rather than
// assumed:
//
//   OWNERSHIP. It takes no parameters. The bus comes from the caller's own
//   ops_users row, exactly as the commands and arrivals routes do, so there is
//   no id for a caller to swap. This also keeps the prediction and the
//   timetable talking about the SAME bus - a client-supplied registration on
//   the timetable half would let the two disagree, which is how a driver ends
//   up reading another bus's schedule beside their own predictions.
//
//   THE TIMETABLE IS NEVER LOAD-BEARING. The prediction is the payload; the
//   timetable is context. A failed or absent timetable degrades to null and
//   the screen still works. A failed PREDICTION, by contrast, is an outage and
//   is reported as one - never as a calm "no arrival times right now".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ArrivalPredictionResponse } from '@/models/control';

const requireOpsRole = vi.fn();
const findUserById = vi.fn();
const fetchVehicleArrivals = vi.fn();
const getOpsVehicleSchedule = vi.fn();

vi.mock('@/lib/auth/rbac/guard', () => ({
  requireOpsRole: (...args: unknown[]) => requireOpsRole(...args),
}));
vi.mock('@/lib/auth/rbac/repo', () => ({
  getOpsRepo: () => ({ findUserById }),
}));
vi.mock('@/lib/controlService/arrivals', () => ({
  fetchVehicleArrivals: (...args: unknown[]) => fetchVehicleArrivals(...args),
}));
vi.mock('@/lib/ops/fleetData', () => ({
  getOpsVehicleSchedule: (...args: unknown[]) => getOpsVehicleSchedule(...args),
}));

const CALLER_CLAIMS = { sub: 'driver-1', email: 'd1@example.com', role: 'pilot_driver' as const };
const ASSIGNED_VEHICLE = 'UP78FN8125';

const AVAILABLE: ArrivalPredictionResponse = {
  vehicleId: ASSIGNED_VEHICLE,
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
      latitude: 26.85,
      longitude: 80.95,
    },
    speed: {
      basis: 'vehicle_smoothed_speed',
      speedKmph: 38.6,
      sampleCount: 1,
      relativeSpread: 0.42,
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
        stopId: '12921',
        stopName: 'ALAMBAGH',
        sequence: 2,
        isControlPoint: true,
        distanceRemainingMeters: 14_000,
        intermediateStopCount: 0,
        latitude: 26.8,
        longitude: 80.9,
        status: 'predicted',
        etaSeconds: 1320,
        etaAt: '2026-08-14T10:22:00.000Z',
        lowerBoundSeconds: 900,
        upperBoundSeconds: 2580,
        confidence: 0.41,
        confidenceBand: 'usable',
        components: { travelSeconds: 1275, dwellSeconds: 45, currentStopDwellSeconds: 0, stateAgeSeconds: 86 },
      },
    ],
  },
};

const REFUSED: ArrivalPredictionResponse = {
  vehicleId: ASSIGNED_VEHICLE,
  generatedAt: '2026-08-14T10:00:00.000Z',
  horizonSeconds: 3600,
  stopLimit: 6,
  prediction: {
    status: 'unavailable',
    reason: 'off_route',
    detail: 'This bus has not been matched to a route, so no arrival time can be measured.',
    routeDirectionId: null,
    observedAt: '2026-08-14T09:59:30.000Z',
    stateAgeSeconds: 30,
    arrivals: [],
  },
};

const SCHEDULE = {
  schedule: {
    registrationNumber: ASSIGNED_VEHICLE,
    date: '2026-08-14',
    routeId: 'r-1',
    routeName: 'LUCKNOW - GORAKHPUR',
    originName: 'LUCKNOW',
    destinationName: 'GORAKHPUR',
    tripId: 't-1',
    scheduledDeparture: '2026-08-14T09:30:00.000Z',
    scheduledArrival: '2026-08-14T15:30:00.000Z',
    direction: 'OUT',
    tripCount: 2,
    stops: [
      {
        id: '12921',
        name: 'ALAMBAGH',
        sequence: 2,
        latitude: 26.8,
        longitude: 80.9,
        scheduledArrival: '2026-08-14T10:18:00.000Z',
        scheduledDeparture: '2026-08-14T10:20:00.000Z',
      },
    ],
  },
  source: 'live' as const,
  stale: false,
  error: null,
};

async function load() {
  return import('@/app/api/ops/pilot-driver/journey/route');
}

describe('GET /api/ops/pilot-driver/journey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireOpsRole.mockResolvedValue({ ok: true, claims: CALLER_CLAIMS });
    findUserById.mockResolvedValue({ id: 'driver-1', vehicleId: ASSIGNED_VEHICLE });
    fetchVehicleArrivals.mockResolvedValue(AVAILABLE);
    getOpsVehicleSchedule.mockResolvedValue(SCHEDULE);
  });

  it('takes no request input at all, so no caller can name another bus', async () => {
    const { GET } = await load();
    expect(GET.length).toBe(0);
  });

  it('asks both halves about the SAME bus - the caller’s own', async () => {
    const { GET } = await load();
    await GET();
    expect(fetchVehicleArrivals).toHaveBeenCalledWith(ASSIGNED_VEHICLE, expect.anything());
    expect(getOpsVehicleSchedule).toHaveBeenCalledWith(ASSIGNED_VEHICLE);
  });

  it('restricts the route to the pilot_driver role', async () => {
    const { GET } = await load();
    await GET();
    expect(requireOpsRole).toHaveBeenCalledWith(['pilot_driver']);
  });

  it('refuses a rejected caller without reading either datasource', async () => {
    requireOpsRole.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const { GET } = await load();
    expect((await GET()).status).toBe(403);
    expect(fetchVehicleArrivals).not.toHaveBeenCalled();
    expect(getOpsVehicleSchedule).not.toHaveBeenCalled();
  });

  it('tells a driver with no assigned bus to contact their admin', async () => {
    findUserById.mockResolvedValue({ id: 'driver-1', vehicleId: null });
    const { GET } = await load();
    const response = await GET();
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('VEHICLE_NOT_ASSIGNED');
    expect(fetchVehicleArrivals).not.toHaveBeenCalled();
  });

  it('joins the published times onto the predicted stops as a separate field', async () => {
    const { GET } = await load();
    const body = await (await GET()).json();
    expect(body.stops).toHaveLength(1);
    expect(body.stops[0].arrival.status).toBe('predicted');
    expect(body.stops[0].arrival.etaSeconds).toBe(1320);
    expect(body.stops[0].scheduled.arrival).toBe('2026-08-14T10:18:00.000Z');
  });

  it('never writes a published time into a prediction field', async () => {
    // The whole point of the join. If this ever fails, a timetable time is
    // being served to a driver as though the model had measured it.
    const { GET } = await load();
    const body = await (await GET()).json();
    const arrival = body.stops[0].arrival;
    expect(arrival.etaAt).toBe('2026-08-14T10:22:00.000Z');
    expect(JSON.stringify(arrival)).not.toContain('2026-08-14T10:18:00.000Z');
  });

  it('reports an unreachable control service as an outage, not as "no arrival times"', async () => {
    const { ControlServiceUnavailableError } = await import('@/lib/controlService/client');
    fetchVehicleArrivals.mockRejectedValue(new ControlServiceUnavailableError('circuit open'));
    const { GET } = await load();
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe('CONTROL_SERVICE_UNAVAILABLE');
    expect(body).not.toHaveProperty('stops');
  });

  it('still serves the prediction when the timetable is unavailable', async () => {
    // The timetable is context, never load-bearing. Losing the upstream must
    // not cost the driver the arrival times that were measured successfully.
    getOpsVehicleSchedule.mockResolvedValue({ schedule: null, source: 'live', stale: false, error: 'upstream down' });
    const { GET } = await load();
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stops[0].arrival.status).toBe('predicted');
    expect(body.stops[0].scheduled).toBeNull();
    expect(body.schedule).toBeNull();
  });

  it('survives a timetable lookup that throws, rather than losing the prediction with it', async () => {
    getOpsVehicleSchedule.mockRejectedValue(new Error('boom'));
    const { GET } = await load();
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).stops[0].arrival.status).toBe('predicted');
  });

  it('returns an empty stop list on a refusal, so a careless consumer renders nothing', async () => {
    // The same structural guarantee the arrival envelope makes: the failure
    // mode of ignoring `status` is a blank space, never a wrong number.
    fetchVehicleArrivals.mockResolvedValue(REFUSED);
    const { GET } = await load();
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.prediction.status).toBe('unavailable');
    expect(body.prediction.reason).toBe('off_route');
    expect(body.stops).toEqual([]);
  });

  it('does not repeat the arrivals inside the prediction envelope, so the two cannot disagree', async () => {
    const { GET } = await load();
    const body = await (await GET()).json();
    expect(body.prediction).not.toHaveProperty('arrivals');
  });

  it('never lets a driver response be cached', async () => {
    const { GET } = await load();
    expect((await GET()).headers.get('Cache-Control')).toBe('no-store');
  });
});
