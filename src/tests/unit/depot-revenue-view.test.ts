// @vitest-environment node
import { MIXED_CLASS_NOTE } from '@/lib/depot/sim/revenueConfig';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { DepotBusRow } from '@/models/depotLive';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import { modelledRevenueRepository } from '@/lib/depot/repositories/modelledRevenueRepository';
import type { DepotRepositories, FleetSnapshotView } from '@/lib/depot/repositories/types';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildRevenueResponse } from '@/lib/depot/live/revenueView';
import { cachedRouteProfiles } from '@/lib/depot/routes/routeCatalogue';
import type { RouteProfile } from '@/lib/depot/routes/types';
import { GET } from '@/app/api/upsrtc/depot/[depotId]/revenue/route';

vi.mock('@/lib/auth/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/authorize')>();
  return { ...actual, requireUpsrtcAccess: vi.fn() };
});
vi.mock('@/lib/depot/repositories', () => ({ getRepositories: vi.fn() }));
vi.mock('@/lib/depot/routes/routeCatalogue', () => ({
  cachedRouteProfiles: vi.fn(),
  routeCatalogueRevision: vi.fn(() => 1),
}));

const SESSION = { project: 'upsrtc', role: 'viewer', iat: 0, exp: 0 };
const FEED_NOW = '2026-10-06T08:00:00Z';
const NO_PROFILES = new Map<string, RouteProfile>();
const LUCKNOW_KANPUR = 'Lucknow - Kanpur';
const LENGTH_KM = 80;

function row(over: Partial<DepotBusRow> = {}): DepotBusRow {
  return {
    registrationNumber: 'UP32A0001',
    latitude: 26.85,
    longitude: 80.95,
    speedKmph: 35,
    ignitionOn: true,
    gpsTimestamp: FEED_NOW,
    receivedAt: FEED_NOW,
    depotId: '1',
    depotName: 'Alambagh',
    vehicleStatus: 'live',
    tripStatus: 'Live',
    routeId: null,
    routeName: null,
    routeDescription: null,
    journeyId: null,
    journeyCode: null,
    scheduledStart: null,
    scheduledEnd: null,
    actualStart: null,
    delayMinutes: null,
    odometerRaw: null,
    mainPowerOn: true,
    mainVoltage: null,
    tamperCode: 'C',
    emergency: false,
    ...over,
  };
}

/** Depot 1 runs two routes with three buses each; depot 2 has one bus on another route. */
function world(): DepotBusRow[] {
  const bus = (i: number, routeName: string) =>
    row({ registrationNumber: `A${i}`, routeName, latitude: 26.85 + i / 1000 });
  return [
    ...[0, 1, 2].map((i) => bus(i, LUCKNOW_KANPUR)),
    ...[3, 4, 5].map((i) => bus(i, 'Lucknow - Sitapur')),
    row({ registrationNumber: 'B1', depotId: '2', depotName: 'Barabanki', routeName: 'Barabanki - Ayodhya' }),
  ];
}

function view(rows: readonly DepotBusRow[], over: Partial<FleetSnapshotView> = {}) {
  return {
    rows,
    feedNow: FEED_NOW,
    fetchedAt: '2026-10-06T08:00:05.000Z',
    source: 'live',
    stale: false,
    recordCount: rows.length,
    ...over,
  } satisfies FleetSnapshotView;
}

const repositories = { revenue: modelledRevenueRepository };

function profile(lengthKm: number | null): RouteProfile {
  return { lengthKm, scheduledDurationMin: 150 } as unknown as RouteProfile;
}

const build = async (rows: readonly DepotBusRow[], id = '1') => {
  const response = await buildRevenueResponse(view(rows), id, repositories);
  if (!response) throw new Error(`no depot ${id}`);
  return response;
};

beforeEach(() => {
  resetAnalysisForTests();
  vi.mocked(cachedRouteProfiles).mockReset();
  vi.mocked(cachedRouteProfiles).mockReturnValue(NO_PROFILES);
});

