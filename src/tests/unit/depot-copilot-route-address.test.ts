import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/authorize', () => ({
  requireUpsrtcAccess: vi.fn(),
  unauthorizedResponse: vi.fn(() => new Response(null, { status: 401 })),
}));
vi.mock('@/lib/upsrtc/liveSnapshot', () => ({ getLiveSnapshot: vi.fn() }));
vi.mock('@/lib/depot/routes/routeCatalogue', () => ({
  ROUTE_LOOKUP_DEADLINE_MS: 25_000,
  getRouteProfile: vi.fn(),
}));

import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { getLiveSnapshot } from '@/lib/upsrtc/liveSnapshot';
import { getRouteProfile } from '@/lib/depot/routes/routeCatalogue';
import { ROUTE_PROFILE_FETCH_LIMITS } from '@/lib/depot/rateLimit';
import { GET } from '@/app/api/upsrtc/depot/route/[routeName]/route';

/**
 * The route-profile address limiter: behind a trusted proxy, cache misses from
 * one address are limited however many sessions the shared PIN opens.
 */

const { perAddressPerMinute } = ROUTE_PROFILE_FETCH_LIMITS;
/** The limit counts calls to the schedule server; each lookup here makes one. */
const lookupsPerAddress = perAddressPerMinute;
const HEADER = 'x-real-ip';
const ADDRESS = '10.0.0.7';
const LIMITERS_KEY = Symbol.for('olympuss.depot.routeProfileFetchLimiters');

/** A miss asks the permit before its one call; a hit asks nothing. */
const lookup = { miss: true };
async function lookupAsking(
  ...[, , , permit]: Parameters<typeof getRouteProfile>
): ReturnType<typeof getRouteProfile> {
  const decision = lookup.miss && permit ? permit() : null;
  if (!decision?.limited) return { status: 'unavailable', reason: 'no_schedule' };
  return { status: 'limited', retryAfterSeconds: decision.retryAfterSeconds };
}

let session = 0;
/** A fresh login for every call, as a PIN holder who logs in again would have. */
const freshLogin = (): void => {
  session += 1;
  vi.mocked(requireUpsrtcAccess).mockResolvedValue({
    project: 'upsrtc',
    role: 'project-access',
    iat: 0,
    exp: 0,
    sid: `relogin-${session}`,
  });
};
const callFrom = (address: string): Promise<Response> => {
  freshLogin();
  return GET(
    new Request('http://localhost/api/upsrtc/depot/route/x', {
      headers: { [HEADER]: address },
    }) as never,
    { params: Promise.resolve({ routeName: 'R_1' }) },
  );
};

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[LIMITERS_KEY];
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
  lookup.miss = true;
  vi.mocked(getRouteProfile).mockReset().mockImplementation(lookupAsking);
});
afterEach(() => vi.unstubAllEnvs());

describe('route profile address limiter', () => {
  it('limits misses from one address across different sessions when the header is trusted', async () => {
    vi.stubEnv('DEPOT_TRUSTED_IP_HEADER', HEADER);
    for (let i = 0; i < lookupsPerAddress; i += 1) {
      expect((await callFrom(ADDRESS)).status).toBe(200);
    }
    expect((await callFrom(ADDRESS)).status).toBe(429);
    // Another address still fetches.
    expect((await callFrom('10.0.0.8')).status).toBe(200);
  });

  it('never limits cache hits, even from an address that is out of misses', async () => {
    vi.stubEnv('DEPOT_TRUSTED_IP_HEADER', HEADER);
    for (let i = 0; i < lookupsPerAddress; i += 1) await callFrom(ADDRESS);
    // The address is out of misses: its next miss is refused.
    expect((await callFrom(ADDRESS)).status).toBe(429);
    lookup.miss = false;
    for (let i = 0; i < lookupsPerAddress; i += 1) {
      expect((await callFrom(ADDRESS)).status).toBe(200);
    }
  });

  it('is unchanged without the header: fresh sessions are limited per identity only', async () => {
    vi.stubEnv('DEPOT_TRUSTED_IP_HEADER', '');
    for (let i = 0; i <= lookupsPerAddress; i += 1) {
      expect((await callFrom(ADDRESS)).status).toBe(200);
    }
  });
});
