// @vitest-environment node
//
// The depot console's control-service read, exercised through the real module
// with only `fetchControlService` mocked — so the narrowing under test is the
// production narrowing, not a stand-in for it.
//
// The properties under test are the ones that would be invisible in the UI if
// they broke:
//
//   1. The unfiltered /v1/vehicle-states response — every depot's buses — is
//      consumed inside the module and never reaches the returned snapshot.
//   2. A headway PAIR names a leader and a follower, and on a shared corridor
//      the leader is routinely another depot's bus. A pair is kept only when
//      BOTH ends are this depot's.
//   3. A corridor that cannot detect bunching is not asked for headway, and
//      says so, rather than rendering an empty table.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CanonicalLiveBus } from '@/models/canonical';

const fetchControlService = vi.fn();

vi.mock('@/lib/controlService/client', () => ({
  fetchControlService: (...args: unknown[]) => fetchControlService(...args),
  ControlServiceConfigError: class ControlServiceConfigError extends Error {},
}));

/**
 * Re-imported per test on purpose. The module holds TTL caches at module
 * scope — deliberately, so 143 depot renders share one statewide read — and a
 * suite that shared them would let one test's control service answer the next
 * one's assertions through the last-known-good rung.
 */
async function loadModule() {
  vi.resetModules();
  return (await import('@/lib/controlService/depotConsoleData')).getDepotConsoleSnapshot;
}

const BAREILLY: OpsScope = { kind: 'depot', depotCode: 'BAREILLY', depotName: 'Bareilly' };
type OpsScope = import('@/lib/ops/depotScope').OpsFleetScope;

function bus(id: string): Pick<CanonicalLiveBus, 'id'> {
  return { id };
}

function state(vehicleId: string, routeDirectionId: string | null, distance: number | null = 0) {
  return {
    vehicleId,
    tripId: null,
    routeDirectionId,
    position: null,
    distanceAlongRouteMeters: distance,
    speedKmph: null,
    headingDegrees: null,
    stopState: 'departed_stop',
    currentStopId: null,
    occupancyCount: null,
    occupancyLoadBand: null,
    confidence: null,
    observedAt: '2026-08-14T00:00:00.000Z',
  };
}

function routeDirection(routeDirectionId: string, hasActivePolicy?: boolean) {
  return {
    routeDirectionId,
    routeId: routeDirectionId.toUpperCase(),
    directionCode: 'OUT',
    isLoop: false,
    totalDistanceMeters: 10_000,
    ...(hasActivePolicy === undefined ? {} : { hasActivePolicy }),
  };
}

function pair(id: string, leaderVehicleId: string, followerVehicleId: string) {
  return {
    id,
    routeDirectionId: 'rd-shared',
    leaderVehicleId,
    followerVehicleId,
    gapMeters: 400,
    hFwdSeconds: 200,
    hBwdSeconds: null,
    targetHeadwaySeconds: 600,
    deviationSeconds: -400,
    confidence: 0.9,
  };
}

function headwayResult(pairs: ReturnType<typeof pair>[]) {
  return {
    routeDirectionId: 'rd-shared',
    computedAt: '2026-08-14T00:00:00.000Z',
    pairs,
    aggregate: {
      routeDirectionId: 'rd-shared',
      sampleCount: pairs.length,
      meanHeadwaySeconds: 200,
      stddevHeadwaySeconds: 10,
      cv: 0.05,
      ewtSeconds: 30,
      targetHeadwaySeconds: 600,
    },
    incidents: [],
  };
}

/**
 * Routes each mocked call by URL, so a test states what the control service
 * answers rather than what order this module happens to ask in.
 */
function respond(handlers: { routeDirections?: unknown; vehicleStates?: unknown; headway?: unknown | Error }) {
  fetchControlService.mockImplementation(async (path: string) => {
    if (path === '/v1/route-directions') return { routeDirections: handlers.routeDirections ?? [] };
    if (path === '/v1/vehicle-states') return { vehicleStates: handlers.vehicleStates ?? [] };
    if (path.includes('/headway')) {
      if (handlers.headway instanceof Error) throw handlers.headway;
      return handlers.headway ?? headwayResult([]);
    }
    throw new Error(`unexpected control-service path: ${path}`);
  });
}

const clock = Date.UTC(2026, 7, 14);

let getDepotConsoleSnapshot: Awaited<ReturnType<typeof loadModule>>;

beforeEach(async () => {
  fetchControlService.mockReset();
  getDepotConsoleSnapshot = await loadModule();
});

