import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalSchedule, ScheduleResponse } from '@/models/canonical';
import type { DepotBusRow } from '@/models/depotLive';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';

vi.mock('@/lib/upsrtc/scheduleService', () => ({ fetchBusSchedule: vi.fn() }));

import { fetchBusSchedule } from '@/lib/upsrtc/scheduleService';
import {
  ROUTE_CACHE_MAX,
  ROUTE_NEGATIVE_TTL_MS,
  getRouteProfile,
  inFlightSizeForTests,
  resetRouteCatalogueForTests,
  routeCacheSizeForTests,
  routeProfileNeedsFetch,
} from '@/lib/depot/routes/routeCatalogue';

const mockService = vi.mocked(fetchBusSchedule);
const T0 = 1_800_000_000_000;
const FEED_NOW = '2026-10-06T10:00:00.000Z';
const ROUTE = 'RKD_4560_ORD_OUT';

function row(registrationNumber: string, overrides: Partial<DepotBusRow> = {}): DepotBusRow {
  return {
    registrationNumber,
    latitude: 28.3,
    longitude: 79.4,
    speedKmph: 40,
    ignitionOn: true,
    gpsTimestamp: '2026-10-06T09:59:00.000Z',
    receivedAt: FEED_NOW,
    depotId: '101',
    depotName: 'Bareilly',
    vehicleStatus: 'live',
    tripStatus: 'Live',
    routeId: '4562',
    routeName: ROUTE,
    routeDescription: 'BAREILLY TO RUDRAPUR',
    journeyId: '30396',
    journeyCode: 'RKD0399',
    scheduledStart: '2026-10-06T08:00:00.000Z',
    scheduledEnd: null,
    actualStart: null,
    delayMinutes: null,
    odometerRaw: null,
    mainPowerOn: true,
    mainVoltage: 24,
    tamperCode: null,
    emergency: false,
    ...overrides,
  };
}

function view(rows: readonly DepotBusRow[]): FleetSnapshotView {
  return {
    rows,
    feedNow: FEED_NOW,
    fetchedAt: FEED_NOW,
    source: 'live',
    stale: false,
    recordCount: rows.length,
  };
}

function schedule(routeName: string = ROUTE): CanonicalSchedule {
  const stop = (sequence: number, lat: number, time: string) => ({
    id: `s${sequence}`,
    name: `Stop ${sequence}`,
    sequence,
    latitude: lat,
    longitude: 79.0,
    scheduledArrival: time,
    scheduledDeparture: time,
  });
  return {
    registrationNumber: 'UP78JT4102',
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
    stops: [stop(1, 28.0, '08:00:00'), stop(2, 29.0, '10:00:00')],
  };
}

const live = (value: CanonicalSchedule | null): ScheduleResponse => ({
  schedule: value,
  fetchedAt: FEED_NOW,
  source: 'live',
  stale: false,
});

// Silenced for every test in the file so no logged line can leak into the run.
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

