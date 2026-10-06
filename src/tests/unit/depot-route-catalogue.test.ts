import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalSchedule, ScheduleResponse } from '@/models/canonical';
import type { DepotBusRow } from '@/models/depotLive';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';

vi.mock('@/lib/upsrtc/scheduleService', () => ({ fetchBusSchedule: vi.fn() }));

import { fetchBusSchedule } from '@/lib/upsrtc/scheduleService';
import {
  ROUTE_CACHE_MAX,
  ROUTE_NEGATIVE_TTL_MS,
  getRouteProfile,
  resetRouteCatalogueForTests,
  routeCacheSizeForTests,
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