describe('getDepotConsoleSnapshot — the boundary', () => {
  it('never returns a vehicle state belonging to another depot, though it reads them all', async () => {
    respond({
      routeDirections: [routeDirection('rd-shared', true)],
      vehicleStates: [
        state('BAREILLY-1', 'rd-shared', 900),
        state('LUCKNOW-1', 'rd-shared', 800),
        state('LUCKNOW-2', 'rd-shared', 700),
      ],
    });

    const snapshot = await getDepotConsoleSnapshot({
      scope: BAREILLY,
      scopedFleet: [bus('BAREILLY-1')],
      now: clock,
    });

    // It really did read the whole statewide list...
    expect(fetchControlService).toHaveBeenCalledWith('/v1/vehicle-states');
    // ...and none of it survived into anything serialised.
    const serialised = JSON.stringify(snapshot);
    expect(serialised).not.toContain('LUCKNOW-1');
    expect(serialised).not.toContain('LUCKNOW-2');
    expect(snapshot.vehicles.map((v) => v.vehicleId)).toEqual(['BAREILLY-1']);
  });

  it('counts only this depot’s vehicles per corridor, not the corridor’s whole population', async () => {
    respond({
      routeDirections: [routeDirection('rd-shared', true)],
      vehicleStates: [
        state('BAREILLY-1', 'rd-shared'),
        state('LUCKNOW-1', 'rd-shared'),
        state('LUCKNOW-2', 'rd-shared'),
        state('LUCKNOW-3', 'rd-shared'),
      ],
    });

    const snapshot = await getDepotConsoleSnapshot({
      scope: BAREILLY,
      scopedFleet: [bus('BAREILLY-1')],
      now: clock,
    });

    expect(snapshot.corridors).toHaveLength(1);
    expect(snapshot.corridors[0]!.depotVehicleCount).toBe(1);
  });

  it('drops a headway pair whose leader is another depot’s bus, and reports it as a count instead', async () => {
    // The leak this closes: the existing route-operations board renders a
    // countdown for any follower it can see and puts the LEADER's id in the
    // row's title. On a shared corridor that leader is routinely another
    // depot's registration.
    respond({
      routeDirections: [routeDirection('rd-shared', true)],
      vehicleStates: [state('BAREILLY-1', 'rd-shared'), state('BAREILLY-2', 'rd-shared')],
      headway: headwayResult([
        pair('pair-ours', 'BAREILLY-1', 'BAREILLY-2'),
        pair('pair-mixed', 'LUCKNOW-9', 'BAREILLY-1'),
      ]),
    });

    const snapshot = await getDepotConsoleSnapshot({
      scope: BAREILLY,
      scopedFleet: [bus('BAREILLY-1'), bus('BAREILLY-2')],
      now: clock,
    });

    expect(snapshot.headwayPairs.map((p) => p.id)).toEqual(['pair-ours']);
    expect(snapshot.crossDepotPairCount).toBe(1);
    expect(JSON.stringify(snapshot)).not.toContain('LUCKNOW-9');
  });

  it('applies no narrowing at all for a statewide scope', async () => {
    respond({
      routeDirections: [routeDirection('rd-shared', true)],
      vehicleStates: [state('BAREILLY-1', 'rd-shared'), state('LUCKNOW-1', 'rd-shared')],
      headway: headwayResult([pair('p', 'LUCKNOW-1', 'BAREILLY-1')]),
    });

    const snapshot = await getDepotConsoleSnapshot({
      scope: { kind: 'all' },
      scopedFleet: [bus('BAREILLY-1'), bus('LUCKNOW-1')],
      now: clock,
    });

    expect(snapshot.vehicles).toHaveLength(2);
    expect(snapshot.headwayPairs).toHaveLength(1);
    expect(snapshot.crossDepotPairCount).toBe(0);
  });
});

describe('getDepotConsoleSnapshot — honesty about detection', () => {
  it('does not ask an observation-only corridor for headway, and says the reading was not taken', async () => {
    respond({
      routeDirections: [routeDirection('rd-quiet', false)],
      vehicleStates: [state('BAREILLY-1', 'rd-quiet')],
    });

    const snapshot = await getDepotConsoleSnapshot({
      scope: BAREILLY,
      scopedFleet: [bus('BAREILLY-1')],
      now: clock,
    });

    expect(fetchControlService).not.toHaveBeenCalledWith(expect.stringContaining('/headway'));
    expect(snapshot.headwayRead).toBe(false);
    expect(snapshot.headwayPairs).toEqual([]);
    expect(snapshot.coverage).toMatchObject({ running: 1, detecting: 0, observationOnly: 1 });
  });

  it('DOES ask when the service does not report a policy state, because unknown is not no', async () => {
    respond({
      routeDirections: [routeDirection('rd-silent')],
      vehicleStates: [state('BAREILLY-1', 'rd-silent')],
      headway: headwayResult([]),
    });

    const snapshot = await getDepotConsoleSnapshot({
      scope: BAREILLY,
      scopedFleet: [bus('BAREILLY-1')],
      now: clock,
    });

    expect(fetchControlService).toHaveBeenCalledWith(expect.stringContaining('/headway'));
    expect(snapshot.headwayRead).toBe(true);
    expect(snapshot.coverage.unknown).toBe(1);
  });

  it('distinguishes a failed headway read from a corridor that cannot report', async () => {
    respond({
      routeDirections: [routeDirection('rd-live', true)],
      vehicleStates: [state('BAREILLY-1', 'rd-live')],
      headway: new Error('control service timed out'),
    });

    const snapshot = await getDepotConsoleSnapshot({
      scope: BAREILLY,
      scopedFleet: [bus('BAREILLY-1')],
      now: clock,
    });

    expect(snapshot.headwayRead).toBe(false);
    expect(snapshot.error).toContain('timed out');
    // The corridor itself still reports that it CAN detect — the failure was
    // ours, not the corridor's.
    expect(snapshot.selectedCorridor?.hasActivePolicy).toBe(true);
  });
});

