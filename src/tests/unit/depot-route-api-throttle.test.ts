import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/authorize', () => ({
  requireUpsrtcAccess: vi.fn(),
  unauthorizedResponse: vi.fn(() => new Response(null, { status: 401 })),
}));
vi.mock('@/lib/upsrtc/liveSnapshot', () => ({ getLiveSnapshot: vi.fn() }));
vi.mock('@/lib/depot/routes/routeCatalogue', () => ({
  getRouteProfile: vi.fn(),
  routeProfileNeedsFetch: vi.fn(),
}));

import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { getLiveSnapshot } from '@/lib/upsrtc/liveSnapshot';
import { getRouteProfile, routeProfileNeedsFetch } from '@/lib/depot/routes/routeCatalogue';
import { ROUTE_PROFILE_FETCH_LIMITS } from '@/lib/depot/rateLimit';
import { GET } from '@/app/api/upsrtc/depot/route/[routeName]/route';

/** Cache misses on the route profile reach the government's server, so they are limited. */

const { perIdentityPerMinute, perProcessPerMinute } = ROUTE_PROFILE_FETCH_LIMITS;
let sidCounter = 0;
const signedInAs = (sid: string): void => {
  vi.mocked(requireUpsrtcAccess).mockResolvedValue({
    project: 'upsrtc',
    role: 'project-access',
    iat: 0,
    exp: 0,
    sid,
  });
};
const call = (): Promise<Response> =>
  GET(new Request('http://localhost/api/upsrtc/depot/route/x') as never, {
    params: Promise.resolve({ routeName: 'R_1' }),
  });

/** The route keeps its limiters on `globalThis`; each test starts from fresh, empty windows. */
const LIMITERS_KEY = Symbol.for('olympuss.depot.routeProfileFetchLimiters');

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[LIMITERS_KEY];
  sidCounter += 1;
  signedInAs(`throttle-${sidCounter}`);
  vi.mocked(getLiveSnapshot)
    .mockReset()
    .mockResolvedValue({
      snapshot: {
        buses: [],
        depotRows: [],
        recordCount: 0,
        rejectedRecordCount: 0,
        fetchedAt: '2026-10-06T10:00:00.000Z',
        feedNow: null,
      },
      source: 'live',
      stale: false,
    });
  vi.mocked(getRouteProfile)
    .mockReset()
    .mockResolvedValue({ status: 'unavailable', reason: 'no_schedule' });
});

describe('route profile upstream throttle', () => {
  it('never limits cache hits', async () => {
    vi.mocked(routeProfileNeedsFetch).mockReturnValue(false);
    for (let i = 0; i < perIdentityPerMinute * 2; i += 1) expect((await call()).status).toBe(200);
  });

  it('limits cache misses per identity with 429, Retry-After and the fixed body', async () => {
    vi.mocked(routeProfileNeedsFetch).mockReturnValue(true);
    for (let i = 0; i < perIdentityPerMinute; i += 1) expect((await call()).status).toBe(200);
    vi.mocked(getRouteProfile).mockClear();
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('cache-control')).toBe('no-store');
    const seconds = Number(limited.headers.get('retry-after'));
    expect(seconds).toBeGreaterThan(0);
    expect(await limited.json()).toEqual({
      error: 'Too many requests',
      retryAfterSeconds: seconds,
    });
    expect(getRouteProfile).not.toHaveBeenCalled();
    // Another identity still fetches.
    signedInAs('someone-else');
    expect((await call()).status).toBe(200);
  });

  it('limits cache misses from all identities together', async () => {
    vi.mocked(routeProfileNeedsFetch).mockReturnValue(true);
    // A fresh process window, each miss from a new identity: some misses pass, and the
    // window closes within the stated ceiling (a miss may be charged more than one call).
    let passed = 0;
    let status = 200;
    for (let i = 0; i <= perProcessPerMinute && status === 200; i += 1) {
      signedInAs(`crowd-${i}`);
      status = (await call()).status;
      if (status === 200) passed += 1;
    }
    expect(passed).toBeGreaterThan(0);
    expect(passed).toBeLessThanOrEqual(perProcessPerMinute);
    expect(status).toBe(429);
    vi.mocked(routeProfileNeedsFetch).mockReturnValue(false);
    expect((await call()).status).toBe(200);
  });
});
