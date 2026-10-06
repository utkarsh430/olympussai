// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalSchedule, ScheduleResponse } from '@/models/canonical';
import type { DepotBusRow } from '@/models/depotLive';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';

vi.mock('@/lib/upsrtc/scheduleService', () => ({ fetchBusSchedule: vi.fn() }));

import { fetchBusSchedule } from '@/lib/upsrtc/scheduleService';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { getRouteProfile, resetRouteCatalogueForTests } from '@/lib/depot/routes/routeCatalogue';
import { buildRoutesResponse, parseRoutesQuery } from '@/lib/depot/live/routesView';
import { allocationInputFor, buildAllocationResponse } from '@/lib/depot/live/allocationView';
import { planAllocation } from '@/lib/depot/optimise/allocate';
import { modelDepotMaster } from '@/lib/depot/sim/depotMaster';

const FEED_NOW = '2026-10-06T10:00:00.000Z';
const NEAR_B = 'RKD_4560_ORD_OUT';
const UNPROFILED = 'RKD_7777_ORD_IN';
const TIED = 'RKD_8888_EXP_OUT';
const ALPHA = { id: '101', name: 'Alpha', lat: 26.8 };
const BETA = { id: '102', name: 'Beta', lat: 27.8 };

function row(reg: string, depot: typeof ALPHA, over: Partial<DepotBusRow> = {}): DepotBusRow {
  return {
    registrationNumber: reg, latitude: depot.lat, longitude: 80.9, speedKmph: 0, ignitionOn: false,
    gpsTimestamp: '2026-10-06T09:59:00.000Z', receivedAt: FEED_NOW, depotId: depot.id,
    depotName: depot.name, vehicleStatus: 'stationary', tripStatus: 'Stationary', routeId: null,
    routeName: null, routeDescription: null, journeyId: null, journeyCode: null,
    scheduledStart: null, scheduledEnd: null, actualStart: null, delayMinutes: null,
    odometerRaw: null, mainPowerOn: true, mainVoltage: 24, tamperCode: null, emergency: false,
    ...over,
  };
}

const onRoute = (routeName: string, lat: number): Partial<DepotBusRow> => ({
  routeName, latitude: lat, speedKmph: 40, ignitionOn: true, vehicleStatus: 'live',
  tripStatus: 'Live', routeId: '4562', journeyId: '30396',
  scheduledStart: '2026-10-06T08:00:00.000Z',
});

const ROWS: readonly DepotBusRow[] = [
  ...Array.from({ length: 6 }, (_, i) => row(`UP32A${i}`, ALPHA)),
  ...Array.from({ length: 6 }, (_, i) => row(`UP25B${i}`, BETA)),
  row('UP32R1', ALPHA, onRoute(NEAR_B, 27.81)),
  row('UP32R2', ALPHA, onRoute(NEAR_B, 27.82)),
  row('UP32U1', ALPHA, onRoute(UNPROFILED, 26.9)),
  row('UP32T1', ALPHA, onRoute(TIED, 27.2)),
  row('UP25T1', BETA, onRoute(TIED, 27.3)),
];

function view(over: Partial<FleetSnapshotView> = {}): FleetSnapshotView {
  return { rows: ROWS, feedNow: FEED_NOW, fetchedAt: FEED_NOW, source: 'live', stale: false,
    recordCount: ROWS.length, ...over };
}

function schedule(routeName: string): CanonicalSchedule {
  const stop = (sequence: number, lat: number, time: string) => ({
    id: `s${sequence}`, name: `Stop ${sequence}`, sequence, latitude: lat, longitude: 80.9,
    scheduledArrival: time, scheduledDeparture: time,
  });
  return {
    registrationNumber: 'UP32R1', date: '2026-10-06', routeId: '4562', routeName,
    originName: null, destinationName: null, tripId: '30396', scheduledDeparture: null,
    scheduledArrival: null, direction: 'OUT', tripCount: 1,
    stops: [stop(1, 27.81, '08:00:00'), stop(2, 27.85, '09:30:00')],
  };
}

const live = (value: CanonicalSchedule): ScheduleResponse => ({
  schedule: value, fetchedAt: FEED_NOW, source: 'live', stale: false,
});

const mockService = vi.mocked(fetchBusSchedule);
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  resetAnalysisForTests();
  resetRouteCatalogueForTests();
  mockService.mockReset();
  mockService.mockResolvedValue(live(schedule(NEAR_B)));
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await getRouteProfile(NEAR_B, view());
  mockService.mockClear();
});

afterEach(() => errorSpy.mockRestore());

const ALL = { depotId: null } as const;

