// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AllocationQuery, RoutesQuery } from '@/lib/depot/routes/routeQuery';
import type { CanonicalSchedule, ScheduleResponse } from '@/models/canonical';
import type { DepotBusRow } from '@/models/depotLive';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';

vi.mock('@/lib/upsrtc/scheduleService', () => ({ fetchBusSchedule: vi.fn() }));

import { fetchBusSchedule } from '@/lib/upsrtc/scheduleService';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { getRouteProfile, resetRouteCatalogueForTests } from '@/lib/depot/routes/routeCatalogue';
import { DEFAULT_ALLOCATION_QUERY, DEFAULT_ROUTES_QUERY } from '@/lib/depot/routes/routeQuery';
import { TRIP_DEFINITION } from '@/lib/depot/sim/tripFrequencyConfig';
import { buildRoutesResponse, parseRoutesQuery } from '@/lib/depot/live/routesView';
import {
  PROFILES_PENDING_NOTE,
  REPLAN_MIN_INTERVAL_MS,
  allocationInputFor,
  buildAllocationResponse,
} from '@/lib/depot/live/allocationView';
import { planAllocation } from '@/lib/depot/optimise/allocate';

const FEED_NOW = '2026-10-06T10:00:00.000Z';
const NEAR_B = 'RKD_4560_ORD_OUT';
const UNPROFILED = 'RKD_7777_ORD_IN';
const TIED = 'RKD_8888_EXP_OUT';
const ALPHA = { id: '101', name: 'Alpha', lat: 26.8 };
const BETA = { id: '102', name: 'Beta', lat: 27.8 };

function row(reg: string, depot: typeof ALPHA, over: Partial<DepotBusRow> = {}): DepotBusRow {
  return {
    registrationNumber: reg,
    latitude: depot.lat,
    longitude: 80.9,
    speedKmph: 0,
    ignitionOn: false,
    gpsTimestamp: '2026-10-06T09:59:00.000Z',
    receivedAt: FEED_NOW,
    depotId: depot.id,
    depotName: depot.name,
    vehicleStatus: 'stationary',
    tripStatus: 'Stationary',
    routeId: null,
    routeName: null,
    routeDescription: null,
    journeyId: null,
    journeyCode: null,
    scheduledStart: null,
    scheduledEnd: null,
    actualStart: null,
    delayMinutes: null,
    odometerRaw: null,
    mainPowerOn: true,
    mainVoltage: 24,
    tamperCode: null,
    emergency: false,
    ...over,
  };
}

