// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { loadFleetFixture } from '@/lib/upsrtc/fleetFixture';
import { normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import {
  createServiceHoldStore,
  offerServiceSnapshot,
  type ServiceHoldStore,
} from '@/lib/depot/live/serviceHold';
import { getRepositories, getServiceRepositories } from '@/lib/depot/repositories';
import { liveFleetRepository } from '@/lib/depot/repositories/liveFleetRepository';
import { createMemoryHourlyObservationRepository } from '@/lib/depot/repositories/memoryHourlyObservationRepository';
import {
  createMemoryScheduledTripRepository,
  SCHEDULED_TRIPS_MAX_BUSES,
} from '@/lib/depot/repositories/memoryScheduledTripRepository';
import type { ScheduledTrip } from '@/lib/depot/service/types';

const rows = normalizeDepotRows(loadFleetFixture()).rows;
const ROUTE = 'VND_1613_ORD_OUT';
const DATE = '2026-10-06';
const at = (hhmm: string): string => `${DATE}T${hhmm}:00.000Z`;

function viewOf(feedNow: string): FleetSnapshotView {
  return { rows, feedNow, fetchedAt: at('02:30'), source: 'live', stale: false, recordCount: 1 };
}

describe('the in-memory hourly observation repository', () => {
  let store: ServiceHoldStore;

  beforeEach(() => {
    resetAnalysisForTests();
    store = createServiceHoldStore();
    const analysis = analyseSnapshot({ ...viewOf(at('08:00')), source: 'fixture' });
    for (const hhmm of ['08:00', '08:05', '08:10', '08:15', '08:20', '08:25', '08:30']) {
      offerServiceSnapshot(store, viewOf(at(hhmm)), analysis);
    }
  });

  it("reads a route's and a depot's observed hours from the hold", async () => {
    const repo = createMemoryHourlyObservationRepository(store);
    const hours = await repo.routeHours(ROUTE, DATE);
    expect(hours).toHaveLength(1);
    expect(hours[0]).toMatchObject({ routeName: ROUTE, hour: 8, slotsObserved: 7 });
    const depotId = store.slots.get(96)!.depots.find((d) => d.standingInYard !== null)!.depotId;
    expect((await repo.depotHours(depotId, DATE)).map((h) => h.hour)).toEqual([8]);
    expect(await repo.routeHours(ROUTE, '2026-10-05')).toEqual([]);
    expect(await repo.routeHours('NO_SUCH_ROUTE', DATE)).toEqual([]);
  });

  it('reads the summary, the distinct buses and the journey ledger of the date', async () => {
    const repo = createMemoryHourlyObservationRepository(store);
    expect(await repo.observedSummary(DATE)).toEqual({ since: '08:00', hours: 1, samples: 7 });
    expect(await repo.observedSummary('2026-10-05')).toBeNull();
    expect(await repo.distinctBusesOnRoute(ROUTE, DATE)).toBe(21);
    const buses = await repo.busesOnRoute(ROUTE, DATE);
    expect(buses).toHaveLength(21);
    expect([...buses].sort()).toEqual(buses);
    expect(await repo.busesOnRoute(ROUTE, '2026-10-05')).toEqual([]);
    const journeys = await repo.journeysOnRoute(ROUTE, DATE);
    expect(journeys.length).toBeGreaterThan(0);
    expect(journeys.every((j) => j.routeName === ROUTE && j.lastSeen === at('08:30'))).toBe(true);
  });
});

function trip(partial: Partial<ScheduledTrip>): ScheduledTrip {
  return {
    forDate: DATE,
    answeredDate: DATE,
    registrationNumber: 'UP01AA0001',
    journeyId: 'J1',
    journeyCode: null,
    routeName: 'R1',
    startTime: '07:00',
    endTime: '08:30',
    stops: 12,
    ...partial,
  };
}

describe('the in-memory scheduled trip repository', () => {
  it('records a bus day and reads it by route and date', async () => {
    const repo = createMemoryScheduledTripRepository();
    await repo.recordBusDay([
      trip({ journeyId: 'J2', startTime: '09:00', routeName: 'R1_IN' }),
      trip({}),
      trip({ journeyId: 'J3', startTime: '11:00' }),
    ]);
    await repo.recordBusDay([trip({ registrationNumber: 'UP01AA0002', startTime: '06:00' })]);
    expect((await repo.tripsForRoute('R1', DATE)).map((t) => t.startTime)).toEqual([
      '06:00',
      '07:00',
      '11:00',
    ]);
    expect(await repo.knownBusesOnRoute('R1', DATE)).toEqual(['UP01AA0001', 'UP01AA0002']);
    expect(await repo.knownBusesOnRoute('R1_IN', DATE)).toEqual(['UP01AA0001']);
    expect(await repo.tripsForRoute('R1', '2026-10-07')).toEqual([]);
  });

  it("replaces a bus's day when it is recorded again", async () => {
    const repo = createMemoryScheduledTripRepository();
    await repo.recordBusDay([trip({}), trip({ journeyId: 'J2', startTime: '10:00' })]);
    await repo.recordBusDay([trip({ journeyId: 'J9', startTime: '12:00' })]);
    expect((await repo.tripsForRoute('R1', DATE)).map((t) => t.journeyId)).toEqual(['J9']);
  });

  it('holds no more buses a date than its cap, and only the newest dates', async () => {
    const repo = createMemoryScheduledTripRepository();
    for (let i = 0; i <= SCHEDULED_TRIPS_MAX_BUSES; i += 1) {
      await repo.recordBusDay([trip({ registrationNumber: `BUS${String(i).padStart(5, '0')}` })]);
    }
    expect(await repo.knownBusesOnRoute('R1', DATE)).toHaveLength(SCHEDULED_TRIPS_MAX_BUSES);
    for (const forDate of ['2026-10-07', '2026-10-08', '2026-10-09']) {
      await repo.recordBusDay([trip({ forDate })]);
    }
    expect(await repo.tripsForRoute('R1', DATE)).toEqual([]);
    expect(await repo.tripsForRoute('R1', '2026-10-09')).toHaveLength(1);
  });

  it('ignores an empty day', async () => {
    const repo = createMemoryScheduledTripRepository();
    await repo.recordBusDay([]);
    expect(await repo.tripsForRoute('R1', DATE)).toEqual([]);
    expect(await repo.revision()).toBe(0);
  });

  it('lists the buses with a recorded day, whatever their routes, and counts each record', async () => {
    const repo = createMemoryScheduledTripRepository();
    expect(await repo.revision()).toBe(0);
    await repo.recordBusDay([trip({ registrationNumber: 'UP01AA0002', routeName: 'OTHER' })]);
    await repo.recordBusDay([trip({})]);
    await repo.recordBusDay([trip({})]);
    expect(await repo.recordedBuses(DATE)).toEqual(['UP01AA0001', 'UP01AA0002']);
    expect(await repo.recordedBuses('2026-10-07')).toEqual([]);
    expect(await repo.revision()).toBe(3);
  });
});

describe('the composition root', () => {
  it('keeps the existing repositories and adds the hourly and scheduled stores', () => {
    expect(getRepositories().fleet).toBe(liveFleetRepository);
    const service = getServiceRepositories();
    expect(typeof service.hourly.routeHours).toBe('function');
    expect(typeof service.scheduled.recordBusDay).toBe('function');
    expect(getServiceRepositories()).toBe(service);
  });
});
