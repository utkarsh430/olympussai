import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpstreamFetchResult } from '@/lib/upsrtc/client';
import type { DepotBusRow } from '@/models/depotLive';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import type { WindowLimiter } from '@/lib/depot/rateLimit';
import scheduleFixture from '@/fixtures/upsrtc-schedule-sample.json';

vi.mock('@/lib/auth/authorize', () => ({
  requireUpsrtcAccess: vi.fn(),
  unauthorizedResponse: vi.fn(() => new Response(null, { status: 401 })),
}));
vi.mock('@/lib/upsrtc/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/upsrtc/client')>()),
  fetchUpstream: vi.fn(),
}));
const snapshotHolder: { view: FleetSnapshotView | null } = { view: null };
const scheduledHolder = vi.hoisted(() => ({
  recordBusDay: vi.fn<(trips: readonly unknown[]) => Promise<void>>(async () => undefined),
}));
vi.mock('@/lib/depot/repositories', () => ({
  getRepositories: () => ({ fleet: { snapshot: async () => snapshotHolder.view } }),
  getServiceRepositories: () => ({ scheduled: scheduledHolder }),
}));

import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { fetchUpstream } from '@/lib/upsrtc/client';
import { requestIdentity, ROUTE_PROFILE_FETCH_LIMITS } from '@/lib/depot/rateLimit';
import { ROUTE_LOOKUP_DEADLINE_MS } from '@/lib/depot/routes/routeCatalogue';

/**
 * The route lookup is limited in calls to the government's schedule server, and each
 * call takes its slot immediately before it is made. Only the server is mocked: the
 * route, the route catalogue, the schedule service and the limiters are the real ones.
 */

const T0 = Date.UTC(2026, 9, 6, 10, 0, 0);
const FEED_NOW = '2026-10-06T10:00:00.000Z';
const NOT_ASSIGNED = ' Bus Not Assigned!!! ';
const ADDRESS_HEADER = 'x-real-ip';
const { perIdentityPerMinute, perAddressPerMinute, perProcessPerMinute, windowMs } =
  ROUTE_PROFILE_FETCH_LIMITS;
const LIMITERS_KEY = Symbol.for('olympuss.depot.routeProfileFetchLimiters');
const mockFetch = vi.mocked(fetchUpstream);

const ok = (payload: unknown): UpstreamFetchResult => ({
  ok: true,
  status: 200,
  contentType: 'application/json',
  payload,
});

/** One bus on each of `count` routes, all on the feed's operating date: three dates to try. */
function fleetOf(count: number): FleetSnapshotView {
  const rows = Array.from({ length: count }, (_, i) => ({
    registrationNumber: `UP78JT${String(1000 + i)}`,
    routeName: `R_${i}`,
    routeDescription: null,
    journeyId: null,
    scheduledStart: '2026-10-06T08:00:00.000Z',
    gpsTimestamp: FEED_NOW,
    receivedAt: FEED_NOW,
    speedKmph: 40,
    ignitionOn: true,
    tripStatus: 'Live',
    vehicleStatus: 'live',
  })) as unknown as DepotBusRow[];
  const source = 'live' as const;
  return { rows, feedNow: FEED_NOW, fetchedAt: FEED_NOW, source, stale: false, recordCount: count };
}

const claimsFor = (sid: string) =>
  ({ project: 'upsrtc', role: 'project-access', iat: 0, exp: 0, sid }) as const;

type Route = typeof import('@/app/api/upsrtc/depot/route/[routeName]/route');
let route: Route;

/** Starts a request now: the session is read synchronously, so concurrent calls keep theirs. */
function call(routeName: string, sid = 'person', address?: string): Promise<Response> {
  vi.mocked(requireUpsrtcAccess).mockResolvedValueOnce(claimsFor(sid));
  const headers = address === undefined ? undefined : { [ADDRESS_HEADER]: address };
  return route.GET(new Request('http://localhost/x', { headers }) as never, {
    params: Promise.resolve({ routeName }),
  });
}

interface Limiters {
  readonly identity: WindowLimiter;
  readonly address: WindowLimiter;
  readonly process: WindowLimiter;
}
const limiters = (): Limiters =>
  (globalThis as Record<symbol, unknown>)[LIMITERS_KEY] as Limiters;
const identityKey = (sid: string): string =>
  requestIdentity(claimsFor(sid), new Headers(), process.env);

/** Slots taken from `limit` for `key`: the limit less the most that still fits. */
function used(limiter: WindowLimiter, key: string, limit: number): number {
  let free = 0;
  while (free < limit && !limiter.check(key, free + 1).limited) free += 1;
  return limit - free;
}

