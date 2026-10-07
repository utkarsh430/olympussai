// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpstreamFetchResult } from '@/lib/upsrtc/client';
import type { DepotBusRow } from '@/models/depotLive';
import type { FleetSnapshotView, ServiceRepositories } from '@/lib/depot/repositories/types';
import scheduleFixture from '@/fixtures/upsrtc-schedule-sample.json';

vi.mock('@/lib/auth/authorize', () => ({
  requireUpsrtcAccess: vi.fn(),
  unauthorizedResponse: vi.fn(() =>
    Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } }),
  ),
}));
vi.mock('@/lib/upsrtc/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/upsrtc/client')>()),
  fetchUpstream: vi.fn(),
}));
vi.mock('@/lib/serverLog', () => ({ logDepotError: vi.fn() }));
const holder = vi.hoisted(() => ({
  view: null as FleetSnapshotView | null,
  services: null as ServiceRepositories | null,
}));
vi.mock('@/lib/depot/repositories', () => ({
  getRepositories: () => ({ fleet: { snapshot: async () => holder.view } }),
  getServiceRepositories: () => holder.services,
}));

import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { fetchUpstream } from '@/lib/upsrtc/client';
import { ROUTE_PROFILE_FETCH_LIMITS } from '@/lib/depot/rateLimit';
import { ROUTE_LOOKUP_DEADLINE_MS } from '@/lib/depot/routes/routeCatalogue';
import { createServiceHoldStore } from '@/lib/depot/live/serviceHold';
import { createMemoryHourlyObservationRepository } from '@/lib/depot/repositories/memoryHourlyObservationRepository';
import { createMemoryScheduledTripRepository } from '@/lib/depot/repositories/memoryScheduledTripRepository';

/*
 * One bus's whole day on request: session first, a strict registration and route, the
 * bus must have been seen on the route, the same per-call limits as the route lookup
 * (a fixed 429 with Retry-After), the fixed 503 past the deadline, the day recorded only
 * from a real answer, `no-store` throughout. Only the schedule server is mocked.
 */

const mockFetch = vi.mocked(fetchUpstream);
const T0 = Date.UTC(2026, 9, 6, 10, 0, 0);
const FEED_NOW = '2026-10-06T10:00:00.000Z';
const ROUTE = 'RKD_4560_ORD_OUT';
const REG = 'UP78JT4102';
const NOT_ASSIGNED = ' Bus Not Assigned!!! ';
const LIMITERS_KEY = Symbol.for('olympuss.depot.routeProfileFetchLimiters');

const ok = (payload: unknown): UpstreamFetchResult => ({
  ok: true, status: 200, contentType: 'application/json', payload,
});

function fleet(routeOf: (i: number) => string, count = 30): FleetSnapshotView {
  const rows = Array.from({ length: count }, (_, i) => ({
    registrationNumber: `UP78JT${4102 + i}`, routeName: routeOf(i), journeyId: null,
    scheduledStart: null, gpsTimestamp: FEED_NOW, receivedAt: FEED_NOW, speedKmph: 40,
    ignitionOn: true, tripStatus: 'Live', vehicleStatus: 'live',
  })) as unknown as DepotBusRow[];
  return { rows, feedNow: FEED_NOW, fetchedAt: FEED_NOW, source: 'live', stale: false, recordCount: count };
}

type Route = typeof import('@/app/api/upsrtc/depot/schedule-day/[registration]/route');
let route: Route;