describe('getRouteProfile', () => {
  beforeEach(() => {
    resetRouteCatalogueForTests();
    mockService.mockReset();
    mockService.mockResolvedValue(live(schedule()));
  });

  it('reports no_bus_on_route without fetching when no row runs the route', async () => {
    const result = await getRouteProfile(ROUTE, view([row('UP1', { routeName: 'OTHER' })]), T0);
    expect(result).toEqual({ status: 'unavailable', reason: 'no_bus_on_route' });
    expect(mockService).not.toHaveBeenCalled();
  });

  it('refuses an invalid route name defensively', async () => {
    const result = await getRouteProfile('../x', view([row('UP1')]), T0);
    expect(result).toEqual({ status: 'unavailable', reason: 'no_bus_on_route' });
    expect(mockService).not.toHaveBeenCalled();
  });

  it('builds the profile from the sampled bus, its date and its journey id', async () => {
    const result = await getRouteProfile(ROUTE, view([row('UP78JT4102')]), T0);
    expect(mockService).toHaveBeenCalledWith(
      { regNum: 'UP78JT4102', date: '2026-10-06', tripId: '30396' },
      T0,
    );
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.profile.routeName).toBe(ROUTE);
    expect(result.profile.sampledFrom).toBe('UP78JT4102');
    expect(result.profile.operatingDate).toBe('2026-10-06');
    expect(result.profile.description).toBe('BAREILLY TO RUDRAPUR');
    expect(result.profile.scheduledDurationMin).toBe(120);
    expect(result.profile.lengthKm).toBeCloseTo(111.2, 1);
  });

  it('falls back to the feed date when the bus has no scheduled start', async () => {
    await getRouteProfile(ROUTE, view([row('UP1', { scheduledStart: null })]), T0);
    expect(mockService.mock.calls[0]?.[0].date).toBe('2026-10-06');
  });

  it('serves a second request the same day from cache with no upstream call', async () => {
    await getRouteProfile(ROUTE, view([row('UP1')]), T0);
    const again = await getRouteProfile(ROUTE, view([row('UP2')]), T0 + 3_600_000);
    expect(again.status).toBe('ok');
    expect(mockService).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight fetch between concurrent requests for a route', async () => {
    let release: (value: ScheduleResponse) => void = () => undefined;
    mockService.mockReturnValue(new Promise<ScheduleResponse>((resolve) => (release = resolve)));
    const first = getRouteProfile(ROUTE, view([row('UP1')]), T0);
    const second = getRouteProfile(ROUTE, view([row('UP1')]), T0);
    release(live(schedule()));
    expect(await first).toEqual(await second);
    expect(mockService).toHaveBeenCalledTimes(1);
  });

  it('answers no_schedule for a bus with no assignment, and for a fixture fallback as upstream_error', async () => {
    mockService.mockResolvedValueOnce(live(null));
    expect(await getRouteProfile(ROUTE, view([row('UP1')]), T0)).toEqual({
      status: 'unavailable',
      reason: 'no_schedule',
    });
    resetRouteCatalogueForTests();
    mockService.mockResolvedValueOnce({ ...live(schedule()), source: 'fixture', stale: true });
    expect(await getRouteProfile(ROUTE, view([row('UP1')]), T0)).toEqual({
      status: 'unavailable',
      reason: 'upstream_error',
    });
  });

  it('answers upstream_error when the service throws', async () => {
    mockService.mockRejectedValueOnce(new Error('boom'));
    expect(await getRouteProfile(ROUTE, view([row('UP1')]), T0)).toEqual({
      status: 'unavailable',
      reason: 'upstream_error',
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('[depot:route-catalogue] boom');
  });

  it('re-tries a negative result only after its TTL', async () => {
    mockService.mockResolvedValue(live(null));
    await getRouteProfile(ROUTE, view([row('UP1')]), T0);
    await getRouteProfile(ROUTE, view([row('UP1')]), T0 + ROUTE_NEGATIVE_TTL_MS - 1);
    expect(mockService).toHaveBeenCalledTimes(1);
    mockService.mockResolvedValue(live(schedule()));
    const after = await getRouteProfile(ROUTE, view([row('UP1')]), T0 + ROUTE_NEGATIVE_TTL_MS);
    expect(mockService).toHaveBeenCalledTimes(2);
    expect(after.status).toBe('ok');
  });

  it('never grows the cache past its bound, evicting the oldest first', async () => {
    // The stand-in schedule carries no route name, so any route name is accepted.
    mockService.mockResolvedValue(live({ ...schedule(), routeName: null }));
    const total = ROUTE_CACHE_MAX + 5;
    for (let i = 0; i < total; i += 1) {
      await getRouteProfile(`R_${i}`, view([row('UP1', { routeName: `R_${i}` })]), T0);
    }
    expect(routeCacheSizeForTests()).toBe(ROUTE_CACHE_MAX);
    mockService.mockClear();
    await getRouteProfile('R_0', view([row('UP1', { routeName: 'R_0' })]), T0);
    expect(mockService).toHaveBeenCalledTimes(1);
    await getRouteProfile(`R_${total - 1}`, view([row('UP1', { routeName: `R_${total - 1}` })]), T0);
    expect(mockService).toHaveBeenCalledTimes(1);
  });

  it('chooses the same bus whatever order the rows arrive in', async () => {
    const rows = [
      row('UP9', { speedKmph: 0 }),
      row('UP5', { gpsTimestamp: '2026-10-06T09:50:00.000Z' }),
      row('UP3', { gpsTimestamp: '2026-10-06T09:59:30.000Z' }),
      row('UP2', { gpsTimestamp: '2026-10-06T09:59:30.000Z' }),
      row('UP1', { gpsTimestamp: null, speedKmph: 40 }),
    ];
    const chosen = new Set<string>();
    for (const order of [rows, [...rows].reverse(), [rows[2]!, rows[4]!, rows[0]!, rows[3]!, rows[1]!]]) {
      resetRouteCatalogueForTests();
      mockService.mockClear();
      await getRouteProfile(ROUTE, view(order), T0);
      chosen.add(mockService.mock.calls[0]?.[0].regNum ?? '');
    }
    // in_service rows only; freshest fix wins; ties go to the lower registration.
    expect([...chosen]).toEqual(['UP2']);
  });

  it('prefers an in-service bus over a fresher one that is standing', async () => {
    const rows = [
      row('UP1', { speedKmph: 0, gpsTimestamp: '2026-10-06T09:59:59.000Z' }),
      row('UP2', { gpsTimestamp: '2026-10-06T09:55:00.000Z' }),
    ];
    await getRouteProfile(ROUTE, view(rows), T0);
    expect(mockService.mock.calls[0]?.[0].regNum).toBe('UP2');
  });
});

describe('route name verification', () => {
  beforeEach(() => {
    resetRouteCatalogueForTests();
    mockService.mockReset();
  });

  it('refuses a schedule for another route, caches that negatively, never stores it as ok', async () => {
    mockService.mockResolvedValue(live(schedule('OTHER_ROUTE')));
    const first = await getRouteProfile(ROUTE, view([row('UP1')]), T0);
    expect(first).toEqual({ status: 'unavailable', reason: 'no_schedule' });
    expect(routeCacheSizeForTests()).toBe(0);
    await getRouteProfile(ROUTE, view([row('UP1')]), T0 + 1_000);
    expect(mockService).toHaveBeenCalledTimes(1);
  });

  it('accepts a null route name but records that it is unconfirmed', async () => {
    mockService.mockResolvedValue(live({ ...schedule(), routeName: null }));
    const result = await getRouteProfile(ROUTE, view([row('UP1')]), T0);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.profile.routeNameConfirmed).toBe(false);
    expect(result.profile.routeName).not.toBe(ROUTE);
  });

  it('confirms a schedule whose own route name matches', async () => {
    mockService.mockResolvedValue(live(schedule()));
    const result = await getRouteProfile(ROUTE, view([row('UP1')]), T0);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.profile.routeNameConfirmed).toBe(true);
    expect(result.profile.routeName).toBe(ROUTE);
  });

  it('accepts a different trip id when the route name is confirmed', async () => {
    mockService.mockResolvedValue(live({ ...schedule(), tripId: '99999' }));
    const result = await getRouteProfile(ROUTE, view([row('UP1')]), T0);
    expect(result.status).toBe('ok');
  });

  it('refuses a different trip id with a different route name', async () => {
    mockService.mockResolvedValue(live({ ...schedule('OTHER_ROUTE'), tripId: '99999' }));
    expect(await getRouteProfile(ROUTE, view([row('UP1')]), T0)).toEqual({
      status: 'unavailable',
      reason: 'no_schedule',
    });
  });

  it('confirms a name that differs only in letter case or padding', async () => {
    for (const name of ['bly_9509_ord', '  BLY_9509_ORD  ']) {
      resetRouteCatalogueForTests();
      mockService.mockResolvedValue(live(schedule(name)));
      const result = await getRouteProfile('BLY_9509_ORD', view([row('UP1', { routeName: 'BLY_9509_ORD' })]), T0);
      if (result.status !== 'ok') throw new Error('expected ok');
      expect(result.profile.routeNameConfirmed).toBe(true);
    }
  });

  it('still refuses a genuinely different name', async () => {
    mockService.mockResolvedValue(live(schedule('BLY_9509_EXP')));
    const result = await getRouteProfile('BLY_9509_ORD', view([row('UP1', { routeName: 'BLY_9509_ORD' })]), T0);
    expect(result).toEqual({ status: 'unavailable', reason: 'no_schedule' });
  });

  it('accepts a null route name as unconfirmed for a bus with no journey id', async () => {
    mockService.mockResolvedValue(live({ ...schedule(), routeName: null, tripId: '55' }));
    const result = await getRouteProfile(ROUTE, view([row('UP1', { journeyId: null })]), T0);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.profile.routeNameConfirmed).toBe(false);
  });

  it('accepts a null route name as unconfirmed when the trip id matches', async () => {
    mockService.mockResolvedValue(live({ ...schedule(), routeName: null, tripId: '30396' }));
    const result = await getRouteProfile(ROUTE, view([row('UP1')]), T0);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.profile.routeNameConfirmed).toBe(false);
  });

  it('refuses a different trip id when the route name is unconfirmed', async () => {
    mockService.mockResolvedValue(live({ ...schedule(), routeName: null, tripId: '99999' }));
    expect(await getRouteProfile(ROUTE, view([row('UP1')]), T0)).toEqual({
      status: 'unavailable',
      reason: 'no_schedule',
    });
  });
});

