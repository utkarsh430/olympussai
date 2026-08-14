// @vitest-environment node
//
// The depot ownership boundary FOR THE MAP, exercised through the polling
// route handler itself. Sibling of depotBoundary.test.ts, which proves the
// same property for the schedule and breakdown-report reads.
//
// A map is the surface where this boundary is easiest to lose without anyone
// noticing, because the two broken implementations both look right on screen:
// fetch the statewide feed and filter in the browser, or accept a depot from
// the request. The properties under test are therefore about the RESPONSE
// BODY and the ABSENCE OF A TAMPERABLE PARAMETER, not about what the map
// renders:
//
//   1. A depot caller's response carries only their own depot's vehicles.
//   2. No request input can widen that, including a routeDirectionId that
//      belongs to a corridor full of another depot's buses.
//   3. An unassigned depot operator is refused, not served the state.
//   4. Control-service positions and bunching incidents - the two things the
//      map adds on top of the fleet list - obey the same boundary.
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CanonicalLiveBus } from '@/models/canonical';
import type { BunchingIncident, VehicleState } from '@/models/control';

const requireOpsRole = vi.fn();
const findUserById = vi.fn();
const findDepotById = vi.fn();

/** Every vehicle in the state, before any narrowing. The thing that must not leak. */
const statewideBuses = vi.fn<() => CanonicalLiveBus[]>();
/** What control-service would answer for the requested corridor, unscoped. */
const controlServiceVehicleStates = vi.fn<() => VehicleState[]>();
const controlServiceIncidents = vi.fn<() => BunchingIncident[]>();
const controlServiceFails = vi.fn<() => boolean>(() => false);

vi.mock('@/lib/auth/rbac/guard', () => ({
  requireOpsRole: (...args: unknown[]) => requireOpsRole(...args),
}));

vi.mock('@/lib/auth/rbac/repo', () => ({
  getOpsRepo: () => ({ findUserById, findDepotById }),
}));

// The real getOpsFleetSnapshot minus the network: it returns the statewide
// fleet and applies the scope with the PRODUCTION filter, so these tests
// exercise the actual narrowing rather than a stand-in for it.
vi.mock('@/lib/ops/fleetData', async () => {
  const { filterBusesToScope } = await import('@/lib/ops/depotScope');
  return {
    getOpsFleetSnapshot: async (scope: Parameters<typeof filterBusesToScope>[1]) => ({
      buses: filterBusesToScope(statewideBuses(), scope),
      source: 'live',
      stale: false,
      fetchedAt: '2026-08-12T06:00:00.000Z',
      error: null,
    }),
  };
});

// Control-service answers whatever it is asked for, with no idea what a depot
// is - which is exactly the real situation. If the boundary were only in the
// fleet read, these rows would walk straight past it onto the map.
vi.mock('@/lib/controlService/client', () => ({
  ControlServiceConfigError: class ControlServiceConfigError extends Error {},
  fetchControlService: async (path: string) => {
    if (controlServiceFails()) throw new Error('control-service unreachable');
    if (path === '/v1/vehicle-states') return { vehicleStates: controlServiceVehicleStates() };
    if (path === '/v1/incidents') return { incidents: controlServiceIncidents() };
    throw new Error(`unexpected control-service path ${path}`);
  },
}));

function bus(registrationNumber: string, depotName: string | null): CanonicalLiveBus {
  return {
    id: registrationNumber,
    registrationNumber,
    latitude: 28.35,
    longitude: 79.42,
    speedKmph: 20,
    headingDegrees: 90,
    depotName,
    routeId: 'R1',
    routeName: 'Route 1',
    serviceNumber: 'S1',
    tripId: 'T1',
    vehicleType: null,
    gpsTimestamp: '2026-08-12T06:00:00Z',
    lastUpdatedAt: '2026-08-12T06:00:00Z',
    ignitionOn: true,
    rawStatus: 'RUNNING',
    tripDate: '2026-08-12',
    dataQuality: 'good',
  };
}

