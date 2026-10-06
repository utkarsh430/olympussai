// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { DepotBusRow } from '@/models/depotLive';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import type { DepotRepositories, FleetSnapshotView } from '@/lib/depot/repositories/types';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildFuelResponse } from '@/lib/depot/live/fuelView';
import { analyseFuel } from '@/lib/depot/fuel/analysis';
import { FUEL_FLAGGED_CAP, FUEL_ROUTE_CAP } from '@/lib/depot/fuel/api';
import { DEFAULT_PRICE_PER_LITRE, FUEL_VARIANCE_FLAG_PCT, MIN_PEERS } from '@/lib/depot/fuel/types';
import type { BusFuelDay, FuelRepository } from '@/lib/depot/fuel/types';
import { GET } from '@/app/api/upsrtc/depot/[depotId]/fuel/route';

vi.mock('@/lib/auth/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/authorize')>();
  return { ...actual, requireUpsrtcAccess: vi.fn() };
});
vi.mock('@/lib/depot/repositories', () => ({ getRepositories: vi.fn() }));

const SESSION = { project: 'upsrtc', role: 'viewer', iat: 0, exp: 0 };
const FEED_NOW = '2026-10-06T08:00:00Z';

function row(over: Partial<DepotBusRow> = {}): DepotBusRow {
  return {
    registrationNumber: 'UP32A0001',
    latitude: 26.85,
    longitude: 80.95,
    speedKmph: 0,
    ignitionOn: false,
    gpsTimestamp: FEED_NOW,
    receivedAt: FEED_NOW,
    depotId: '1',
    depotName: 'Alambagh',
    vehicleStatus: 'stationary',
    tripStatus: 'Stationary',
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

const world = (): DepotBusRow[] => [
  ...['A1', 'A2', 'A3', 'A4'].map((r) => row({ registrationNumber: r })),
  row({ registrationNumber: 'B1', depotId: '2', depotName: 'Barabanki' }),
];

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

const day = (reg: string, kmpl: number | null, route: string | null = 'R1'): BusFuelDay => ({
  registrationNumber: reg,
  distanceKm: kmpl === null ? 0 : 300,
  fuelLitres: kmpl === null ? 0 : Math.round((300 / kmpl) * 10) / 10,
  serviceClass: 'ordinary',
  routeName: route,
});

/** A1..A3 on one route at 5, 5, 3 km/L (A3 stands out); A4 has no distance. */
const baseDays = (): BusFuelDay[] => [day('A1', 5), day('A2', 5), day('A3', 3), day('A4', null)];

const stub = (days: () => BusFuelDay[]) => {
  const fuelDay = vi.fn(async () => days());
  return { repo: { fuelDay } satisfies FuelRepository, fuelDay };
};

const build = async (days: () => BusFuelDay[] = baseDays, id = '1') => {
  const { repo } = stub(days);
  const response = await buildFuelResponse(view(world()), id, repo);
  if (!response) throw new Error(`no depot ${id}`);
  return response;
};

beforeEach(() => {
  resetAnalysisForTests();
});

describe('buildFuelResponse', () => {
  it('is null for a depot the snapshot does not know', async () => {
    expect(await buildFuelResponse(view(world()), '999', stub(baseDays).repo)).toBeNull();
  });

  it('asks the repository for this depot buses on the feed operating date', async () => {
    const { repo, fuelDay } = stub(baseDays);
    await buildFuelResponse(view(world()), '1', repo);
    const [buses, date] = fuelDay.mock.calls[0] as unknown as [{ registrationNumber: string }[], string];
    expect(date).toBe('2026-10-06');
    expect(buses.map((b) => b.registrationNumber).sort()).toEqual(['A1', 'A2', 'A3', 'A4']);
  });

  it('reconciles its totals, classes and routes with the analysis', async () => {
    const response = await build();
    const analysis = analyseFuel(baseDays());
    expect(response.totals).toEqual(analysis.depot);
    expect(response.perClass).toEqual(analysis.perClass);
    expect(response.perRoute).toEqual(analysis.perRoute);
    expect(response.pricePerLitre).toBe(analysis.pricePerLitre);
    // The view supplies no price, so the planning price is the default and says so.
    expect(response.priceDefaulted).toBe(true);
    expect(response.pricePerLitre).toBe(DEFAULT_PRICE_PER_LITRE);
    expect(response.provenance).toBe('modelled');
    expect(response.operatingDate).toBe('2026-10-06');
  });

  it('lists the flagged bus with its figure and its peers median, and counts the rest', async () => {
    const response = await build();
    expect(response.flaggedTotal).toBe(1);
    expect(response.peersDifferCount).toBe(0);
    expect(response.flagged[0]).toMatchObject({
      registrationNumber: 'A3',
      kmPerLitre: 3,
      peerMedianKmPerLitre: 5,
      comparison: 'route',
    });
    expect(response.flagged[0]?.statement).toContain('more fuel per kilometre than similar buses');
    expect(response.noDistanceCount).toBe(1);
    expect(response.rule).toEqual({ thresholdPct: FUEL_VARIANCE_FLAG_PCT, minPeers: MIN_PEERS });
  });

  it('shows the exact peers median, not one derived from the rounded variance', async () => {
    const litres = (reg: string, fuelLitres: number): BusFuelDay => ({
      registrationNumber: reg,
      distanceKm: 300,
      fuelLitres,
      serviceClass: 'ordinary',
      routeName: 'R1',
    });
    const response = await build(() => [litres('A1', 48), litres('A2', 48), litres('A3', 70)]);
    // Peers 6.25 km/L. Reading it back from 45.8% on 4.2857 gives 6.2486, shown as 6.2.
    expect(response.flagged[0]?.peerMedianKmPerLitre).toBe(6.3);
  });

  it('counts buses above the threshold whose peers differ too much, and lists none', async () => {
    const response = await build(() => [day('A1', 4), day('A2', 4), day('A3', 8)]);
    expect(response.flaggedTotal).toBe(0);
    expect(response.peersDifferCount).toBe(2);
    expect(response.noComparisonCount).toBe(0);
  });

  it('counts buses above the threshold whose peers differ too much, and lists none', async () => {
    const response = await build(() => [day('A1', 4), day('A2', 4), day('A3', 8)]);
    expect(response.flaggedTotal).toBe(0);
    expect(response.peersDifferCount).toBe(2);
    expect(response.noComparisonCount).toBe(0);
  });

  it('counts buses with distance but no comparison', async () => {
    const response = await build(() => [day('A1', 5), day('A2', 4, 'R2')]);
    expect(response.noComparisonCount).toBe(2);
    expect(response.flaggedTotal).toBe(0);
  });

  it('caps the flagged list and the route list but reports the true counts', async () => {
    const many = (): BusFuelDay[] =>
      Array.from({ length: FUEL_FLAGGED_CAP + 5 }, (_, i) => [
        day(`F${i}a`, 5, `RT${i}`),
        day(`F${i}b`, 5, `RT${i}`),
        day(`F${i}c`, 3, `RT${i}`),
      ]).flat();
    const response = await build(many);
    expect(response.flagged).toHaveLength(FUEL_FLAGGED_CAP);
    expect(response.flaggedTotal).toBe(FUEL_FLAGGED_CAP + 5);
    const routes = await build(() =>
      Array.from({ length: FUEL_ROUTE_CAP + 7 }, (_, i) => day(`Q${i}`, 5, `RT${i}`)),
    );
    expect(routes.perRoute).toHaveLength(FUEL_ROUTE_CAP);
    expect(routes.routeTotal).toBe(FUEL_ROUTE_CAP + 7);
    expect(JSON.stringify(routes)).not.toContain('perBus');
  });

  it('builds the envelope per call while reusing the body for the same rows', async () => {
    const rows = world();
    const { repo, fuelDay } = stub(baseDays);
    const fresh = await buildFuelResponse(view(rows), '1', repo);
    const stale = await buildFuelResponse(view(rows, { stale: true, source: 'cache' }), '1', repo);
    expect(fresh?.stale).toBe(false);
    expect(stale?.stale).toBe(true);
    expect(stale?.source).toBe('cache');
    expect(stale?.flagged).toBe(fresh?.flagged);
    expect(stale?.totals).toBe(fresh?.totals);
    expect(fuelDay).toHaveBeenCalledTimes(1);
  });

  it('does not hold a failed read', async () => {
    const rows = world();
    const fuelDay = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(baseDays());
    const repo: FuelRepository = { fuelDay };
    await expect(buildFuelResponse(view(rows), '1', repo)).rejects.toThrow('boom');
    expect((await buildFuelResponse(view(rows), '1', repo))?.flaggedTotal).toBe(1);
  });

  it('never carries a person, a cause or misconduct in the serialised response', async () => {
    const text = JSON.stringify(await build());
    expect(text).not.toMatch(/theft|pilfer|misuse|driver|conductor|driving|engine|tyre|traffic|\bload\b|simulated/i);
  });
});

describe('fuel route', () => {
  const snapshot = vi.fn();
  const fuelDay = vi.fn();
  const context = (depotId: string) => ({ params: Promise.resolve({ depotId }) });
  const request = new NextRequest('http://localhost:3000/api/upsrtc/depot/1/fuel');
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    snapshot.mockReset();
    fuelDay.mockReset().mockResolvedValue(baseDays());
    vi.mocked(getRepositories).mockReset();
    vi.mocked(requireUpsrtcAccess).mockResolvedValue(SESSION);
    vi.mocked(getRepositories).mockReturnValue({
      fleet: { snapshot },
      fuel: { fuelDay },
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
    expect(fuelDay).not.toHaveBeenCalled();
  });

  it('answers 200 with the response and no-store for a known depot', async () => {
    snapshot.mockResolvedValue(view(world()));
    const response = await GET(request, context('1'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const body = (await response.json()) as { flaggedTotal: number };
    expect(body.flaggedTotal).toBe(1);
  });

  it('answers 503 with the fixed body and logs once when a read throws', async () => {
    snapshot.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.7 token=abc'));
    const response = await GET(request, context('1'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Depot data unavailable' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('[depot:fuel-api]');
  });

  it('answers 503 too when the fuel read throws', async () => {
    snapshot.mockResolvedValue(view(world()));
    fuelDay.mockRejectedValue(new Error('fuel down'));
    const response = await GET(request, context('1'));
    expect(response.status).toBe(503);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
