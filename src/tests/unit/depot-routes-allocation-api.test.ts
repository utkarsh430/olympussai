// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import type { DepotRepositories } from '@/lib/depot/repositories/types';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { row } from './depot-yard.fixtures';
import { GET as getRoutes } from '@/app/api/upsrtc/depot/routes/route';
import { GET as getAllocation } from '@/app/api/upsrtc/depot/allocation/route';

vi.mock('@/lib/auth/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/authorize')>();
  return { ...actual, requireUpsrtcAccess: vi.fn() };
});
vi.mock('@/lib/depot/repositories', () => ({ getRepositories: vi.fn() }));
vi.mock('@/lib/upsrtc/scheduleService', () => ({ fetchBusSchedule: vi.fn() }));

const SESSION = { project: 'upsrtc', role: 'viewer', iat: 0, exp: 0 };
const LEAKY = 'ECONNREFUSED 10.0.0.7 token=abc';
const EMPTY_VIEW = {
  rows: [],
  feedNow: null,
  fetchedAt: '2026-10-06T08:00:05.000Z',
  source: 'live',
  stale: false,
  recordCount: 0,
};
/** One bus of depot 101, so a filter on that depot names a unit of the feed. */
const ONE_DEPOT_VIEW = {
  ...EMPTY_VIEW,
  rows: [row({ registrationNumber: 'UP32A0001', depotId: '101', depotName: 'Alpha' })],
  recordCount: 1,
};

const request = (path: string): NextRequest =>
  new NextRequest(`http://localhost:3000/api/upsrtc/depot/${path}`);

const snapshot = vi.fn();
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetAnalysisForTests();
  vi.mocked(getRepositories).mockReset();
  snapshot.mockReset();
  vi.mocked(requireUpsrtcAccess).mockResolvedValue(SESSION);
  vi.mocked(getRepositories).mockReturnValue({
    fleet: { snapshot },
  } as unknown as DepotRepositories);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => errorSpy.mockRestore());

describe.each([
  ['routes', getRoutes, 'routes-api'],
  ['allocation', getAllocation, 'allocation-api'],
] as const)('%s route', (path, GET, logScope) => {
  it('answers 401 before touching any repository', async () => {
    vi.mocked(requireUpsrtcAccess).mockResolvedValue(null);
    const response = await GET(request(path));
    expect(response.status).toBe(401);
    expect(getRepositories).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it.each([
    'depotId=abc',
    'depotId=',
    'depotId=1234567',
    'depotId=101&depotId=102',
    'x=1',
    'offset=-1',
    'offset=1.5',
    'offset=abc',
    'offset=1&offset=2',
    'limit=101',
    'limit=-1',
    'limit=ten',
    'q=a%20b',
    'q=a%25',
    'q=',
    `q=${'A'.repeat(65)}`,
  ])(
    'answers 400 with the fixed body for %s',
    async (query) => {
      const response = await GET(request(`${path}?${query}`));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid query' });
      expect(getRepositories).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    },
  );

  it('answers 503 with the fixed body and logs once when the fleet read throws', async () => {
    snapshot.mockRejectedValue(new Error(LEAKY));
    const response = await GET(request(path));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: 'Depot data unavailable' });
    expect(text).not.toContain('token');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0]?.[0]);
    expect(line).toContain(`[depot:${logScope}]`);
  });

  it('answers 200 with the envelope, no-store, and a depot filter accepted', async () => {
    snapshot.mockResolvedValue(ONE_DEPOT_VIEW);
    const response = await GET(request(`${path}?depotId=101`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      fetchedAt: EMPTY_VIEW.fetchedAt,
      source: 'live',
      stale: false,
      feedNow: null,
      operatingDate: '2026-10-06',
      depotId: '101',
      profileEndpoint: '/api/upsrtc/depot/route/{routeName}',
    });
  });

  it('answers the fixed 404 for a well-formed depot id the feed does not have', async () => {
    snapshot.mockResolvedValue(ONE_DEPOT_VIEW);
    const response = await GET(request(`${path}?depotId=999`));
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Depot not found' });
  });
});

describe('filters that only one endpoint takes', () => {
  it.each(['serviceClass=ord', 'serviceClass=A%2BB', 'sort=colour', 'sort=route&dir=up', 'reason=x'])(
    'routes answers 400 for %s',
    async (query) => {
      const response = await getRoutes(request(`routes?${query}`));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid query' });
    },
  );

  it.each(['reason=hired', 'reason=', 'serviceClass=ORD', 'sort=route'])(
    'allocation answers 400 for %s',
    async (query) => {
      const response = await getAllocation(request(`allocation?${query}`));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid query' });
    },
  );

  it('accepts every filter it documents', async () => {
    snapshot.mockResolvedValue(ONE_DEPOT_VIEW);
    const routes = await getRoutes(
      request('routes?depotId=101&serviceClass=none&q=4560&sort=deadKm&dir=desc&offset=25&limit=100'),
    );
    expect(routes.status).toBe(200);
    const allocation = await getAllocation(
      request('allocation?depotId=101&reason=not_profiled&q=RKD_&offset=0&limit=0'),
    );
    expect(allocation.status).toBe(200);
  });
});

describe('happy path shapes', () => {
  it('routes: an empty network has no routes and zero coverage', async () => {
    snapshot.mockResolvedValue(EMPTY_VIEW);
    const body = (await (await getRoutes(request('routes'))).json()) as Record<string, unknown>;
    expect(body.routes).toEqual([]);
    expect(body.coverage).toEqual({ profiled: { n: 0, of: 0 }, tripsOnDuration: { n: 0, of: 0 } });
    expect(body.depotId).toBeNull();
    expect(body).toMatchObject({ total: 0, inFeed: 0, offset: 0, limit: 25 });
    expect(body.tripDefinition).toBe(
      'A trip is a run that starts at the depot and returns to it; dead kilometres are charged once per trip.',
    );
  });

  it('allocation: an empty network has an empty, recommendation-only plan', async () => {
    snapshot.mockResolvedValue(EMPTY_VIEW);
    const body = (await (await getAllocation(request('allocation'))).json()) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      recommendationOnly: true,
      moves: [],
      unchanged: [],
      excluded: [],
      savedKmPerDay: { value: 0, provenance: 'modelled', coverage: { n: 0, of: 0 } },
      depotPositions: { yard: 0, median: 0, none: 0, provenance: 'derived' },
      unchangedTotal: 0,
      excludedTotal: 0,
      profilesPending: false,
      profilesPendingNote: null,
      offset: 0,
      limit: 25,
    });
    expect(body.excludedByReason).toMatchObject({ not_profiled: 0, unassigned_bucket: 0 });
    expect(body.unchangedByReason).toMatchObject({ already_best: 0, move_limit: 0 });
    expect(body.tripDefinition).toContain('dead kilometres are charged once per trip');
  });
});
