// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { DepotBusRow } from '@/models/depotLive';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import { modelledFuelRepository } from '@/lib/depot/repositories/modelledFuelRepository';
import { modelledRevenueRepository } from '@/lib/depot/repositories/modelledRevenueRepository';
import type { DepotRepositories, FleetSnapshotView } from '@/lib/depot/repositories/types';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildFuelResponse } from '@/lib/depot/live/fuelView';
import { buildEconomicsResponse } from '@/lib/depot/live/economicsView';
import { buildRevenueResponse } from '@/lib/depot/live/revenueView';
import { cachedRouteProfiles, routeCatalogueRevision } from '@/lib/depot/routes/routeCatalogue';
import type { RouteProfile } from '@/lib/depot/routes/types';
import { GET } from '@/app/api/upsrtc/depot/economics/route';

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
const RANKED_DEPOTS = ['1', '2', '3', '4', '5', '6'];
const NO_LENGTH_DEPOT = '7';
const SMALL_DEPOT = '8';
const BUSES_PER_DEPOT = 12;
const repositories = { revenue: modelledRevenueRepository, fuel: modelledFuelRepository };

function row(over: Partial<DepotBusRow>): DepotBusRow {
  return {
    registrationNumber: 'UP32A0001',
    latitude: 26.85,
    longitude: 80.95,
    speedKmph: 35,
    ignitionOn: true,
    gpsTimestamp: FEED_NOW,
    receivedAt: FEED_NOW,
    depotId: '1',
    depotName: 'Depot 1',
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

function depotRows(id: string, count: number): DepotBusRow[] {
  return Array.from({ length: count }, (_, i) =>
    row({
      registrationNumber: `D${id}B${i}`,
      depotId: id,
      depotName: `Depot ${id}`,
      routeName: `Route ${id}${i % 2 === 0 ? 'a' : 'b'}`,
      latitude: 26 + Number(id) / 10 + i / 1000,
    }),
  );
}

function world(): DepotBusRow[] {
  return [...RANKED_DEPOTS, NO_LENGTH_DEPOT].flatMap((id) => depotRows(id, BUSES_PER_DEPOT)).concat(
    depotRows(SMALL_DEPOT, 3),
  );
}

/** Every route has a real length except depot 7's, which run on MODELLED lengths. */
function profiles(rows: readonly DepotBusRow[]): Map<string, RouteProfile> {
  const names = [...new Set(rows.flatMap((r) => (r.routeName === null ? [] : [r.routeName])))];
  return new Map(
    names
      .filter((n) => !n.startsWith(`Route ${NO_LENGTH_DEPOT}`))
      .map((n, i) => [n, { lengthKm: 40 + i * 7, scheduledDurationMin: 120 } as unknown as RouteProfile]),
  );
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

const build = async (rows: readonly DepotBusRow[] = world()) => {
  vi.mocked(cachedRouteProfiles).mockReturnValue(profiles(rows));
  return buildEconomicsResponse(view(rows), repositories);
};

const byId = (response: Awaited<ReturnType<typeof build>>, id: string) => {
  const found = response.depots.find((d) => d.depotId === id);
  if (!found) throw new Error(`no depot ${id}`);
  return found;
};

const round = (n: number, places: number): number => Math.round(n * 10 ** places) / 10 ** places;

beforeEach(() => {
  resetAnalysisForTests();
  vi.mocked(cachedRouteProfiles).mockReset();
});

describe('buildEconomicsResponse', () => {
  it('lists every unit of the feed with its summary and score', async () => {
    const response = await build();
    expect(response.depots.map((d) => d.depotId).sort()).toEqual(
      [...RANKED_DEPOTS, NO_LENGTH_DEPOT, SMALL_DEPOT].sort(),
    );
    expect(response.operatingDate).toBe('2026-10-06');
    expect(byId(response, '1')).toMatchObject({ name: 'Depot 1', kind: 'depot', fleet: 12 });
  });

  it('ranks every operating depot, real lengths or not, and says why the small one is not', async () => {
    // Ruling S39: depot 7 has no real route length (coverage 0 of 2) and is ranked all the same.
    const response = await build();
    for (const id of RANKED_DEPOTS) expect(byId(response, id).score.ranked).toBe(true);
    const noLength = byId(response, NO_LENGTH_DEPOT);
    expect(noLength.score).toMatchObject({ ranked: true, reason: 'ok', missing: [] });
    expect(noLength.lengthCoverage).toEqual({ n: 0, of: 2 });
    expect(byId(response, '1').lengthCoverage).toEqual({ n: 2, of: 2 });
    expect(byId(response, SMALL_DEPOT).score).toMatchObject({
      ranked: false,
      reason: 'fleet_too_small',
    });
  });

  it('gives ranked depots distinct ranks within their peer group', async () => {
    const response = await build();
    // Six depots with real lengths plus depot 7 on modelled ones: seven peers, ranks 1 to 7.
    const ids = [...RANKED_DEPOTS, NO_LENGTH_DEPOT];
    const ranks = ids.map((id) => byId(response, id).score.rank ?? 0).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(byId(response, '1').score.peerCount).toBe(ids.length);
  });

  it('reconciles each depot component with the revenue page and the fuel analysis', async () => {
    const rows = world();
    const response = await build(rows);
    const live = view(rows);
    const component = (id: string, key: string) =>
      byId(response, id).score.components.find((c) => c.key === key)?.value ?? null;
    for (const id of [...RANKED_DEPOTS, NO_LENGTH_DEPOT]) {
      const revenue = await buildRevenueResponse(live, id, repositories);
      expect(round(component(id, 'earningsPerKm') ?? -1, 2)).toBe(
        round(revenue?.summary.earningsPerKm ?? -2, 2),
      );
      expect(round(component(id, 'loadFactor') ?? -1, 3)).toBe(
        round(revenue?.summary.loadFactor ?? -2, 3),
      );
      // The fuel page's own response, built on the same modelled day.
      const fuel = await buildFuelResponse(live, id, modelledFuelRepository);
      expect(round(component(id, 'costPerKm') ?? -1, 2)).toBe(round(fuel?.totals.costPerKm ?? -2, 2));
    }
    expect(analyseSnapshot(live).depotsById.size).toBe(response.depots.length);
  });

  it('tags every figure modelled and carries no efficiency index value', async () => {
    const response = await build();
    const text = JSON.stringify(response);
    expect(response.provenance).toBe('modelled');
    expect(text.match(/"provenance":"(\w+)"/g)?.every((t) => t === '"provenance":"modelled"')).toBe(
      true,
    );
    expect(text).not.toContain('derived');
    expect(text.toLowerCase()).not.toContain('efficiency');
    expect(text).not.toContain('"index"');
    expect(text.toLowerCase()).not.toContain('simulated');
  });

  it('builds the envelope per call while reusing the body for the same rows', async () => {
    const rows = world();
    vi.mocked(cachedRouteProfiles).mockReturnValue(profiles(rows));
    const fresh = await buildEconomicsResponse(view(rows), repositories);
    const stale = await buildEconomicsResponse(
      view(rows, { stale: true, source: 'cache' }),
      repositories,
    );
    expect(fresh.stale).toBe(false);
    expect(stale.stale).toBe(true);
    expect(stale.source).toBe('cache');
    expect(stale.depots).toBe(fresh.depots);
  });
});

describe('the held economics body', () => {
  function counted() {
    const ridershipDay = vi.fn(modelledRevenueRepository.ridershipDay);
    const fuelDay = vi.fn(modelledFuelRepository.fuelDay);
    return { sources: { revenue: { ridershipDay }, fuel: { fuelDay } }, ridershipDay, fuelDay };
  }

  it('does no rebuild for a second request on the same rows', async () => {
    const rows = world();
    vi.mocked(cachedRouteProfiles).mockReturnValue(profiles(rows));
    const { sources, ridershipDay, fuelDay } = counted();
    const first = await buildEconomicsResponse(view(rows), sources);
    const builds = ridershipDay.mock.calls.length;
    expect(builds).toBeGreaterThan(0);
    const second = await buildEconomicsResponse(view(rows, { fetchedAt: '2026-10-06T08:00:09.000Z' }), sources);
    expect(ridershipDay.mock.calls.length).toBe(builds);
    expect(fuelDay.mock.calls.length).toBe(builds);
    expect(second.depots).toBe(first.depots);
  });

  it('rebuilds when the operating date changes', async () => {
    const rows = world();
    vi.mocked(cachedRouteProfiles).mockReturnValue(profiles(rows));
    const { sources, ridershipDay } = counted();
    await buildEconomicsResponse(view(rows), sources);
    const builds = ridershipDay.mock.calls.length;
    const next = await buildEconomicsResponse(
      view(rows, { feedNow: '2026-10-07T08:00:00Z', fetchedAt: '2026-10-07T08:00:05.000Z' }),
      sources,
    );
    expect(next.operatingDate).toBe('2026-10-07');
    expect(ridershipDay.mock.calls.length).toBeGreaterThan(builds);
  });

  it('rebuilds when the route catalogue revision changes', async () => {
    const rows = world();
    vi.mocked(cachedRouteProfiles).mockReturnValue(profiles(rows));
    const { sources, ridershipDay } = counted();
    await buildEconomicsResponse(view(rows), sources);
    const builds = ridershipDay.mock.calls.length;
    vi.mocked(routeCatalogueRevision).mockReturnValue(2);
    try {
      await buildEconomicsResponse(view(rows), sources);
    } finally {
      vi.mocked(routeCatalogueRevision).mockReturnValue(1);
    }
    expect(ridershipDay.mock.calls.length).toBeGreaterThan(builds);
  });
});

describe('economics route', () => {
  const snapshot = vi.fn();
  const request = new NextRequest('http://localhost:3000/api/upsrtc/depot/economics');
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    snapshot.mockReset();
    vi.mocked(getRepositories).mockReset();
    vi.mocked(requireUpsrtcAccess).mockResolvedValue(SESSION);
    vi.mocked(getRepositories).mockReturnValue({
      fleet: { snapshot },
      ...repositories,
    } as unknown as DepotRepositories);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('answers 401 before any repository is touched', async () => {
    vi.mocked(requireUpsrtcAccess).mockResolvedValue(null);
    const response = await GET(request);
    expect(response.status).toBe(401);
    expect(getRepositories).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('answers 200 with the response and no-store', async () => {
    const rows = world();
    vi.mocked(cachedRouteProfiles).mockReturnValue(profiles(rows));
    snapshot.mockResolvedValue(view(rows));
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const body = (await response.json()) as { depots: unknown[] };
    expect(body.depots).toHaveLength(RANKED_DEPOTS.length + 2);
  });

  it('answers 503 with the fixed body and logs once when the fleet read throws', async () => {
    snapshot.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.7 token=abc'));
    const response = await GET(request);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Depot data unavailable' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('[depot:economics-api]');
  });

  it('answers 503 and logs once when a repository throws', async () => {
    snapshot.mockResolvedValue(view(world()));
    vi.mocked(getRepositories).mockReturnValue({
      fleet: { snapshot },
      revenue: { ridershipDay: vi.fn().mockRejectedValue(new Error('boom')) },
      fuel: modelledFuelRepository,
    } as unknown as DepotRepositories);
    const response = await GET(request);
    expect(response.status).toBe(503);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