/** Holds every upstream call until released, so the lookups are all in flight at once. */
function heldUpstream(): () => Promise<void> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  mockFetch.mockImplementation(async () => {
    await gate;
    return ok(NOT_ASSIGNED);
  });
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
  };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  vi.resetModules();
  delete (globalThis as Record<symbol, unknown>)[LIMITERS_KEY];
  mockFetch.mockReset().mockResolvedValue(ok(NOT_ASSIGNED));
  vi.mocked(requireUpsrtcAccess).mockReset();
  snapshotHolder.view = fleetOf(60);
  route = await import('@/app/api/upsrtc/depot/route/[routeName]/route');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('route lookups charged per call to the schedule server', () => {
  it('records the sampled bus day of a successful lookup at no further call', async () => {
    const view = fleetOf(1);
    const rows = view.rows.map((r) => ({ ...r, routeName: 'RKD_4560_ORD_OUT' }));
    snapshotHolder.view = { ...view, rows };
    scheduledHolder.recordBusDay.mockClear();
    mockFetch.mockResolvedValue(ok(scheduleFixture));
    expect((await call('RKD_4560_ORD_OUT')).status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const recorded = scheduledHolder.recordBusDay.mock.calls[0]?.[0] as readonly { forDate: string }[];
    expect(recorded).toHaveLength(4);
    expect(recorded.every((t) => t.forDate === '2026-10-06')).toBe(true);
  });

  it('charges a lookup whose first date answers one call', async () => {
    mockFetch.mockResolvedValue(ok(scheduleFixture));
    expect((await call('R_0')).status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(used(limiters().identity, identityKey('person'), perIdentityPerMinute)).toBe(1);
    expect(used(limiters().process, 'all', perProcessPerMinute)).toBe(1);
  });

  it('charges a lookup that needs three dates three calls', async () => {
    expect((await call('R_0')).status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(used(limiters().identity, identityKey('person'), perIdentityPerMinute)).toBe(3);
  });

  it('charges nothing for a cache hit, however many', async () => {
    await call('R_0');
    for (let i = 0; i < perIdentityPerMinute * 2; i += 1) {
      expect((await call('R_0')).status).toBe(200);
    }
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(used(limiters().identity, identityKey('person'), perIdentityPerMinute)).toBe(3);
  });

  it('stops at a refused second call with a 429, caches nothing, succeeds later', async () => {
    await call('R_0'); // builds the limiters
    limiters().identity.take(identityKey('person'), perIdentityPerMinute - 4);
    mockFetch.mockClear();
    const limited = await call('R_1');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('cache-control')).toBe('no-store');
    const seconds = Number(limited.headers.get('retry-after'));
    expect(seconds).toBeGreaterThan(0);
    expect(await limited.json()).toEqual({
      error: 'Too many requests',
      retryAfterSeconds: seconds,
    });
    // Nothing was cached as an answer: asked again at once, it is refused, not served.
    expect((await call('R_1')).status).toBe(429);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(T0 + windowMs);
    expect((await call('R_1')).status).toBe(200);
    // Every date asked again: the stopped lookup's first answer was not kept either.
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('never lets lookups in flight together pass the limit per identity', async () => {
    const release = heldUpstream();
    const lookups = Array.from({ length: 10 }, (_, i) => call(`R_${i}`));
    await release();
    const statuses = (await Promise.all(lookups)).map((r) => r.status);
    expect(mockFetch).toHaveBeenCalledTimes(perIdentityPerMinute);
    expect(statuses).toContain(429);
    expect(statuses.every((s) => s === 200 || s === 429)).toBe(true);
  });

  it('never lets lookups in flight together pass the limit per trusted address', async () => {
    vi.stubEnv('DEPOT_TRUSTED_IP_HEADER', ADDRESS_HEADER);
    const release = heldUpstream();
    const lookups = Array.from({ length: 20 }, (_, i) => call(`R_${i}`, `p${i}`, '10.0.0.7'));
    await release();
    const statuses = (await Promise.all(lookups)).map((r) => r.status);
    expect(mockFetch).toHaveBeenCalledTimes(perAddressPerMinute);
    expect(statuses).toContain(429);
  });

  it('never lets lookups in flight together pass the limit for the process', async () => {
    const release = heldUpstream();
    const lookups = Array.from({ length: 50 }, (_, i) => call(`R_${i}`, `p${i}`));
    await release();
    const statuses = (await Promise.all(lookups)).map((r) => r.status);
    expect(mockFetch).toHaveBeenCalledTimes(perProcessPerMinute);
    expect(statuses).toContain(429);
  });

  it('answers 503 past the deadline; a lookup the limit then stops caches nothing', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(T0);
    await call('R_0'); // builds the limiters
    limiters().identity.take(identityKey('person'), perIdentityPerMinute - 4);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mockFetch.mockReset().mockImplementation(async () => {
      await gate;
      return ok(NOT_ASSIGNED);
    });
    const pending = call('R_1');
    await vi.advanceTimersByTimeAsync(ROUTE_LOOKUP_DEADLINE_MS);
    expect((await pending).status).toBe(503);
    // The first date answers after the deadline; its fallback is refused.
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(T0 + windowMs);
    expect((await call('R_1')).status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});