function state(vehicleId: string, latitude: number, longitude: number): VehicleState {
  return {
    vehicleId,
    tripId: 'T1',
    routeDirectionId: RD,
    position: { latitude, longitude },
    distanceAlongRouteMeters: 1200,
    speedKmph: 18,
    headingDegrees: 45,
    stopState: 'departed_stop',
    currentStopId: null,
    occupancyCount: null,
    occupancyLoadBand: null,
    confidence: 0.9,
    observedAt: '2026-08-12T06:00:05Z',
  };
}

function incident(id: string, members: string[]): BunchingIncident {
  return {
    id,
    routeDirectionId: RD,
    members: members.map((vehicleId, index) => ({
      vehicleId,
      role: index === 0 ? ('leader' as const) : ('follower' as const),
    })),
    severity: 'bunched',
    causeClass: 'endogenous',
    controllability: 'controllable',
    status: 'open',
    startedAt: '2026-08-12T06:00:00Z',
    endedAt: null,
    evidence: {},
  };
}

const RD = '11111111-2222-4333-8444-555555555555';

const BAREILLY_DEPOT = { id: 'aaaaaaaa-0000-4000-8000-00000000bbbb', code: 'BAREILLY', name: 'Bareilly', upstreamDepotId: '81', createdAt: '' };
const LUCKNOW_DEPOT = { id: 'cccccccc-0000-4000-8000-00000000dddd', code: 'LUCKNOW', name: 'Lucknow', upstreamDepotId: '9', createdAt: '' };

const BAREILLY_BUS = 'UP25FT4823';
const LUCKNOW_BUS = 'UP32AB1234';
const ORPHAN_BUS = 'UP99ZZ0001';

const BAREILLY_OPERATOR = { sub: 'user-bareilly', email: 'b@example.com', role: 'depot' as const };
const LUCKNOW_OPERATOR = { sub: 'user-lucknow', email: 'l@example.com', role: 'depot' as const };
const UNASSIGNED_OPERATOR = { sub: 'user-none', email: 'n@example.com', role: 'depot' as const };
const CONTROL_ROOM = { sub: 'user-cr', email: 'c@example.com', role: 'control_room' as const };

beforeEach(() => {
  vi.clearAllMocks();
  findUserById.mockImplementation(async (id: string) => {
    if (id === BAREILLY_OPERATOR.sub) return { id, depotId: BAREILLY_DEPOT.id, email: BAREILLY_OPERATOR.email };
    if (id === LUCKNOW_OPERATOR.sub) return { id, depotId: LUCKNOW_DEPOT.id, email: LUCKNOW_OPERATOR.email };
    if (id === UNASSIGNED_OPERATOR.sub) return { id, depotId: null, email: UNASSIGNED_OPERATOR.email };
    return null;
  });
  findDepotById.mockImplementation(async (id: string) => {
    if (id === BAREILLY_DEPOT.id) return BAREILLY_DEPOT;
    if (id === LUCKNOW_DEPOT.id) return LUCKNOW_DEPOT;
    return null;
  });
  statewideBuses.mockReturnValue([
    bus(BAREILLY_BUS, 'BAREILLY'),
    bus(LUCKNOW_BUS, 'LUCKNOW'),
    bus(ORPHAN_BUS, null),
  ]);
  controlServiceVehicleStates.mockReturnValue([]);
  controlServiceIncidents.mockReturnValue([]);
  controlServiceFails.mockReturnValue(false);
});

async function mapRequest(query = '') {
  const { GET } = await import('@/app/api/ops/fleet/map/route');
  return GET(new NextRequest(`https://app.test/api/ops/fleet/map${query}`));
}

interface MapBody {
  vehicles: { id: string; latitude: number; longitude: number; positionSource: string; observedAt: string }[];
  incidents: { id: string }[];
  scopeLabel: string;
  controlServiceError: string | null;
}