describe('getDepotConsoleSnapshot — corridor selection and ordering', () => {
  it('opens on the depot’s busiest corridor rather than the network’s first', async () => {
    respond({
      routeDirections: [
        routeDirection('rd-someone-elses', true),
        routeDirection('rd-quiet-ours', true),
        routeDirection('rd-busy-ours', true),
      ],
      vehicleStates: [
        state('OTHER-1', 'rd-someone-elses'),
        state('BAREILLY-1', 'rd-quiet-ours'),
        state('BAREILLY-2', 'rd-busy-ours'),
        state('BAREILLY-3', 'rd-busy-ours'),
      ],
      headway: headwayResult([]),
    });

    const snapshot = await getDepotConsoleSnapshot({
      scope: BAREILLY,
      scopedFleet: [bus('BAREILLY-1'), bus('BAREILLY-2'), bus('BAREILLY-3')],
      now: clock,
    });

    expect(snapshot.selectedCorridor?.routeDirectionId).toBe('rd-busy-ours');
    expect(snapshot.corridors.map((c) => c.routeDirectionId)).toEqual(['rd-busy-ours', 'rd-quiet-ours']);
    expect(snapshot.mappedCorridorCount).toBe(3);
  });

  it('orders the running board furthest along the route first', async () => {
    respond({
      routeDirections: [routeDirection('rd', true)],
      vehicleStates: [
        state('BAREILLY-BACK', 'rd', 100),
        state('BAREILLY-FRONT', 'rd', 9_000),
        state('BAREILLY-MID', 'rd', 4_000),
      ],
      headway: headwayResult([]),
    });

    const snapshot = await getDepotConsoleSnapshot({
      scope: BAREILLY,
      scopedFleet: [bus('BAREILLY-BACK'), bus('BAREILLY-FRONT'), bus('BAREILLY-MID')],
      now: clock,
    });

    expect(snapshot.vehicles.map((v) => v.vehicleId)).toEqual([
      'BAREILLY-FRONT',
      'BAREILLY-MID',
      'BAREILLY-BACK',
    ]);
  });

  it('reports a depot on no mapped corridor as exactly that, not as an outage', async () => {
    respond({
      routeDirections: [routeDirection('rd-someone-elses', true)],
      vehicleStates: [state('OTHER-1', 'rd-someone-elses'), state('BAREILLY-1', null)],
    });

    const snapshot = await getDepotConsoleSnapshot({
      scope: BAREILLY,
      scopedFleet: [bus('BAREILLY-1')],
      now: clock,
    });

    expect(snapshot.source).toBe('live');
    expect(snapshot.error).toBeNull();
    expect(snapshot.corridors).toEqual([]);
    expect(snapshot.selectedCorridor).toBeNull();
    expect(snapshot.mappedCorridorCount).toBe(1);
  });
});

describe('getDepotConsoleSnapshot — degradation ladder', () => {
  it('is explicitly unavailable, with no invented readings, when the service cannot be read at all', async () => {
    fetchControlService.mockRejectedValue(new Error('ECONNREFUSED'));

    const snapshot = await getDepotConsoleSnapshot({
      scope: BAREILLY,
      scopedFleet: [bus('BAREILLY-1')],
      now: clock,
    });

    expect(snapshot.source).toBe('unavailable');
    expect(snapshot.stale).toBe(true);
    expect(snapshot.error).toContain('ECONNREFUSED');
    expect(snapshot.corridors).toEqual([]);
    expect(snapshot.selectedCorridor).toBeNull();
    expect(snapshot.coverage).toEqual({ running: 0, detecting: 0, observationOnly: 0, unknown: 0 });
  });

  it('serves the last known good corridor list, labelled stale, rather than an empty depot', async () => {
    respond({
      routeDirections: [routeDirection('rd', true)],
      vehicleStates: [state('BAREILLY-1', 'rd')],
      headway: headwayResult([]),
    });
    const good = await getDepotConsoleSnapshot({
      scope: BAREILLY,
      scopedFleet: [bus('BAREILLY-1')],
      now: clock,
    });
    expect(good.stale).toBe(false);

    // Past both TTLs, with the service now refusing.
    fetchControlService.mockRejectedValue(new Error('control service down'));
    const degraded = await getDepotConsoleSnapshot({
      scope: BAREILLY,
      scopedFleet: [bus('BAREILLY-1')],
      now: clock + 5 * 60 * 1000,
    });

    expect(degraded.source).toBe('unavailable');
    expect(degraded.stale).toBe(true);
    expect(degraded.error).toContain('control service down');
    // Real data that was really observed, only older than it looks.
    expect(degraded.corridors.map((c) => c.routeDirectionId)).toEqual(['rd']);
  });
});
