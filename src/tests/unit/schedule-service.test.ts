import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpstreamFetchResult } from '@/lib/upsrtc/client';
import scheduleFixture from '@/fixtures/upsrtc-schedule-sample.json';

vi.mock('@/lib/upsrtc/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/upsrtc/client')>()),
  fetchUpstream: vi.fn(),
}));
vi.mock('@/lib/auth/authorize', () => ({
  requireUpsrtcAccess: vi.fn(),
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));

import { fetchUpstream } from '@/lib/upsrtc/client';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';

/**
 * Characterisation of the schedule endpoint, pinned before the fetch logic
 * moved into `scheduleService`. Every case goes through the route handler so
 * the same assertions prove the response is unchanged by the move.
 */

const mockFetch = vi.mocked(fetchUpstream);
const mockAccess = vi.mocked(requireUpsrtcAccess);
const T0 = Date.UTC(2026, 9, 6, 6, 0, 0);
const TODAY = '2026-10-06';
const REG = 'UP78JT4102';
const NOT_ASSIGNED = ' Bus Not Assigned!!! ';

const ok = (payload: unknown): UpstreamFetchResult => ({
  ok: true,
  status: 200,
  contentType: 'application/json',
  payload,
});
const fail: UpstreamFetchResult = {
  ok: false,
  status: 502,
  contentType: 'unknown',
  payload: null,
  error: 'HTTP 502',
};

type Route = typeof import('@/app/api/upsrtc/schedule/route');
let route: Route;

async function call(query: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await route.GET(
    new Request(`http://localhost/api/upsrtc/schedule?${query}`) as never,
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const urlDate = (args: readonly unknown[]): string | null =>
  new URL(String(args[0])).searchParams.get('date');

describe('schedule endpoint (characterisation)', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    vi.resetModules();
    mockFetch.mockReset();
    mockAccess.mockResolvedValue({ project: 'upsrtc' } as never);
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    route = await import('@/app/api/upsrtc/schedule/route');
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
  });

  it('refuses an unauthorised caller before any work', async () => {
    mockAccess.mockResolvedValue(null);
    const { status } = await call(`regNum=${REG}`);
    expect(status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects a malformed registration and a malformed date with 400', async () => {
    const badReg = await call('regNum=nope');
    expect(badReg.status).toBe(400);
    expect(badReg.body.schedule).toBeNull();
    expect(badReg.body.source).toBe('live');
    expect(badReg.body.message).toBe('Malformed registration number');
    const badDate = await call(`regNum=${REG}&date=06-10-2026`);
    expect(badDate.status).toBe(400);
    expect(badDate.body.message).toBe('Date must be YYYY-MM-DD');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns the live schedule, then serves the same request from cache', async () => {
    mockFetch.mockResolvedValue(ok(scheduleFixture));
    const first = await call(`regNum=${REG.toLowerCase()}`);
    expect(first.status).toBe(200);
    expect(first.body.source).toBe('live');
    expect(first.body.stale).toBe(false);
    expect(first.body.fetchedAt).toBe(new Date(T0).toISOString());
    const schedule = first.body.schedule as { registrationNumber: string; stops: unknown[] };
    expect(schedule.registrationNumber).toBe(REG);
    expect(schedule.stops.length).toBeGreaterThan(2);
    expect(first.body.message).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const second = await call(`regNum=${REG}`);
    expect(second.body.source).toBe('cache');
    expect(second.body.schedule).toEqual(first.body.schedule);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps trip id in the cache key', async () => {
    mockFetch.mockResolvedValue(ok(scheduleFixture));
    await call(`regNum=${REG}`);
    await call(`regNum=${REG}&tripId=30396`);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('answers the bare-string "not assigned" reply with a null schedule and a message, cached', async () => {
    mockFetch.mockResolvedValue(ok(NOT_ASSIGNED));
    const first = await call(`regNum=${REG}&date=${TODAY}`);
    expect(first.status).toBe(200);
    expect(first.body.schedule).toBeNull();
    expect(first.body.source).toBe('live');
    expect(first.body.stale).toBe(false);
    expect(first.body.message).toBe(
      `No UPSRTC schedule assigned to this vehicle (checked ${TODAY} and the preceding operating days).`,
    );
    // today, yesterday, the day before: three distinct candidates.
    expect(mockFetch.mock.calls.map(urlDate)).toEqual([TODAY, '2026-10-05', '2026-10-04']);

    const second = await call(`regNum=${REG}&date=${TODAY}`);
    expect(second.body.source).toBe('cache');
    expect(second.body.schedule).toBeNull();
    expect(second.body.message).toBe(first.body.message);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('puts the requested date first and fans out to the other candidates', async () => {
    mockFetch.mockResolvedValue(ok(NOT_ASSIGNED));
    await call(`regNum=${REG}&date=2026-10-03`);
    expect(mockFetch.mock.calls.map(urlDate)).toEqual([
      '2026-10-03',
      TODAY,
      '2026-10-05',
      '2026-10-04',
    ]);
  });

  it('finds a schedule on a fallback date when the primary has none', async () => {
    mockFetch.mockImplementation(async (url) =>
      new URL(url).searchParams.get('date') === '2026-10-05'
        ? ok(scheduleFixture)
        : ok(NOT_ASSIGNED),
    );
    const { body } = await call(`regNum=${REG}&date=${TODAY}`);
    expect(body.source).toBe('live');
    expect(body.schedule).not.toBeNull();
    expect(body.message).toBeUndefined();
  });

  it('falls back to the fixture, naming the reason, when upstream fails with nothing cached', async () => {
    mockFetch.mockResolvedValue(fail);
    const { status, body } = await call(`regNum=${REG}&date=${TODAY}`);
    expect(status).toBe(200);
    expect(body.source).toBe('fixture');
    expect(body.stale).toBe(true);
    expect(body.message).toBe('Showing UPSRTC fixture fallback (HTTP 502).');
    expect(body.schedule).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('reports a failed primary as the error when the others merely lack an assignment', async () => {
    mockFetch.mockImplementation(async (url) =>
      new URL(url).searchParams.get('date') === TODAY ? fail : ok(NOT_ASSIGNED),
    );
    const { body } = await call(`regNum=${REG}&date=${TODAY}`);
    expect(body.source).toBe('fixture');
    expect(body.message).toBe('Showing UPSRTC fixture fallback (HTTP 502).');
  });

  it('serves the last good schedule, flagged stale, when upstream fails after the TTL', async () => {
    mockFetch.mockResolvedValue(ok(scheduleFixture));
    const good = await call(`regNum=${REG}&date=${TODAY}`);
    vi.setSystemTime(T0 + 121_000);
    mockFetch.mockResolvedValue(fail);
    const stale = await call(`regNum=${REG}&date=${TODAY}`);
    expect(stale.status).toBe(200);
    expect(stale.body.source).toBe('cache');
    expect(stale.body.stale).toBe(true);
    expect(stale.body.fetchedAt).toBe(new Date(T0).toISOString());
    expect(stale.body.schedule).toEqual(good.body.schedule);
    expect(stale.body.message).toBeUndefined();
  });

  it('does not use a cached "not assigned" as last good when upstream then fails', async () => {
    mockFetch.mockResolvedValue(ok(NOT_ASSIGNED));
    await call(`regNum=${REG}&date=${TODAY}`);
    vi.setSystemTime(T0 + 121_000);
    mockFetch.mockResolvedValue(fail);
    const { body } = await call(`regNum=${REG}&date=${TODAY}`);
    expect(body.source).toBe('fixture');
  });

  it('forces the fixture in demo mode without touching upstream', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = '1';
    const { body } = await call(`regNum=${REG}&date=${TODAY}`);
    expect(body.source).toBe('fixture');
    expect(body.stale).toBe(true);
    expect(body.message).toBe('Showing UPSRTC fixture fallback (Fixture mode forced).');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('fetchBusSchedule (direct)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    vi.resetModules();
    mockFetch.mockReset();
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
  });
  afterEach(() => vi.useRealTimers());

  it('serves a repeat call from cache, stamped with the clock passed in', async () => {
    const { fetchBusSchedule } = await import('@/lib/upsrtc/scheduleService');
    mockFetch.mockResolvedValue(ok(scheduleFixture));
    const input = { regNum: REG, date: TODAY, tripId: null };
    const live = await fetchBusSchedule(input, T0);
    expect(live.source).toBe('live');
    const cached = await fetchBusSchedule(input, T0 + 60_000);
    expect(cached.source).toBe('cache');
    expect(cached.fetchedAt).toBe(new Date(T0 + 60_000).toISOString());
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('answers "not assigned" when a fallback date failed, unless asked to be strict', async () => {
    const { fetchBusSchedule } = await import('@/lib/upsrtc/scheduleService');
    mockFetch.mockImplementation(async (url) =>
      new URL(url).searchParams.get('date') === TODAY ? ok(NOT_ASSIGNED) : fail,
    );
    const input = { regNum: REG, date: TODAY, tripId: null };
    const lenient = await fetchBusSchedule(input, T0);
    expect(lenient.source).toBe('live');
    expect(lenient.schedule).toBeNull();
    expect((await fetchBusSchedule(input, T0)).source).toBe('cache');
    const calls = mockFetch.mock.calls.length;

    // Strict: a date that did not answer means nobody knows, so it is a failure,
    // and the partial answer cached above is not served as an answer either.
    const strict = await fetchBusSchedule(input, T0, { requireEveryDateAnswered: true });
    expect(strict.source).toBe('fixture');
    expect(strict.message).toBe('Showing UPSRTC fixture fallback (HTTP 502).');
    expect(mockFetch.mock.calls.length).toBeGreaterThan(calls);
    // The failure was not cached: asking again calls the server again.
    const again = mockFetch.mock.calls.length;
    await fetchBusSchedule(input, T0, { requireEveryDateAnswered: true });
    expect(mockFetch.mock.calls.length).toBeGreaterThan(again);
  });

  it('caches a strict "not assigned" when every date answered so', async () => {
    const { fetchBusSchedule } = await import('@/lib/upsrtc/scheduleService');
    mockFetch.mockResolvedValue(ok(NOT_ASSIGNED));
    const input = { regNum: REG, date: TODAY, tripId: null };
    const options = { requireEveryDateAnswered: true };
    const first = await fetchBusSchedule(input, T0, options);
    expect(first.source).toBe('live');
    expect(first.schedule).toBeNull();
    const second = await fetchBusSchedule(input, T0, options);
    expect(second.source).toBe('cache');
    expect(second.schedule).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('stamps the fallback sample with the clock passed in, not the machine clock', async () => {
    const { fetchBusSchedule } = await import('@/lib/upsrtc/scheduleService');
    mockFetch.mockResolvedValue(fail);
    const later = T0 + 3_600_000;
    const response = await fetchBusSchedule({ regNum: REG, date: TODAY, tripId: null }, later);
    expect(response.source).toBe('fixture');
    expect(response.fetchedAt).toBe(new Date(later).toISOString());
  });

  it('holds at most its bound of lookups, forgetting the oldest first', async () => {
    const { fetchBusSchedule, SCHEDULE_CACHE_MAX_KEYS } = await import(
      '@/lib/upsrtc/scheduleService'
    );
    mockFetch.mockResolvedValue(ok(scheduleFixture));
    const lookup = (trip: number) =>
      fetchBusSchedule({ regNum: REG, date: TODAY, tripId: `t${trip}` }, T0);
    for (let trip = 0; trip <= SCHEDULE_CACHE_MAX_KEYS; trip += 1) await lookup(trip);
    const callsAfterFilling = mockFetch.mock.calls.length;
    expect((await lookup(SCHEDULE_CACHE_MAX_KEYS)).source).toBe('cache');
    expect((await lookup(1)).source).toBe('cache');
    expect(mockFetch).toHaveBeenCalledTimes(callsAfterFilling);
    // The first lookup was forgotten: asking again calls the schedule server.
    expect((await lookup(0)).source).toBe('live');
    expect(mockFetch).toHaveBeenCalledTimes(callsAfterFilling + 1);
  });

  it('counts the fallback dates back from the clock passed in, not the machine clock', async () => {
    const { fetchBusSchedule } = await import('@/lib/upsrtc/scheduleService');
    mockFetch.mockResolvedValue(ok(NOT_ASSIGNED));
    const twoDaysOn = T0 + 2 * 86_400_000;
    await fetchBusSchedule({ regNum: REG, date: '2026-10-01', tripId: null }, twoDaysOn);
    expect(mockFetch.mock.calls.map(urlDate)).toEqual([
      '2026-10-01',
      '2026-10-08',
      '2026-10-07',
      '2026-10-06',
    ]);
  });

  it('counts the fallback dates back from the operating date it is given', async () => {
    const { fetchBusSchedule, SCHEDULE_MAX_UPSTREAM_CALLS } = await import(
      '@/lib/upsrtc/scheduleService'
    );
    mockFetch.mockResolvedValue(ok(NOT_ASSIGNED));
    await fetchBusSchedule({ regNum: REG, date: '2026-10-01', tripId: null }, T0, {
      today: '2026-10-20',
    });
    const dates = mockFetch.mock.calls.map(urlDate);
    expect(dates).toEqual(['2026-10-01', '2026-10-20', '2026-10-19', '2026-10-18']);
    // The most calls one lookup can make.
    expect(SCHEDULE_MAX_UPSTREAM_CALLS).toBe(dates.length);
  });
});