describe('buildRevenueResponse', () => {
  it('is null for a depot the snapshot does not know', async () => {
    expect(await buildRevenueResponse(view(world()), '999', repositories)).toBeNull();
  });

  it('models one row per route the depot runs, highest revenue first', async () => {
    const { routes, depot, operatingDate } = await build(world());
    expect(depot).toEqual({ id: '1', name: 'Alambagh' });
    expect(operatingDate).toBe('2026-10-06');
    expect(routes.map((r) => r.routeName).sort()).toEqual([LUCKNOW_KANPUR, 'Lucknow - Sitapur']);
    const revenues = routes.map((r) => r.revenue);
    expect(revenues).toEqual([...revenues].sort((a, b) => b - a));
  });

  it('reconciles the summary with the route rows, in whole units', async () => {
    const { summary, routes } = await build(world());
    expect(summary.routes).toBe(routes.length);
    expect(summary.trips).toBe(routes.reduce((n, r) => n + r.trips, 0));
    expect(summary.boardings).toBe(routes.reduce((n, r) => n + r.boardings, 0));
    expect(summary.revenue).toBe(routes.reduce((n, r) => n + r.revenue, 0));
    const capacity = routes.reduce((n, r) => n + r.seatCapacity, 0);
    const occupied = routes.reduce((n, r) => n + r.seatCapacity * r.loadFactor, 0);
    expect(Math.round((summary.loadFactor ?? -1) * 1000)).toBe(
      Math.round((occupied / capacity) * 1000),
    );
  });

  it('carries the mixed-class pricing rule as a note a page can print', async () => {
    const { notes } = await build(world());
    expect(notes).toContain(MIXED_CLASS_NOTE);
    expect(MIXED_CLASS_NOTE).toMatch(/most numerous class/);
  });

  it('withholds earnings per kilometre with the reason when no length is known', async () => {
    const { summary, routes } = await build(world());
    expect(summary.earningsPerKm).toBeNull();
    expect(summary.earningsCoverage).toEqual({ n: 0, of: 2 });
    for (const r of routes) {
      expect(r.earningsPerKm).toBeNull();
      expect(r.earningsWithheld).toBe('unknown_length');
      expect(r.lengthProvenance).toBeNull();
    }
  });

  it('computes earnings for a route whose real length is known and tags the length derived', async () => {
    vi.mocked(cachedRouteProfiles).mockReturnValue(
      new Map([[LUCKNOW_KANPUR, profile(LENGTH_KM)]]),
    );
    const { summary, routes } = await build(world());
    const known = routes.find((r) => r.routeName === LUCKNOW_KANPUR);
    expect(known?.lengthKm).toBe(LENGTH_KM);
    expect(known?.lengthProvenance).toBe('derived');
    expect(known?.earningsPerKm).not.toBeNull();
    expect(known?.provenance).toBe('modelled');
    expect(summary.earningsCoverage).toEqual({ n: 1, of: 2 });
    expect(routes.find((r) => r.routeName === 'Lucknow - Sitapur')?.lengthProvenance).toBeNull();
  });

  it('tags every figure modelled; only a route length is ever derived', async () => {
    vi.mocked(cachedRouteProfiles).mockReturnValue(
      new Map([[LUCKNOW_KANPUR, profile(LENGTH_KM)]]),
    );
    const response = await build(world());
    expect(response.summary.provenance).toBe('modelled');
    expect(response.model.provenance).toBe('modelled');
    for (const r of response.routes) expect(r.provenance).toBe('modelled');
    const tags = JSON.stringify(response).match(/"(provenance|lengthProvenance)":"(\w+)"/g) ?? [];
    const derived = tags.filter((t) => t.includes('"derived"'));
    expect(derived).toEqual(['"lengthProvenance":"derived"']);
    expect(tags.filter((t) => t.includes('"live"') || t.includes('"reference"'))).toEqual([]);
  });

  it('carries no efficiency index value', async () => {
    const text = JSON.stringify(await build(world())).toLowerCase();
    expect(text).not.toContain('efficiency');
    expect(text).not.toContain('"index"');
    expect(text).not.toContain('simulated');
  });

  it('builds the envelope per call while reusing the body for the same rows', async () => {
    const rows = world();
    const fresh = await buildRevenueResponse(view(rows), '1', repositories);
    const stale = await buildRevenueResponse(
      view(rows, { stale: true, source: 'cache' }),
      '1',
      repositories,
    );
    expect(fresh?.stale).toBe(false);
    expect(stale?.stale).toBe(true);
    expect(stale?.source).toBe('cache');
    expect(stale?.routes).toBe(fresh?.routes);
    expect(stale?.summary).toBe(fresh?.summary);
  });

  it('rebuilds when a route profile arrives', async () => {
    const rows = world();
    const before = await buildRevenueResponse(view(rows), '1', repositories);
    vi.mocked(cachedRouteProfiles).mockReturnValue(
      new Map([[LUCKNOW_KANPUR, profile(LENGTH_KM)]]),
    );
    const { routeCatalogueRevision } = await import('@/lib/depot/routes/routeCatalogue');
    vi.mocked(routeCatalogueRevision).mockReturnValue(2);
    const after = await buildRevenueResponse(view(rows), '1', repositories);
    expect(before?.summary.earningsCoverage.n).toBe(0);
    expect(after?.summary.earningsCoverage.n).toBe(1);
    vi.mocked(routeCatalogueRevision).mockReturnValue(1);
  });

  it('keeps depots apart', async () => {
    const other = await build(world(), '2');
    expect(other.routes.map((r) => r.routeName)).toEqual(['Barabanki - Ayodhya']);
  });
});