describe('routes view', () => {
  it('memoises the body on the rows while the envelope is this request\'s own', () => {
    const stale = buildRoutesResponse(view({ stale: true, source: 'cache' }), ALL);
    const fresh = buildRoutesResponse(view(), ALL);
    expect(stale.stale).toBe(true);
    expect(stale.source).toBe('cache');
    expect(fresh.stale).toBe(false);
    expect(fresh.source).toBe('live');
    expect(fresh.routes).toBe(stale.routes);
  });

  it('rebuilds the body once another profile is cached', async () => {
    const before = buildRoutesResponse(view(), ALL);
    mockService.mockResolvedValue(live(schedule(UNPROFILED)));
    await getRouteProfile(UNPROFILED, view());
    const after = buildRoutesResponse(view(), ALL);
    expect(after.routes).not.toBe(before.routes);
    expect(after.coverage.profiled).toEqual({ n: 2, of: 3 });
  });

  it('never fetches a profile and reports profiled coverage', () => {
    const response = buildRoutesResponse(view(), ALL);
    expect(mockService).not.toHaveBeenCalled();
    expect(response.routes.map((r) => r.routeName).sort()).toEqual([NEAR_B, TIED, UNPROFILED].sort());
    expect(response.coverage.profiled).toEqual({ n: 1, of: 3 });
    expect(response.coverage.tripsOnDuration).toEqual({ n: 1, of: 3 });
    const near = response.routes.find((r) => r.routeName === NEAR_B)!;
    expect(near.profiled).toBe(true);
    expect(near.scheduledDurationMin).toBe(90);
    expect(near.tripsPerDay.provenance).toBe('modelled');
    expect(near.tripsBasis).toBe('buses_and_duration');
    expect(Number.isInteger(near.tripsPerDay.value)).toBe(true);
    expect(near.deadKm?.depotId).toBe(ALPHA.id);
    expect(near.deadKm?.provenance).toBe('derived');
    const unprofiled = response.routes.find((r) => r.routeName === UNPROFILED)!;
    expect(unprofiled.profiled).toBe(false);
    expect(unprofiled.deadKm).toBeNull();
    expect(unprofiled.tripsBasis).toBe('buses_only');
    expect(response.profileEndpoint).toBe('/api/upsrtc/depot/route/{routeName}');
  });

  it('filters to the routes a depot operates and recounts coverage for them', () => {
    const beta = buildRoutesResponse(view(), { depotId: BETA.id });
    expect(beta.depotId).toBe(BETA.id);
    expect(beta.routes.map((r) => r.routeName)).toEqual([TIED]);
    expect(beta.coverage.profiled).toEqual({ n: 0, of: 1 });
  });

  it('validates its query', () => {
    const parse = (q: string): boolean => parseRoutesQuery(new URLSearchParams(q)).ok;
    expect(parse('')).toBe(true);
    expect(parse('depotId=101')).toBe(true);
    expect(parse('depotId=abc')).toBe(false);
    expect(parse('depotId=101&depotId=102')).toBe(false);
    expect(parse('other=1')).toBe(false);
  });
});

describe('allocation view', () => {
  it('memoises the body on the rows while the envelope is this request\'s own', () => {
    const stale = buildAllocationResponse(view({ stale: true, source: 'cache' }), ALL);
    const fresh = buildAllocationResponse(view(), ALL);
    expect([stale.stale, fresh.stale]).toEqual([true, false]);
    expect(fresh.moves).toBe(stale.moves);
    expect(fresh.excluded).toBe(stale.excluded);
    expect(mockService).not.toHaveBeenCalled();
  });

  it('plans only profiled routes and lists every other route with its reason', () => {
    const response = buildAllocationResponse(view(), ALL);
    expect(response.recommendationOnly).toBe(true);
    expect(response.coverage.profiled).toEqual({ n: 1, of: 3 });
    expect(response.coverage.planned).toEqual({ n: 1, of: 3 });
    const reasons = Object.fromEntries(response.excluded.map((e) => [e.routeName, e.reason]));
    expect(reasons).toEqual({ [UNPROFILED]: 'not_profiled', [TIED]: 'no_primary_depot' });
    const planned = [...response.moves.map((m) => m.routeName), ...response.unchanged.map((u) => u.routeName)];
    expect(planned).toEqual([NEAR_B]);
  });

  it('reports totals that reconcile with the allocator and are tagged modelled', () => {
    const analysis = analyseSnapshot(view());
    const input = allocationInputFor(view(), analysis);
    const plan = planAllocation(input.routes, input.depots);
    const response = buildAllocationResponse(view(), ALL);
    expect(response.beforeKmPerDay.value).toBe(plan.beforeKmPerDay);
    expect(response.afterKmPerDay.value).toBe(plan.afterKmPerDay);
    expect(response.savedKmPerDay.value).toBe(plan.savedKmPerDay);
    expect(response.savedKmPerDay.provenance).toBe('modelled');
    expect(response.savedKmPerDay.coverage).toEqual({ n: 1, of: 3 });
    const sum = response.moves.reduce((total, m) => total + m.savedKmPerDay, 0);
    expect(sum).toBeCloseTo(plan.savedKmPerDay, 6);
    expect(response.beforeKmPerDay.value).toBeGreaterThan(0);
  });

  it('gives every depot room equal to its modelled parking minus buses kept off the plan', () => {
    const analysis = analyseSnapshot(view());
    const input = allocationInputFor(view(), analysis);
    for (const id of [ALPHA.id, BETA.id]) {
      const summary = analysis.depotsById.get(id)!;
      const planLoad = input.routes
        .filter((r) => r.currentDepotId === id)
        .reduce((total, r) => total + r.busesNeeded, 0);
      const parking = modelDepotMaster(summary).parkingCapacity;
      const capacity = input.depots.find((d) => d.depotId === id)?.capacity;
      expect(capacity).toBe(parking - Math.max(0, summary.fleet - planLoad));
    }
  });

  it('counts how each depot position was found', () => {
    const response = buildAllocationResponse(view(), ALL);
    const { yard, median, none } = response.depotPositions;
    expect(yard + median + none).toBe(2);
    expect(none).toBe(0);
    expect(response.depotPositions.provenance).toBe('derived');
  });

  it('keeps network totals under a depot filter and lists only that depot\'s routes', () => {
    const all = buildAllocationResponse(view(), ALL);
    const beta = buildAllocationResponse(view(), { depotId: BETA.id });
    expect(beta.savedKmPerDay).toEqual(all.savedKmPerDay);
    expect(beta.depotId).toBe(BETA.id);
    // The tied route is run partly by Beta; the profiled route is Alpha's alone.
    expect(beta.excluded.map((e) => e.routeName)).toEqual([TIED]);
    expect(beta.unchanged.map((u) => u.routeName)).toEqual([]);
    expect(beta.moves.every((m) => m.toDepotId === BETA.id)).toBe(true);
  });
});