describe('GET /api/ops/fleet/map - depot ownership', () => {
  it('serves a depot caller only their own depot vehicles', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: BAREILLY_OPERATOR });
    const response = await mapRequest();
    expect(response.status).toBe(200);
    const body = (await response.json()) as MapBody;
    expect(body.vehicles.map((vehicle) => vehicle.id)).toEqual([BAREILLY_BUS]);
    expect(body.scopeLabel).toBe('Bareilly');
  });

  // THE LEAK THIS WHOLE DESIGN EXISTS TO PREVENT. A browser-side filter would
  // pass every UI assertion and fail this one, because the other depot's
  // vehicles would still be in the response body.
  it('never puts another depot vehicle in the response body at all', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: BAREILLY_OPERATOR });
    const response = await mapRequest();
    const raw = await response.text();
    expect(raw).not.toContain(LUCKNOW_BUS);
    expect(raw).not.toContain(ORPHAN_BUS);
  });

  it('is symmetric between depots', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: LUCKNOW_OPERATOR });
    const body = (await (await mapRequest()).json()) as MapBody;
    expect(body.vehicles.map((vehicle) => vehicle.id)).toEqual([LUCKNOW_BUS]);
  });

  it('shows an unattributed vehicle to no depot operator', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: BAREILLY_OPERATOR });
    const first = (await (await mapRequest()).json()) as MapBody;
    requireOpsRole.mockResolvedValue({ ok: true, claims: LUCKNOW_OPERATOR });
    const second = (await (await mapRequest()).json()) as MapBody;
    expect([...first.vehicles, ...second.vehicles].map((vehicle) => vehicle.id)).not.toContain(ORPHAN_BUS);
  });

  it('refuses an unassigned depot operator rather than serving the state', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: UNASSIGNED_OPERATOR });
    const response = await mapRequest();
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('DEPOT_NOT_ASSIGNED');
  });

  it('gives a statewide role the whole fleet, because that is their job', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: CONTROL_ROOM });
    const body = (await (await mapRequest()).json()) as MapBody;
    expect(body.vehicles.map((vehicle) => vehicle.id).sort()).toEqual(
      [BAREILLY_BUS, LUCKNOW_BUS, ORPHAN_BUS].sort(),
    );
    expect(body.scopeLabel).toBe('all depots');
  });

  it('refuses a role with no fleet-map surface', async () => {
    requireOpsRole.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await mapRequest()).status).toBe(403);
    expect(requireOpsRole).toHaveBeenCalledWith(['control_room', 'dispatcher', 'depot', 'planner']);
  });
});