function call(registration: string, query = `route=${ROUTE}`, sid = 'person'): Promise<Response> {
  vi.mocked(requireUpsrtcAccess).mockResolvedValueOnce(
    { project: 'upsrtc', role: 'viewer', iat: 0, exp: 0, sid } as never,
  );
  return route.GET(new Request(`http://localhost/x?${query}`) as never, {
    params: Promise.resolve({ registration }),
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  vi.resetModules();
  delete (globalThis as Record<symbol, unknown>)[LIMITERS_KEY];
  delete process.env.NEXT_PUBLIC_DEMO_MODE;
  mockFetch.mockReset().mockResolvedValue(ok(scheduleFixture));
  vi.mocked(requireUpsrtcAccess).mockReset();
  holder.view = fleet(() => ROUTE);
  holder.services = {
    hourly: createMemoryHourlyObservationRepository(createServiceHoldStore()),
    scheduled: createMemoryScheduledTripRepository(),
  };
  route = await import('@/app/api/upsrtc/depot/schedule-day/[registration]/route');
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.NEXT_PUBLIC_DEMO_MODE;
});

describe('GET /api/upsrtc/depot/schedule-day/[registration]', () => {
  it('answers the fixed 401 before anything is read or asked', async () => {
    vi.mocked(requireUpsrtcAccess).mockResolvedValueOnce(null);
    const res = await route.GET(new Request(`http://localhost/x?route=${ROUTE}`) as never, {
      params: Promise.resolve({ registration: REG }),
    });
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('records and answers the whole day, with the feed envelope and no-store', async () => {
    const res = await call(REG);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: 'ok', registrationNumber: REG, forDate: '2026-10-06', answeredDate: '2026-10-06',
      tripsOnRoute: 2, feedNow: FEED_NOW, source: 'live', stale: false,
    });
    expect(body.trips).toHaveLength(4);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const scheduled = holder.services?.scheduled;
    expect(await scheduled?.recordedBuses('2026-10-06')).toEqual([REG]);
    expect(await scheduled?.tripsForRoute(ROUTE, '2026-10-06')).toHaveLength(2);
  });

  it('accepts a lower-case registration as the same bus', async () => {
    const res = await call(REG.toLowerCase());
    expect(((await res.json()) as { registrationNumber: string }).registrationNumber).toBe(REG);
  });

  it('says a borrowed day: the date that answered is kept beside the date it is used for', async () => {
    mockFetch.mockImplementation(async (url) =>
      new URL(String(url)).searchParams.get('date') === '2026-10-04' ? ok(scheduleFixture) : ok(NOT_ASSIGNED),
    );
    const body = (await (await call(REG)).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'ok', forDate: '2026-10-06', answeredDate: '2026-10-04' });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('records nothing for "not assigned", and asks again next time', async () => {
    mockFetch.mockResolvedValue(ok(NOT_ASSIGNED));
    const body = (await (await call(REG)).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'unavailable', reason: 'no_schedule' });
    expect(await holder.services?.scheduled.recordedBuses('2026-10-06')).toEqual([]);
  });

  it('refuses the sample stand-in: no day is recorded from it', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = '1';
    const body = (await (await call(REG)).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'unavailable', reason: 'upstream_error' });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(await holder.services?.scheduled.recordedBuses('2026-10-06')).toEqual([]);
  });

  it('refuses a malformed registration, route or query with the fixed 400 and asks nothing', async () => {
    const bad = [
      call('../UP1'), call(REG, 'route=..%2Fx'), call(REG, ''), call(REG, `route=${ROUTE}&route=${ROUTE}`),
      call(REG, `route=${ROUTE}&date=2026-10-06`), call(`${REG}${'9'.repeat(40)}`),
    ];
    for (const res of await Promise.all(bad)) {
      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ error: 'Invalid request' });
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('answers the fixed 404 for a bus not seen on the route, and asks nothing', async () => {
    holder.view = fleet((i) => (i === 0 ? 'OTHER_ROUTE' : ROUTE));
    const res = await call(REG);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Bus not seen on this route' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('takes one slot per call from the route lookup limits, and answers the fixed 429 when refused', async () => {
    mockFetch.mockResolvedValue(ok(NOT_ASSIGNED));
    const { perIdentityPerMinute } = ROUTE_PROFILE_FETCH_LIMITS;
    // Three calls each (the feed date and two fallback dates): 6 lookups take 18 of 20.
    for (let i = 0; i < 6; i += 1) expect((await call(`UP78JT${4102 + i}`)).status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(18);
    const res = await call('UP78JT4110');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(Object.keys((await res.json()) as object).sort()).toEqual(['error', 'retryAfterSeconds']);
    expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(perIdentityPerMinute);
  });

  it('answers the fixed 503 past the deadline', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mockFetch.mockReturnValue(new Promise(() => undefined));
    const pending = call(REG);
    await vi.advanceTimersByTimeAsync(ROUTE_LOOKUP_DEADLINE_MS + 1);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: 'Schedule data unavailable' });
  });

  it('answers the fixed 503 when the snapshot fails', async () => {
    holder.view = null;
    const res = await call(REG);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Schedule data unavailable' });
  });
});
