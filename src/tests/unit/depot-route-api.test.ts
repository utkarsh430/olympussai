import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/authorize', () => ({
  requireUpsrtcAccess: vi.fn(),
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/upsrtc/liveSnapshot', () => ({ getLiveSnapshot: vi.fn() }));
vi.mock('@/lib/depot/routes/routeCatalogue', () => ({
  ROUTE_LOOKUP_DEADLINE_MS: 25_000,
  getRouteProfile: vi.fn(),
  // A cache hit: these tests are not about the upstream throttle.
  routeProfileNeedsFetch: vi.fn(() => false),
}));

import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { getLiveSnapshot } from '@/lib/upsrtc/liveSnapshot';
import { getRouteProfile } from '@/lib/depot/routes/routeCatalogue';
import { GET } from '@/app/api/upsrtc/depot/route/[routeName]/route';

const mockAccess = vi.mocked(requireUpsrtcAccess);
const mockSnapshot = vi.mocked(getLiveSnapshot);
const mockProfile = vi.mocked(getRouteProfile);

async function call(routeName: string): Promise<Response> {
  return GET(new Request('http://localhost/api/upsrtc/depot/route/x') as never, {
    params: Promise.resolve({ routeName }),
  });
}

describe('GET /api/upsrtc/depot/route/[routeName]', () => {
  beforeEach(() => {
    mockAccess.mockReset().mockResolvedValue({ project: 'upsrtc' } as never);
    mockSnapshot.mockReset().mockResolvedValue({
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
    mockProfile.mockReset().mockResolvedValue({ status: 'unavailable', reason: 'no_schedule' });
  });

  it('refuses an unauthorised caller first', async () => {
    mockAccess.mockResolvedValue(null);
    expect((await call('R_1')).status).toBe(401);
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  it.each(['../x', 'a'.repeat(65), 'a/b', 'a%2Fb', '%2e%2e', 'a b', ''])(
    'refuses %j before any snapshot or upstream access',
    async (name) => {
      const response = await call(name);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid route name' });
      expect(mockSnapshot).not.toHaveBeenCalled();
      expect(mockProfile).not.toHaveBeenCalled();
    },
  );

  it('answers an unavailable result as a 200 with that body', async () => {
    const response = await call('RKD_4560_ORD_OUT');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe('unavailable');
    expect(body.reason).toBe('no_schedule');
    expect(typeof body.fetchedAt).toBe('string');
    expect(mockProfile.mock.calls[0]?.[0]).toBe('RKD_4560_ORD_OUT');
  });

  it('answers any thrown error as a 503 that leaks nothing, and logs it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSnapshot.mockRejectedValue(new Error('secret upstream detail'));
    const response = await call('R_1');
    expect(errorSpy).toHaveBeenCalledWith('[depot:route-api] secret upstream detail');
    errorSpy.mockRestore();
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: 'Route data unavailable' });
    expect(text).not.toContain('secret');
  });
});