describe('GET /api/ops/fleet/map - control-service enrichment stays inside the boundary', () => {
  beforeEach(() => {
    // The corridor carries buses from both depots, which is the normal case:
    // a route is not owned by a depot.
    controlServiceVehicleStates.mockReturnValue([
      state(BAREILLY_BUS, 28.5, 79.5),
      state(LUCKNOW_BUS, 26.8, 80.9),
      state(ORPHAN_BUS, 27.0, 80.0),
    ]);
  });

  it('applies a control-service position to the caller own vehicle', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: BAREILLY_OPERATOR });
    const body = (await (await mapRequest(`?routeDirectionId=${RD}`)).json()) as MapBody;
    expect(body.vehicles).toHaveLength(1);
    expect(body.vehicles[0]).toMatchObject({
      id: BAREILLY_BUS,
      latitude: 28.5,
      longitude: 79.5,
      positionSource: 'control-service',
      observedAt: '2026-08-12T06:00:05Z',
    });
  });

  // routeDirectionId is the only request input this endpoint takes. If it
  // could widen the scope, it would be the tamperable parameter the design
  // claims not to have.
  it('does not let a corridor id pull in another depot vehicles', async () => {
    requireOpsRole.mockResolvedValue({ ok: true, claims: BAREILLY_OPERATOR });
    const raw = await (await mapRequest(`?routeDirectionId=${RD}`)).text();
    expect(raw).not.toContain(LUCKNOW_BUS);
    expect(raw).not.toContain('26.8');
  });

  it('falls back to the GPS feed position when control-service has no fix', async () => {
    controlServiceVehicleStates.mockReturnValue([{ ...state(BAREILLY_BUS, 0, 0), position: null }]);
    requireOpsRole.mockResolvedValue({ ok: true, claims: BAREILLY_OPERATOR });
    const body = (await (await mapRequest(`?routeDirectionId=${RD}`)).json()) as MapBody;
    expect(body.vehicles[0]).toMatchObject({ latitude: 28.35, longitude: 79.42, positionSource: 'live-feed' });
  });

  it('still draws the fleet when control-service is unreachable, and says so', async () => {
    controlServiceFails.mockReturnValue(true);
    requireOpsRole.mockResolvedValue({ ok: true, claims: BAREILLY_OPERATOR });
    const body = (await (await mapRequest(`?routeDirectionId=${RD}`)).json()) as MapBody;
    expect(body.vehicles).toHaveLength(1);
    expect(body.vehicles[0]?.positionSource).toBe('live-feed');
    expect(body.controlServiceError).toBe('control-service unreachable');
    expect(body.incidents).toEqual([]);
  });
});

describe('GET /api/ops/fleet/map - bunching incidents stay inside the boundary', () => {
  beforeEach(() => {
    controlServiceVehicleStates.mockReturnValue([state(BAREILLY_BUS, 28.5, 79.5), state(LUCKNOW_BUS, 26.8, 80.9)]);
  });

  it('serves an incident involving the caller own vehicle', async () => {
    controlServiceIncidents.mockReturnValue([incident('inc-own', [BAREILLY_BUS, ORPHAN_BUS])]);
    requireOpsRole.mockResolvedValue({ ok: true, claims: BAREILLY_OPERATOR });
    const body = (await (await mapRequest(`?routeDirectionId=${RD}`)).json()) as MapBody;
    expect(body.incidents.map((entry) => entry.id)).toEqual(['inc-own']);
  });

  // An incident between two other depots' buses is not this operator's
  // incident, and shipping it would leak both vehicle ids in the payload.
  it('drops an incident with no member in scope', async () => {
    controlServiceIncidents.mockReturnValue([incident('inc-foreign', [LUCKNOW_BUS, ORPHAN_BUS])]);
    requireOpsRole.mockResolvedValue({ ok: true, claims: BAREILLY_OPERATOR });
    const response = await mapRequest(`?routeDirectionId=${RD}`);
    const raw = await response.text();
    expect(raw).not.toContain('inc-foreign');
    expect(raw).not.toContain(LUCKNOW_BUS);
  });

  it('gives a statewide role every incident on the corridor', async () => {
    controlServiceIncidents.mockReturnValue([
      incident('inc-own', [BAREILLY_BUS]),
      incident('inc-foreign', [LUCKNOW_BUS]),
    ]);
    requireOpsRole.mockResolvedValue({ ok: true, claims: CONTROL_ROOM });
    const body = (await (await mapRequest(`?routeDirectionId=${RD}`)).json()) as MapBody;
    expect(body.incidents.map((entry) => entry.id).sort()).toEqual(['inc-foreign', 'inc-own']);
  });

  it('asks control-service for nothing when no corridor is selected', async () => {
    controlServiceIncidents.mockReturnValue([incident('inc-own', [BAREILLY_BUS])]);
    requireOpsRole.mockResolvedValue({ ok: true, claims: BAREILLY_OPERATOR });
    const body = (await (await mapRequest()).json()) as MapBody;
    expect(body.incidents).toEqual([]);
    expect(body.vehicles[0]?.positionSource).toBe('live-feed');
  });
});