const onRoute = (routeName: string, lat: number): Partial<DepotBusRow> => ({
  routeName,
  latitude: lat,
  speedKmph: 40,
  ignitionOn: true,
  vehicleStatus: 'live',
  tripStatus: 'Live',
  routeId: '4562',
  journeyId: '30396',
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
  return {
    rows: ROWS,
    feedNow: FEED_NOW,
    fetchedAt: FEED_NOW,
    source: 'live',
    stale: false,
    recordCount: ROWS.length,
    ...over,
  };
}

function schedule(routeName: string): CanonicalSchedule {
  const stop = (sequence: number, lat: number, time: string) => ({
    id: `s${sequence}`,
    name: `Stop ${sequence}`,
    sequence,
    latitude: lat,
    longitude: 80.9,
    scheduledArrival: time,
    scheduledDeparture: time,
  });
  return {
    registrationNumber: 'UP32R1',
    date: '2026-10-06',
    routeId: '4562',
    routeName,
    originName: null,
    destinationName: null,
    tripId: '30396',
    scheduledDeparture: null,
    scheduledArrival: null,
    direction: 'OUT',
    tripCount: 1,
    stops: [stop(1, 27.81, '08:00:00'), stop(2, 27.85, '09:30:00')],
  };
}

const live = (value: CanonicalSchedule): ScheduleResponse => ({
  schedule: value,
  fetchedAt: FEED_NOW,
  source: 'live',
  stale: false,
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

const RQ = (over: Partial<RoutesQuery> = {}): RoutesQuery => ({ ...DEFAULT_ROUTES_QUERY, ...over });
const AQ = (over: Partial<AllocationQuery> = {}): AllocationQuery => ({
  ...DEFAULT_ALLOCATION_QUERY,
  ...over,
});

describe('routes view', () => {
  it("memoises the body on the rows while the envelope is this request's own", () => {
    const stale = buildRoutesResponse(view({ stale: true, source: 'cache' }), RQ());
    const fresh = buildRoutesResponse(view(), RQ());
    expect(stale.stale).toBe(true);
    expect(stale.source).toBe('cache');
    expect(fresh.stale).toBe(false);
    expect(fresh.source).toBe('live');
    expect(fresh.routes).toBe(stale.routes);
  });

  it('rebuilds the body once another profile is cached', async () => {
    const before = buildRoutesResponse(view(), RQ());
    mockService.mockResolvedValue(live(schedule(UNPROFILED)));
    await getRouteProfile(UNPROFILED, view());
    const after = buildRoutesResponse(view(), RQ());
    expect(after.routes).not.toBe(before.routes);
    expect(after.coverage.profiled).toEqual({ n: 2, of: 3 });
  });

  it('never fetches a profile and reports profiled coverage', () => {
    const response = buildRoutesResponse(view(), RQ());
    expect(mockService).not.toHaveBeenCalled();
    expect(response.routes.map((r) => r.routeName).sort()).toEqual(
      [NEAR_B, TIED, UNPROFILED].sort(),
    );
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
    const beta = buildRoutesResponse(view(), RQ({ depotId: BETA.id }));
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

  it('carries the trip definition', () => {
    expect(buildRoutesResponse(view(), RQ()).tripDefinition).toBe(TRIP_DEFINITION);
  });

  it('filters, sorts and pages on the server with true totals', () => {
    const first = buildRoutesResponse(view(), RQ({ limit: 2 }));
    const rest = buildRoutesResponse(view(), RQ({ offset: 2, limit: 2 }));
    expect([first.total, first.inFeed, first.routes.length, rest.routes.length]).toEqual([3, 3, 2, 1]);
    expect(new Set([...first.routes, ...rest.routes].map((r) => r.routeName)).size).toBe(3);
    const matched = buildRoutesResponse(view(), RQ({ q: 'rkd_7777' }));
    expect(matched.routes.map((r) => r.routeName)).toEqual([UNPROFILED]);
    expect([matched.total, matched.inFeed]).toEqual([1, 3]);
    const sorted = buildRoutesResponse(view(), RQ({ sort: { key: 'route', direction: 'desc' } }));
    expect(sorted.routes.map((r) => r.routeName)).toEqual([TIED, UNPROFILED, NEAR_B]);
    const classes = buildRoutesResponse(view(), RQ({ serviceClass: 'EXP' }));
    expect(classes.routes.map((r) => r.routeName)).toEqual([TIED]);
    expect(classes.classOptions.map((o) => o.value)).toEqual(['EXP', 'ORD']);
    expect(classes.depotOptions.map((o) => o.label)).toEqual(['Alpha', 'Beta']);
  });
});

describe('the catalogue without a clock in the rows', () => {
  const clockless = (): FleetSnapshotView =>
    view({ feedNow: null, rows: ROWS.map((r) => ({ ...r, scheduledStart: null })) });

  afterEach(() => vi.useRealTimers());

  it('gives the same body and lookup date on the same rows whatever the wall clock says', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T20:00:00.000Z'));
    resetRouteCatalogueForTests();
    const result = await getRouteProfile(NEAR_B, clockless());
    expect(result.status === 'ok' && result.profile.operatingDate).toBe('2026-10-06');
    vi.setSystemTime(new Date('2026-10-07T20:00:00.000Z'));
    const first = buildRoutesResponse(clockless(), RQ());
    resetAnalysisForTests();
    vi.setSystemTime(new Date('2026-10-08T20:00:00.000Z'));
    const second = buildRoutesResponse(clockless(), RQ());
    expect(second.routes).toEqual(first.routes);
    expect(second.operatingDate).toBe('2026-10-06');
    expect(first.routes.find((r) => r.routeName === NEAR_B)?.profiled).toBe(true);
  });

  it('freezes a profile when it is cached', async () => {
    const result = await getRouteProfile(NEAR_B, view());
    if (result.status !== 'ok') throw new Error('expected a cached profile');
    expect(Object.isFrozen(result.profile)).toBe(true);
    expect(Object.isFrozen(result.profile.stops)).toBe(true);
    expect(Object.isFrozen(result.profile.stops[0])).toBe(true);
  });
});

describe('allocation re-planning', () => {
  it('holds the plan for the same rows until the interval has passed, saying profiles are pending', async () => {
    let now = 1_000;
    const clock = (): number => now;
    const first = buildAllocationResponse(view(), AQ(), clock);
    expect([first.profilesPending, first.profilesPendingNote]).toEqual([false, null]);
    mockService.mockResolvedValue(live(schedule(UNPROFILED)));
    await getRouteProfile(UNPROFILED, view());
    now += REPLAN_MIN_INTERVAL_MS - 1;
    const held = buildAllocationResponse(view(), AQ(), clock);
    expect(held.coverage).toEqual(first.coverage);
    expect([held.profilesPending, held.profilesPendingNote]).toEqual([true, PROFILES_PENDING_NOTE]);
    expect(PROFILES_PENDING_NOTE).toBe(
      'New route profiles will be included in the next plan, within half a minute.',
    );
    now += 1;
    const rebuilt = buildAllocationResponse(view(), AQ(), clock);
    expect(rebuilt.profilesPending).toBe(false);
    expect(rebuilt.coverage.profiled).toEqual({ n: 2, of: 3 });
  });
});

describe('allocation paging', () => {
  it('pages the unmoved and excluded lists with totals and counts by reason; moves in full', () => {
    const one = buildAllocationResponse(view(), AQ({ limit: 1 }));
    expect([one.excluded.length, one.excludedTotal]).toEqual([1, 2]);
    expect(one.excludedByReason).toMatchObject({ not_profiled: 1, no_primary_depot: 1 });
    const none = buildAllocationResponse(view(), AQ({ limit: 0 }));
    expect([none.moves.length, none.excluded.length, none.excludedTotal]).toEqual([1, 0, 2]);
    const tied = buildAllocationResponse(view(), AQ({ reason: 'no_primary_depot' }));
    expect(tied.excluded.map((e) => e.routeName)).toEqual([TIED]);
    expect([tied.excludedTotal, tied.unchangedTotal]).toEqual([1, 0]);
    expect(tied.excludedByReason.not_profiled).toBe(1);
    const named = buildAllocationResponse(view(), AQ({ q: '7777' }));
    expect(named.excluded.map((e) => [e.routeName, e.depotName])).toEqual([[UNPROFILED, 'Alpha']]);
  });

  it('carries the trip definition', () => {
    expect(buildAllocationResponse(view(), AQ()).tripDefinition).toBe(TRIP_DEFINITION);
  });
});

describe('allocation view', () => {
  it("memoises the body on the rows while the envelope is this request's own", () => {
    const stale = buildAllocationResponse(view({ stale: true, source: 'cache' }), AQ());
    const fresh = buildAllocationResponse(view(), AQ());
    expect([stale.stale, fresh.stale]).toEqual([true, false]);
    expect(fresh.moves).toBe(stale.moves);
    expect(fresh.excluded).toBe(stale.excluded);
    expect(mockService).not.toHaveBeenCalled();
  });

  it('plans only profiled routes and lists every other route with its reason', () => {
    const response = buildAllocationResponse(view(), AQ());
    expect(response.recommendationOnly).toBe(true);
    expect(response.coverage.profiled).toEqual({ n: 1, of: 3 });
    expect(response.coverage.planned).toEqual({ n: 1, of: 3 });
    const reasons = Object.fromEntries(response.excluded.map((e) => [e.routeName, e.reason]));
    expect(reasons).toEqual({ [UNPROFILED]: 'not_profiled', [TIED]: 'no_primary_depot' });
    const planned = [
      ...response.moves.map((m) => m.routeName),
      ...response.unchanged.map((u) => u.routeName),
    ];
    expect(planned).toEqual([NEAR_B]);
    // Its terminals sit by Beta's yard and Beta has modelled room: a full move, not a make-room one.
    expect(
      response.moves.map((m) => [m.routeName, m.fromDepotId, m.toDepotId, m.madeRoom]),
    ).toEqual([[NEAR_B, ALPHA.id, BETA.id, false]]);
    expect(response.moves[0]!.fromDeadKmPerTrip).toBeGreaterThan(
      response.moves[0]!.toDeadKmPerTrip,
    );
  });

  it('reports totals that reconcile with the allocator and are tagged modelled', () => {
    const analysis = analyseSnapshot(view());
    const input = allocationInputFor(view(), analysis);
    const plan = planAllocation(input.routes, input.depots);
    const response = buildAllocationResponse(view(), AQ());
    expect(response.beforeKmPerDay.value).toBe(plan.beforeKmPerDay);
    expect(response.afterKmPerDay.value).toBe(plan.afterKmPerDay);
    expect(response.savedKmPerDay.value).toBe(plan.savedKmPerDay);
    expect(response.savedKmPerDay.provenance).toBe('modelled');
    expect(response.savedKmPerDay.coverage).toEqual({ n: 1, of: 3 });
    const sum = response.moves.reduce((total, m) => total + m.savedKmPerDay, 0);
    expect(sum).toBeCloseTo(plan.savedKmPerDay, 6);
    expect(response.beforeKmPerDay.value).toBeGreaterThan(0);
  });

  it('counts how each depot position was found', () => {
    const response = buildAllocationResponse(view(), AQ());
    const { yard, median, none } = response.depotPositions;
    expect(yard + median + none).toBe(2);
    expect(none).toBe(0);
    expect(response.depotPositions.provenance).toBe('derived');
  });

  it("keeps network totals under a depot filter and lists only that depot's routes", () => {
    const all = buildAllocationResponse(view(), AQ());
    const beta = buildAllocationResponse(view(), AQ({ depotId: BETA.id }));
    expect(beta.savedKmPerDay).toEqual(all.savedKmPerDay);
    expect(beta.depotId).toBe(BETA.id);
    // The tied route is run partly by Beta; the profiled route is Alpha's alone.
    expect(beta.excluded.map((e) => e.routeName)).toEqual([TIED]);
    expect(beta.unchanged.map((u) => u.routeName)).toEqual([]);
    expect(beta.moves.map((m) => m.toDepotId)).toEqual([BETA.id]);
  });
});
