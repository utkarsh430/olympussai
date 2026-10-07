// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { loadFleetFixture } from '@/lib/upsrtc/fleetFixture';
import { normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildRouteHourlyResponse } from '@/lib/depot/live/routeHourlyView';
import type { FleetSnapshotView, ServiceRepositories } from '@/lib/depot/repositories/types';
import { createMemoryHourlyObservationRepository } from '@/lib/depot/repositories/memoryHourlyObservationRepository';
import { createMemoryScheduledTripRepository } from '@/lib/depot/repositories/memoryScheduledTripRepository';
import { defaultServiceHoldStore } from '@/lib/depot/live/serviceHold';
import { routeTimetable } from '@/lib/depot/service/routeTimetable';
import type { RouteHourlyResponse, ScheduledTrip } from '@/lib/depot/service/types';

const rows = normalizeDepotRows(loadFleetFixture()).rows;
const FEED_NOW = '2026-10-06T15:38:00.000Z';
const DATE = '2026-10-06';
const ROUTE = 'VND_1613_ORD_OUT';
const ON_ROUTE = rows.filter((r) => r.routeName === ROUTE).map((r) => r.registrationNumber).sort();

const VIEW: FleetSnapshotView = {
  rows, feedNow: FEED_NOW, fetchedAt: '2026-10-06T10:08:05.000Z', source: 'live', stale: false,
  recordCount: rows.length,
};

function trip(over: Partial<ScheduledTrip>): ScheduledTrip {
  return {
    forDate: DATE, answeredDate: DATE, registrationNumber: ON_ROUTE[0] ?? 'UP1', journeyId: 'T1',
    journeyCode: null, routeName: ROUTE, startTime: '04:00', endTime: '05:30', stops: 10, ...over,
  };
}

let services: ServiceRepositories;

async function answer(): Promise<RouteHourlyResponse> {
  const result = await buildRouteHourlyResponse(VIEW, { routeName: ROUTE, date: null }, services);
  if (result.status !== 200) throw new Error(`expected 200, got ${result.status}`);
  return result.body;
}

beforeEach(() => {
  resetAnalysisForTests();
  services = {
    hourly: createMemoryHourlyObservationRepository(() => defaultServiceHoldStore()),
    scheduled: createMemoryScheduledTripRepository(),
  };
});

describe("a route's timetable by bus", () => {
  it('joins the buses seen, and counts a recorded day only for a bus seen or a day on the route', () => {
    const known = routeTimetable({
      heldBuses: ['B', 'A'], snapshotBuses: ['C', 'A'], recordedBuses: ['A', 'Z', 'Y'],
      knownOnRoute: ['Y'], trips: [],
    });
    expect(known).toEqual({ busesOnRoute: ['A', 'B', 'C'], busesWithDay: ['A', 'Y'], borrowedFrom: [] });
  });
});

describe('the route day with loaded timetables', () => {
  it('lists the buses seen on the route, none with a recorded day yet', async () => {
    const body = await answer();
    expect(ON_ROUTE.length).toBeGreaterThan(5);
    expect(body.busesOnRoute).toEqual(ON_ROUTE);
    expect(body.busesWithDay).toEqual([]);
    expect(body.scheduledCoverage).toEqual({ n: 0, of: ON_ROUTE.length });
    expect(body.timetableBorrowedFrom).toEqual([]);
  });

  it('shows a day recorded between two polls of the same snapshot', async () => {
    const before = await answer();
    const startsBefore = before.hours[4]?.scheduledTripsStarting ?? 0;
    const busHoursBefore = before.hours[4]?.scheduled ?? 0;
    await services.scheduled.recordBusDay([trip({}), trip({ journeyId: 'T2', routeName: 'ELSEWHERE' })]);
    const after = await answer();
    expect(after.hours[4]?.scheduledTripsStarting).toBe(startsBefore + 1);
    expect(after.hours[4]?.scheduled).toBeCloseTo(busHoursBefore + 1, 5);
    expect(after.busesWithDay).toEqual([ON_ROUTE[0]]);
    expect(after.scheduledCoverage).toEqual({ n: 1, of: ON_ROUTE.length });
  });

  it('says a borrowed timetable', async () => {
    await services.scheduled.recordBusDay([trip({ answeredDate: '2026-10-05' })]);
    expect((await answer()).timetableBorrowedFrom).toEqual(['2026-10-05']);
  });
});
