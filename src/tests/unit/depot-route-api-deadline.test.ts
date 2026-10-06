import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/authorize', () => ({
  requireUpsrtcAccess: vi.fn(),
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/upsrtc/liveSnapshot', () => ({ getLiveSnapshot: vi.fn() }));
vi.mock('@/lib/depot/routes/routeCatalogue', async (importOriginal) => ({
  ROUTE_LOOKUP_DEADLINE_MS: (
    await importOriginal<typeof import('@/lib/depot/routes/routeCatalogue')>()
  ).ROUTE_LOOKUP_DEADLINE_MS,
  getRouteProfile: vi.fn(),
  routeProfileNeedsFetch: vi.fn(() => false),
}));

import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { getLiveSnapshot } from '@/lib/upsrtc/liveSnapshot';
import { getRouteProfile, ROUTE_LOOKUP_DEADLINE_MS } from '@/lib/depot/routes/routeCatalogue';
import { GET, maxDuration } from '@/app/api/upsrtc/depot/route/[routeName]/route';

/**
 * The snapshot and the lookup together can outlast the platform's limit on the
 * route; the route answers its own fixed error first instead of being killed.
 */

const SECOND_MS = 1_000;

const call = (): Promise<Response> =>
  GET(new Request('http://localhost/api/upsrtc/depot/route/x') as never, {
    params: Promise.resolve({ routeName: 'R_1' }),
  });

describe('route details deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.mocked(requireUpsrtcAccess).mockResolvedValue({ project: 'upsrtc' } as never);
    vi.mocked(getLiveSnapshot).mockReset().mockResolvedValue({
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
  });
  afterEach(() => vi.useRealTimers());

  it('ends well inside the time limit the platform enforces', () => {
    expect(ROUTE_LOOKUP_DEADLINE_MS).toBeLessThan(maxDuration * SECOND_MS);
  });

  it('answers the fixed 503 with no-store when the lookup outlasts the deadline', async () => {
    vi.mocked(getRouteProfile).mockReturnValue(new Promise(() => undefined));
    const pending = call();
    await vi.advanceTimersByTimeAsync(ROUTE_LOOKUP_DEADLINE_MS);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Route data unavailable' });
  });

  it('answers normally when the lookup finishes in time, leaving no timer behind', async () => {
    vi.mocked(getRouteProfile).mockResolvedValue({ status: 'unavailable', reason: 'no_schedule' });
    const response = await call();
    expect(response.status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });
});
