// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { DepotBusRow } from '@/models/depotLive';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import { modelledHistoryRepository } from '@/lib/depot/repositories/modelledHistoryRepository';
import type { DepotRepositories, FleetSnapshotView } from '@/lib/depot/repositories/types';
import { fromMetres } from '@/lib/depot/infer/geo';
import { inferYards } from '@/lib/depot/infer/yard';
import { MAX_PLAUSIBLE_DELAY_MIN, summariseOutshed } from '@/lib/depot/infer/outshed';
import { BUS_EXCEPTION_CAP } from '@/lib/depot/exceptions';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildNetworkResponse } from '@/lib/depot/live/networkView';
import { buildExceptionsResponse } from '@/lib/depot/live/exceptionView';
import { buildDepotDetail } from '@/lib/depot/live/depotView';
import { GET } from '@/app/api/upsrtc/depot/[depotId]/route';

vi.mock('@/lib/depot/infer/yard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/depot/infer/yard')>();
  return { ...actual, inferYards: vi.fn(actual.inferYards) };
});

vi.mock('@/lib/auth/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/authorize')>();
  return { ...actual, requireUpsrtcAccess: vi.fn() };
});

vi.mock('@/lib/depot/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/depot/repositories')>();
  return { ...actual, getRepositories: vi.fn(actual.getRepositories) };
});

const SESSION = { project: 'upsrtc', role: 'viewer', iat: 0, exp: 0 };
const FEED_NOW = '2026-10-06T08:00:00Z';
const HOME = { lat: 26.85, lng: 80.95 };
const FAR = fromMetres({ x: 20_000, y: 0 }, HOME.lat, HOME.lng);
const at = (offsetMin: number): string =>
  new Date(Date.parse(FEED_NOW) + offsetMin * 60_000).toISOString();