describe('error logging and cache hygiene', () => {
  beforeEach(() => {
    resetRouteCatalogueForTests();
    mockService.mockReset();
  });

  it('logs a bug inside the profile builder instead of swallowing it', async () => {
    mockService.mockResolvedValue(live({ ...schedule(), stops: null as never }));
    const result = await getRouteProfile(ROUTE, view([row('UP1')]), T0);
    expect(result).toEqual({ status: 'unavailable', reason: 'upstream_error' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toMatch(/^\[depot:route-catalogue\] /);
  });

  it('clears the in-flight entry after a failed fetch and retries after the TTL', async () => {
    mockService.mockRejectedValue(new Error('boom'));
    await getRouteProfile(ROUTE, view([row('UP1')]), T0);
    expect(inFlightSizeForTests()).toBe(0);
    await getRouteProfile(ROUTE, view([row('UP1')]), T0 + ROUTE_NEGATIVE_TTL_MS - 1);
    expect(mockService).toHaveBeenCalledTimes(1);
    mockService.mockResolvedValue(live(schedule()));
    const retried = await getRouteProfile(ROUTE, view([row('UP1')]), T0 + ROUTE_NEGATIVE_TTL_MS);
    expect(mockService).toHaveBeenCalledTimes(2);
    expect(retried.status).toBe('ok');
    expect(inFlightSizeForTests()).toBe(0);
  });

  it('does not let another letter case bypass or reuse a negative entry', async () => {
    mockService.mockResolvedValue(live(null));
    await getRouteProfile(ROUTE, view([row('UP1')]), T0);
    const variant = await getRouteProfile(ROUTE.toLowerCase(), view([row('UP1')]), T0);
    expect(variant).toEqual({ status: 'unavailable', reason: 'no_bus_on_route' });
    expect(mockService).toHaveBeenCalledTimes(1);
  });

  it("does not serve yesterday's ok entry for today's operating date", async () => {
    mockService.mockResolvedValue(live(schedule()));
    await getRouteProfile(ROUTE, view([row('UP1')]), T0);
    const nextDay = row('UP1', { scheduledStart: '2026-10-07T08:00:00.000Z' });
    await getRouteProfile(ROUTE, view([nextDay]), T0 + 86_400_000);
    expect(mockService).toHaveBeenCalledTimes(2);
    expect(mockService.mock.calls[1]?.[0].date).toBe('2026-10-07');
  });
});

describe('routeProfileNeedsFetch', () => {
  beforeEach(() => resetRouteCatalogueForTests());

  it('is true only when getRouteProfile would call the upstream', async () => {
    const fleet = view([row('UP1')]);
    expect(routeProfileNeedsFetch('NO_SUCH_ROUTE', fleet, T0)).toBe(false);
    expect(routeProfileNeedsFetch(ROUTE, fleet, T0)).toBe(true);
    mockService.mockResolvedValue(live(schedule()));
    const pending = getRouteProfile(ROUTE, fleet, T0);
    expect(routeProfileNeedsFetch(ROUTE, fleet, T0)).toBe(false); // in flight
    await pending;
    expect(routeProfileNeedsFetch(ROUTE, fleet, T0)).toBe(false); // cached
    expect(mockService).toHaveBeenCalledTimes(1);
  });

  it('is false while a negative answer is fresh, and true once it ages out', async () => {
    const fleet = view([row('UP1')]);
    mockService.mockResolvedValue(live(null));
    await getRouteProfile(ROUTE, fleet, T0);
    expect(routeProfileNeedsFetch(ROUTE, fleet, T0 + ROUTE_NEGATIVE_TTL_MS - 1)).toBe(false);
    expect(routeProfileNeedsFetch(ROUTE, fleet, T0 + ROUTE_NEGATIVE_TTL_MS)).toBe(true);
  });
});