describe('revenue route', () => {
  const snapshot = vi.fn();
  const context = (depotId: string) => ({ params: Promise.resolve({ depotId }) });
  const request = new NextRequest('http://localhost:3000/api/upsrtc/depot/1/revenue');
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    snapshot.mockReset();
    vi.mocked(getRepositories).mockReset();
    vi.mocked(requireUpsrtcAccess).mockResolvedValue(SESSION);
    vi.mocked(getRepositories).mockReturnValue({
      fleet: { snapshot },
      revenue: modelledRevenueRepository,
    } as unknown as DepotRepositories);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('answers 401 before any repository is touched', async () => {
    vi.mocked(requireUpsrtcAccess).mockResolvedValue(null);
    const response = await GET(request, context('1'));
    expect(response.status).toBe(401);
    expect(getRepositories).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('answers 400 for an invalid depot id without reading the fleet', async () => {
    const response = await GET(request, context('1; DROP'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid depot id' });
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('answers 404 for a depot that is not in the feed', async () => {
    snapshot.mockResolvedValue(view(world()));
    const response = await GET(request, context('999'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Depot not found' });
  });

  it('answers 200 with the response and no-store for a known depot', async () => {
    snapshot.mockResolvedValue(view(world()));
    const response = await GET(request, context('1'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const body = (await response.json()) as { routes: unknown[] };
    expect(body.routes).toHaveLength(2);
  });

  it('answers 503 with the fixed body and logs once when the fleet read throws', async () => {
    snapshot.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.7 token=abc'));
    const response = await GET(request, context('1'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Depot data unavailable' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('[depot:revenue-api]');
  });

  it('answers 503 and logs once when the revenue repository throws', async () => {
    snapshot.mockResolvedValue(view(world()));
    vi.mocked(getRepositories).mockReturnValue({
      fleet: { snapshot },
      revenue: { ridershipDay: vi.fn().mockRejectedValue(new Error('boom')) },
    } as unknown as DepotRepositories);
    const response = await GET(request, context('1'));
    expect(response.status).toBe(503);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
