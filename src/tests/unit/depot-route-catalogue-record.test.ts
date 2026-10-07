import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalSchedule, ScheduleResponse } from '@/models/canonical';
import type { DepotBusRow } from '@/models/depotLive';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import type { ScheduledTrip } from '@/lib/depot/service/types';
import type { BusScheduleOptions } from '@/lib/upsrtc/scheduleService';

vi.mock('@/lib/upsrtc/scheduleService', () => ({ fetchBusSchedule: vi.fn() }));
vi.mock('@/lib/serverLog', () => ({ logDepotError: vi.fn() }));

import { fetchBusSchedule } from '@/lib/upsrtc/scheduleService';
import { logDepotError } from '@/lib/serverLog';
import { getRouteProfile, resetRouteCatalogueForTests } from '@/lib/depot/routes/routeCatalogue';

/*
 * A successful route lookup records the sampled bus's whole day (every trip, other
 * routes included) for the feed's operating date; nothing else does.
 */

const mockService = vi.mocked(fetchBusSchedule);
const FEED_NOW = '2026-10-06T10:00:00.000Z';
const FEED_DATE = '2026-10-06';
const ROUTE = 'RKD_4560_ORD_OUT';
const REG = 'UP78JT4102';

const row = { registrationNumber: REG, routeName: ROUTE, routeDescription: null, journeyId: '30396',
  scheduledStart: '2026-10-05T23:00:00.000Z', gpsTimestamp: FEED_NOW, receivedAt: FEED_NOW,
  speedKmph: 40, ignitionOn: true, tripStatus: 'Live', vehicleStatus: 'live' } as unknown as DepotBusRow;
const VIEW: FleetSnapshotView = {
  rows: [row], feedNow: FEED_NOW, fetchedAt: FEED_NOW, source: 'live', stale: false, recordCount: 1,
};

const schedule = (routeName: string): CanonicalSchedule => ({
  registrationNumber: REG, date: '2026-10-05', routeId: '1', routeName, originName: null,
  destinationName: null, tripId: '30396', scheduledDeparture: null, scheduledArrival: null,
  direction: 'OUT', tripCount: 2,
  stops: [1, 2].map((sequence) => ({
    id: `s${sequence}`, name: `Stop ${sequence}`, sequence, latitude: 28 + sequence, longitude: 79,
    scheduledArrival: '08:00:00', scheduledDeparture: '08:00:00',
  })),
});

const trip = (journeyId: string, routeName: string): ScheduledTrip => ({
  forDate: '2026-10-05', answeredDate: '2026-10-05', registrationNumber: REG, journeyId,
  journeyCode: null, routeName, startTime: '08:00', endTime: '10:00', stops: 2,
});
const DAY = [trip('30396', ROUTE), trip('30397', 'RKD_4560_ORD_IN')];

/** The service answers `response`, handing `day` to a caller that asked for it. */
function answers(response: ScheduleResponse, day: readonly ScheduledTrip[] | null): void {
  mockService.mockImplementation(async (_input, _now, options: BusScheduleOptions = {}) => {
    if (day !== null) options.onDay?.(day);
    return response;
  });
}

const live = (routeName: string): ScheduleResponse => ({
  schedule: schedule(routeName), fetchedAt: FEED_NOW, source: 'live', stale: false,
});

beforeEach(() => {
  resetRouteCatalogueForTests();
  mockService.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('the route lookup records the sampled bus day', () => {
  it('records every trip of the day for the feed date, keeping the date that answered', async () => {
    answers(live(ROUTE), DAY);
    const record = vi.fn(async () => undefined);
    const result = await getRouteProfile(ROUTE, VIEW, 0, undefined, record);
    expect(result.status).toBe('ok');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      DAY.map((t) => ({ ...t, forDate: FEED_DATE, answeredDate: '2026-10-05' })),
    );
  });

  it('records nothing when the lookup is not a success', async () => {
    const record = vi.fn(async () => undefined);
    answers(live('ANOTHER_ROUTE'), DAY);
    expect((await getRouteProfile(ROUTE, VIEW, 0, undefined, record)).status).toBe('unavailable');
    resetRouteCatalogueForTests();
    answers({ schedule: null, fetchedAt: FEED_NOW, source: 'fixture', stale: true }, null);
    expect((await getRouteProfile(ROUTE, VIEW, 0, undefined, record)).status).toBe('unavailable');
    expect(record).not.toHaveBeenCalled();
  });

  it('keeps the profile when recording fails, and logs the failure', async () => {
    answers(live(ROUTE), DAY);
    const record = vi.fn(async () => {
      throw new Error('store down');
    });
    const result = await getRouteProfile(ROUTE, VIEW, 0, undefined, record);
    expect(result.status).toBe('ok');
    expect(logDepotError).toHaveBeenCalled();
  });

  it('records nothing from a cached profile: no lookup was made', async () => {
    answers(live(ROUTE), DAY);
    const record = vi.fn(async () => undefined);
    await getRouteProfile(ROUTE, VIEW, 0, undefined, record);
    await getRouteProfile(ROUTE, VIEW, 0, undefined, record);
    expect(record).toHaveBeenCalledTimes(1);
  });
});