function row(over: Partial<DepotBusRow> = {}): DepotBusRow {
  return {
    registrationNumber: 'UP32A0001',
    latitude: HOME.lat,
    longitude: HOME.lng,
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

/** Depot 1 parks eight buses at HOME; depot 2 parks eight at FAR and sends one visitor. */
function world(extra: readonly DepotBusRow[] = []): DepotBusRow[] {
  const home = Array.from({ length: 8 }, (_, i) => row({ registrationNumber: `A${7 - i}` }));
  const far = Array.from({ length: 8 }, (_, i) =>
    row({
      registrationNumber: `B${i}`,
      depotId: '2',
      depotName: 'Barabanki',
      latitude: FAR.lat,
      longitude: FAR.lng,
    }),
  );
  const visitor = row({ registrationNumber: 'B-VISIT', depotId: '2', depotName: 'Barabanki' });
  const homeless = row({ registrationNumber: 'U1', depotId: null, depotName: null });
  const loner = row({ registrationNumber: 'C1', depotId: '3', depotName: 'Chinhat' });
  return [...home, ...far, visitor, homeless, loner, ...extra];
}

function view(
  rows: readonly DepotBusRow[] = world(),
  over: Partial<FleetSnapshotView> = {},
): FleetSnapshotView {
  return {
    rows,
    feedNow: FEED_NOW,
    fetchedAt: '2026-10-06T08:00:05.000Z',
    source: 'live',
    stale: false,
    recordCount: rows.length,
    ...over,
  };
}

const detail = (rows: readonly DepotBusRow[], id = '1') => {
  const d = buildDepotDetail(view(rows), id);
  if (!d) throw new Error(`no depot ${id}`);
  return d;
};
const busOf = (rows: readonly DepotBusRow[], reg: string) =>
  detail(rows).buses.find((b) => b.registrationNumber === reg);

beforeEach(() => {
  resetAnalysisForTests();
  vi.mocked(inferYards).mockClear();
  vi.mocked(requireUpsrtcAccess).mockResolvedValue(SESSION);
});

describe('buildDepotDetail', () => {
  it('is null for a depot the snapshot does not know', () => {
    expect(buildDepotDetail(view(), '999')).toBeNull();
  });

  it('carries the envelope, the summary and the score from the analysis', () => {
    const v = view(world(), { source: 'cache', stale: true });
    const d = buildDepotDetail(v, '1');
    const a = analyseSnapshot(v);
    expect(d).toMatchObject({
      feedNow: FEED_NOW,
      fetchedAt: v.fetchedAt,
      source: 'cache',
      stale: true,
    });
    expect(d?.depot).toBe(a.depotsById.get('1'));
    expect(d?.score).toBe(a.scoresById.get('1'));
  });

  it("lists only the depot's buses, by state then registration", () => {
    const moving = row({
      registrationNumber: 'A9',
      speedKmph: 30,
      routeName: 'R1',
      vehicleStatus: 'live',
    });
    const dark = row({ registrationNumber: 'A0X', vehicleStatus: 'no_signal' });
    const d = detail(world([moving, dark]));
    expect(d.buses.map((b) => b.registrationNumber)).toEqual([
      'A9',
      'A0',
      'A1',
      'A2',
      'A3',
      'A4',
      'A5',
      'A6',
      'A7',
      'A0X',
    ]);
    expect(d.buses.map((b) => b.state).slice(0, 2)).toEqual(['in_service', 'standing']);
  });

  it('passes a delay through only for a plausible feed-date schedule', () => {
    const sched = { scheduledStart: at(-30), scheduledEnd: at(240) };
    const rows = world([
      row({ registrationNumber: 'D1', ...sched, delayMinutes: 12 }),
      row({ registrationNumber: 'D2', ...sched, delayMinutes: MAX_PLAUSIBLE_DELAY_MIN }),
      row({ registrationNumber: 'D3', ...sched, delayMinutes: MAX_PLAUSIBLE_DELAY_MIN + 1 }),
      row({ registrationNumber: 'D4', ...sched, delayMinutes: -(MAX_PLAUSIBLE_DELAY_MIN + 1) }),
      row({ registrationNumber: 'D5', scheduledStart: '2026-10-05T23:00:00Z', delayMinutes: 5 }),
      row({ registrationNumber: 'D6', delayMinutes: 5 }),
    ]);
    const delays = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'].map((r) => busOf(rows, r)?.delayMinutes);
    expect(delays).toEqual([12, MAX_PLAUSIBLE_DELAY_MIN, null, null, null, null]);
    expect(busOf(rows, 'D5')?.tripDate).toBe('2026-10-05');
    expect(busOf(rows, 'D1')?.tripDate).toBe('2026-10-06');
    expect(busOf(rows, 'D6')?.tripDate).toBeNull();
  });

  it('rounds GPS age to a whole minute and maps the row fields', () => {
    const rows = world([
      row({
        registrationNumber: 'G1',
        gpsTimestamp: at(-2.6),
        tamperCode: 'W',
        mainPowerOn: false,
      }),
      row({ registrationNumber: 'G2', gpsTimestamp: null }),
    ]);
    expect(busOf(rows, 'G1')).toMatchObject({
      gpsAgeMin: 3,
      location: 'in_yard',
      otherDepotId: null,
      distanceFromYardKm: 0,
      vehicleStatus: 'stationary',
      tripStatus: 'Stationary',
      tamperCode: 'W',
      mainPowerOn: false,
    });
    expect(busOf(rows, 'G2')?.gpsAgeMin).toBeNull();
  });

  it('states the yard as a derived figure with its evidence', () => {
    const d = detail(world());
    const yard = d.yard.value;
    expect(yard).not.toBeNull();
    expect(d.yard.provenance).toBe('derived');
    expect(d.yard.coverage).toEqual({ n: yard?.inCluster, of: yard?.parked });
    expect(d.yard.note).toMatch(/park/i);
    const none = detail(world(), '3');
    expect(none.yard.value).toBeNull();
    expect(none.yard.provenance).toBe('derived');
    expect(none.yard.coverage).toBeUndefined();
  });

  it('counts every location, summing to the fleet', () => {
    const d = detail(world());
    expect(d.locationMix).toEqual({ in_yard: 8, at_other_yard: 0, away: 0, unknown: 0 });
  });

  it('builds outshedding from the shared states and yards', () => {
    const rows = world([
      row({ registrationNumber: 'S1', scheduledStart: at(-30), scheduledEnd: at(240) }),
    ]);
    const a = analyseSnapshot(view(rows));
    const expected = summariseOutshed(a.rowsByDepot.get('1') ?? [], a.yards, FEED_NOW, a.stateOf);
    expect(detail(rows).outshed).toEqual(expected);
    expect(detail(rows).outshed.counts.overdue).toBe(1);
  });

  it('lists visitors standing in this yard, including homeless buses', () => {
    expect(detail(world()).visitors).toEqual([
      {
        registrationNumber: 'B-VISIT',
        homeDepotId: '2',
        homeDepotName: 'Barabanki',
        state: 'standing',
      },
      // Depot 3 has too few buses for a yard of its own, so its bus is a visitor here.
      { registrationNumber: 'C1', homeDepotId: '3', homeDepotName: 'Chinhat', state: 'standing' },
      { registrationNumber: 'U1', homeDepotId: null, homeDepotName: null, state: 'standing' },
    ]);
    expect(detail(world(), '2').visitors).toEqual([]);
  });

  it("keeps every one of the depot's bus exceptions, beyond the network cap", () => {
    const n = BUS_EXCEPTION_CAP + 20;
    const cuts = Array.from({ length: n }, (_, i) =>
      row({ registrationNumber: `P${String(i).padStart(4, '0')}`, mainPowerOn: false }),
    );
    const d = detail(world(cuts));
    expect(analyseSnapshot(view(world(cuts))).report.bus).toHaveLength(BUS_EXCEPTION_CAP);
    expect(d.exceptions.bus).toHaveLength(n);
    expect(d.exceptions.bus.every((e) => e.depotId === '1')).toBe(true);
    expect(detail(world(cuts), '2').exceptions.bus).toEqual([]);
  });

  it('runs the analysis once for all three views of one snapshot', () => {
    const v = view();
    buildNetworkResponse(v);
    buildExceptionsResponse(v);
    buildDepotDetail(v, '1');
    buildDepotDetail(v, '2');
    expect(inferYards).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/upsrtc/depot/[depotId]', () => {
  // Back to the real composition root, even when a test fails midway.
  afterEach(() => {
    vi.mocked(getRepositories).mockReset();
  });

  const call = (depotId: string) =>
    GET(new NextRequest(`http://localhost/api/upsrtc/depot/${encodeURIComponent(depotId)}`), {
      params: Promise.resolve({ depotId }),
    });
  const reposWith = (snapshot: () => Promise<FleetSnapshotView>): DepotRepositories => ({
    history: modelledHistoryRepository,
    fleet: { snapshot },
  });

  it('checks access before anything else', async () => {
    vi.mocked(requireUpsrtcAccess).mockResolvedValueOnce(null);
    vi.mocked(getRepositories).mockClear();
    expect((await call('../etc')).status).toBe(401);
    expect(getRepositories).not.toHaveBeenCalled();
  });

  it('refuses an invalid id with 400 and does no work', async () => {
    vi.mocked(getRepositories).mockClear();
    for (const bad of ['../etc', '1234567', 'abc', '', '1;drop']) {
      const res = await call(bad);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid depot id' });
    }
    expect(getRepositories).not.toHaveBeenCalled();
    expect(inferYards).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown depot', async () => {
    vi.mocked(getRepositories).mockReturnValueOnce(reposWith(async () => view()));
    const res = await call('999');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Depot not found' });
  });

  it('answers 503 without leaking the underlying error', async () => {
    // Silenced, then restored: the 503 must still leave a server-side trace.
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      vi.mocked(getRepositories).mockReturnValueOnce(
        reposWith(() => Promise.reject(new Error('socket hang up at 10.9.9.9 key=s3cret'))),
      );
      const res = await call('1');
      expect(res.status).toBe(503);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(expect.stringMatching(/^\[depot:depot-api\] /));
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: 'Depot data unavailable' });
      expect(text).not.toMatch(/socket|10\.9\.9\.9|s3cret/);
    } finally {
      errorLog.mockRestore();
    }
  });

  it('serves a known depot, including the unassigned bucket', async () => {
    vi.mocked(getRepositories).mockReturnValue(reposWith(async () => view()));
    const res = await call('1');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { depot: { id: string } }).depot.id).toBe('1');
    expect((await call('unassigned')).status).toBe(200);
  });
});
