// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { DepotBusRow } from '@/models/depotLive';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import { modelledCrewRepository } from '@/lib/depot/repositories/modelledCrewRepository';
import { modelledFuelRepository } from '@/lib/depot/repositories/modelledFuelRepository';
import { modelledRevenueRepository } from '@/lib/depot/repositories/modelledRevenueRepository';
import { modelledHistoryRepository } from '@/lib/depot/repositories/modelledHistoryRepository';
import type { DepotRepositories, FleetSnapshotView } from '@/lib/depot/repositories/types';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import type { ParkingResponse } from '@/lib/depot/yard/parkingApi';
import { GET } from '@/app/api/upsrtc/depot/[depotId]/parking/route';

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

function row(i: number): DepotBusRow {
  return {
    registrationNumber: `A${i}`,
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
    routeName: 'ORD_1',
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
  };
}

function view(): FleetSnapshotView {
  const rows = Array.from({ length: 8 }, (_, i) => row(i));
  return {
    rows,
    feedNow: FEED_NOW,
    fetchedAt: '2026-10-06T08:00:05.000Z',
    source: 'live',
    stale: false,
    recordCount: rows.length,
  };
}

const reposWith = (snapshot: () => Promise<FleetSnapshotView>): DepotRepositories => ({
  history: modelledHistoryRepository,
  fleet: { snapshot },
  crew: modelledCrewRepository,
  fuel: modelledFuelRepository,
  revenue: modelledRevenueRepository,
});

const call = (depotId: string) =>
  GET(new NextRequest(`http://localhost/api/upsrtc/depot/${encodeURIComponent(depotId)}/parking`), {
    params: Promise.resolve({ depotId }),
  });

beforeEach(() => {
  resetAnalysisForTests();
  vi.mocked(requireUpsrtcAccess).mockResolvedValue(SESSION);
});

afterEach(() => {
  vi.mocked(getRepositories).mockReset();
});

describe('GET /api/upsrtc/depot/[depotId]/parking', () => {
  it('checks access before touching any repository', async () => {
    vi.mocked(requireUpsrtcAccess).mockResolvedValueOnce(null);
    vi.mocked(getRepositories).mockClear();
    expect((await call('1')).status).toBe(401);
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
  });

  it('answers 404 for a depot not in the feed', async () => {
    vi.mocked(getRepositories).mockReturnValueOnce(reposWith(async () => view()));
    const res = await call('999');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Depot not found' });
  });

  it('answers 503 with the fixed body and exactly one log call', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      vi.mocked(getRepositories).mockReturnValueOnce(
        reposWith(() => Promise.reject(new Error('socket hang up at 10.9.9.9 key=s3cret'))),
      );
      const res = await call('1');
      expect(res.status).toBe(503);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(expect.stringMatching(/^\[depot:depot-parking\] /));
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: 'Depot data unavailable' });
      expect(text).not.toMatch(/socket|10\.9\.9\.9|s3cret/);
    } finally {
      errorLog.mockRestore();
    }
  });

  it('serves the order for a known depot, uncached', async () => {
    vi.mocked(getRepositories).mockReturnValue(reposWith(async () => view()));
    const res = await call('1');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const body = (await res.json()) as ParkingResponse;
    expect(body.depot.id).toBe('1');
    expect(body.operatingDate).toBe('2026-10-07');
    expect(body.state).toBe('planned');
  });
});
