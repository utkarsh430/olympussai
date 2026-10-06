// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { DepotBusRow } from '@/models/depotLive';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import type { DepotRepositories, FleetSnapshotView } from '@/lib/depot/repositories/types';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildMaintenanceResponse } from '@/lib/depot/live/maintenanceView';
import { buildDepotDetail } from '@/lib/depot/live/depotView';
import { DUE_SOON_WITHIN_KM } from '@/lib/depot/maintenance/config';
import { offRoadBusesFrom } from '@/lib/depot/maintenance/offRoad';
import { GET } from '@/app/api/upsrtc/depot/[depotId]/maintenance/route';

vi.mock('@/lib/auth/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/authorize')>();
  return { ...actual, requireUpsrtcAccess: vi.fn() };
});

vi.mock('@/lib/depot/repositories', () => ({ getRepositories: vi.fn() }));

const SESSION = { project: 'upsrtc', role: 'viewer', iat: 0, exp: 0 };
const FEED_NOW = '2026-10-06T08:00:00Z';
const SILENT = '2026-10-06T07:30:00Z';

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

/** Depot 1: ten buses, three under maintenance (one with a power fault), four with a distance. */
function world(): DepotBusRow[] {
  const ok = Array.from({ length: 7 }, (_, i) =>
    row({ registrationNumber: `A${i}`, odometerRaw: i < 3 ? 1000 + i : null }),
  );
  const down = [
    row({ registrationNumber: 'M1', vehicleStatus: 'under_maintenance', gpsTimestamp: SILENT }),
    row({ registrationNumber: 'M2', vehicleStatus: 'under_maintenance', odometerRaw: 55 }),
    row({
      registrationNumber: 'M3',
      vehicleStatus: 'under_maintenance',
      mainPowerOn: false,
      tamperCode: 'W',
    }),
  ];
  const other = row({ registrationNumber: 'B1', depotId: '2', depotName: 'Barabanki' });
  return [...ok, ...down, other];
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

/** The live list the page reads from the depot detail the scope layout already polls. */
const liveOffRoad = (rows: readonly DepotBusRow[], id = '1') => {
  const detail = buildDepotDetail(view(rows), id);
  if (!detail) throw new Error(`no depot ${id}`);
  return offRoadBusesFrom(detail.buses);
};

const build = (rows: readonly DepotBusRow[], id = '1') => {
  const response = buildMaintenanceResponse(view(rows), id);
  if (!response) throw new Error(`no depot ${id}`);
  return response;
};

beforeEach(() => {
  resetAnalysisForTests();
});

describe('buildMaintenanceResponse', () => {
  it('is null for a depot the snapshot does not know', () => {
    expect(buildMaintenanceResponse(view(world()), '999')).toBeNull();
  });

  it('lists exactly the buses the depot summary counts as off the road', () => {
    const rows = world();
    const summary = analyseSnapshot(view(rows)).depotsById.get('1');
    const response = build(rows);
    const buses = liveOffRoad(rows);
    expect(buses).toHaveLength(summary?.states.offRoad ?? -1);
    expect(buses.map((b) => b.registrationNumber).sort()).toEqual(['M1', 'M2', 'M3']);
    expect(response.workshop.load.offRoad).toBe(buses.length);
    expect('offRoad' in response).toBe(false);
  });

  it('carries the feed words, the silence and the device flags of each off-road bus', () => {
    const buses = liveOffRoad(world());
    const m1 = buses.find((b) => b.registrationNumber === 'M1');
    expect(m1).toMatchObject({ vehicleStatus: 'under_maintenance', tripStatus: 'Stationary' });
    expect(m1?.gpsAgeMin).toBe(30);
    expect(buses.find((b) => b.registrationNumber === 'M3')?.flags).toEqual([
      'Main power off',
      'Tamper code W',
    ]);
  });

  it('counts how many of the depot buses carry the feed distance, as a live figure', () => {
    const { distanceCoverage } = build(world());
    expect(distanceCoverage.provenance).toBe('live');
    expect(distanceCoverage.coverage).toEqual({ n: 4, of: 10 });
  });

  it('tags the preventive view and the workshop MODELLED and the off-road list LIVE', () => {
    const response = build(world());
    expect(response.preventive.provenance).toBe('modelled');
    expect(response.workshop.provenance).toBe('modelled');
    expect(response.workshop.offRoadProvenance).toBe('live');
    expect(response.preventive.dueSoonWithinKm).toBe(DUE_SOON_WITHIN_KM);
  });

  it('sends only the buses that need attention, most urgent first, and counts for all', () => {
    const response = build(world());
    const { counts, buses } = response.preventive;
    expect(counts.overdue + counts.due_soon + counts.not_due).toBe(10);
    expect(buses).toHaveLength(counts.overdue + counts.due_soon);
    expect(buses.every((b) => b.group === 'overdue' || b.group === 'due_soon')).toBe(true);
    expect(buses.filter((b) => b.group === 'overdue')).toHaveLength(counts.overdue);
    const kms = buses.map((b) => b.kmToNextService);
    expect(kms).toEqual([...kms].sort((a, b) => a - b));
  });

  it('never models from the feed distance', () => {
    const withDistance = build(world()).preventive;
    const without = build(world().map((r) => ({ ...r, odometerRaw: null }))).preventive;
    expect(withDistance).toEqual(without);
  });

  it('builds the envelope per call while reusing the body for the same rows', () => {
    const rows = world();
    const fresh = buildMaintenanceResponse(view(rows), '1');
    const stale = buildMaintenanceResponse(view(rows, { stale: true, source: 'cache' }), '1');
    expect(fresh?.stale).toBe(false);
    expect(stale?.stale).toBe(true);
    expect(stale?.source).toBe('cache');
    expect(stale?.preventive).toBe(fresh?.preventive);
    expect(stale?.workshop).toBe(fresh?.workshop);
  });

  it('keeps depots apart and reports a depot with nothing off the road as an empty list', () => {
    const other = build(world(), '2');
    expect(liveOffRoad(world(), '2')).toEqual([]);
    expect(other.preventive.counts.overdue + other.preventive.counts.due_soon).toBe(
      other.preventive.buses.length,
    );
    expect(other.workshop.load.queue).toBe(0);
  });
});

describe('maintenance route', () => {
  const snapshot = vi.fn();
  const context = (depotId: string) => ({ params: Promise.resolve({ depotId }) });
  const request = new NextRequest('http://localhost:3000/api/upsrtc/depot/1/maintenance');
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    snapshot.mockReset();
    vi.mocked(getRepositories).mockReset();
    vi.mocked(requireUpsrtcAccess).mockResolvedValue(SESSION);
    vi.mocked(getRepositories).mockReturnValue({ fleet: { snapshot } } as unknown as DepotRepositories);
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
    const body = (await response.json()) as { workshop: { load: { offRoad: number } } };
    expect(body.workshop.load.offRoad).toBe(3);
  });

  it('answers 503 with the fixed body and logs once when the fleet read throws', async () => {
    snapshot.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.7 token=abc'));
    const response = await GET(request, context('1'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Depot data unavailable' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('[depot:maintenance-api]');
  });
});
