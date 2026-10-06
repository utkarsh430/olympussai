// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import type { LiveSnapshotResult } from '@/lib/upsrtc/liveSnapshot';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import type { DepotRepositories, FleetSnapshotView } from '@/lib/depot/repositories/types';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildNetworkResponse } from '@/lib/depot/live/networkView';
import { GET } from '@/app/api/upsrtc/depot/network/route';
import { modelSeries } from '@/lib/depot/sim/history';
import { createLiveFleetRepository } from '@/lib/depot/repositories/liveFleetRepository';
import { modelledHistoryRepository } from '@/lib/depot/repositories/modelledHistoryRepository';
import { getRepositories } from '@/lib/depot/repositories';

vi.mock('@/lib/auth/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/authorize')>();
  return { ...actual, requireUpsrtcAccess: vi.fn() };
});

vi.mock('@/lib/depot/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/depot/repositories')>();
  return { ...actual, getRepositories: vi.fn(actual.getRepositories) };
});

const FEED_NOW = '2026-10-06T08:00:00Z';
const SESSION = { project: 'upsrtc', role: 'viewer', iat: 0, exp: 0 };
const fixtureRows = normalizeDepotRows(liveFixture).rows;

function fixtureView(over: Partial<FleetSnapshotView> = {}): FleetSnapshotView {
  return {
    rows: fixtureRows,
    feedNow: deriveFeedNow(fixtureRows),
    fetchedAt: '2026-10-06T08:00:05.000Z',
    source: 'live',
    stale: false,
    recordCount: 412,
    ...over,
  };
}

/** The real composition root with its fleet read replaced. */
function reposWith(snapshot: () => Promise<FleetSnapshotView>): DepotRepositories {
  return { history: modelledHistoryRepository, fleet: { snapshot } };
}

/** A fleet read failing with a message that must never reach a client. */
const leakyFailure = (): Promise<FleetSnapshotView> =>
  Promise.reject(new Error('ECONNREFUSED 10.0.0.7 token=abc'));

beforeEach(() => {
  resetAnalysisForTests();
  vi.mocked(requireUpsrtcAccess).mockResolvedValue(SESSION);
});

describe('depot repositories', () => {
  it('adapts the live snapshot to a fleet view without copying rows', async () => {
    const depotRows = [] as LiveSnapshotResult['snapshot']['depotRows'];
    const result: LiveSnapshotResult = {
      snapshot: {
        buses: [],
        depotRows,
        recordCount: 7,
        rejectedRecordCount: 1,
        fetchedAt: '2026-10-06T08:00:05.000Z',
        feedNow: FEED_NOW,
      },
      source: 'cache',
      stale: true,
    };
    const view = await createLiveFleetRepository(async () => result).snapshot();
    expect(view).toEqual({
      rows: depotRows,
      feedNow: FEED_NOW,
      fetchedAt: '2026-10-06T08:00:05.000Z',
      source: 'cache',
      stale: true,
      recordCount: 7,
    });
    expect(view.rows).toBe(depotRows);
  });

  it('serves the modelled history series', async () => {
    const anchor = { date: '2026-10-06', value: 0.6 };
    const scope = { kind: 'network' } as const;
    const series = await modelledHistoryRepository.series('onRoadShare', scope, 30, anchor);
    expect(series).toEqual(modelSeries('onRoadShare', scope, 30, anchor));
  });

  it('has one composition root', () => {
    const repos = getRepositories();
    expect(getRepositories()).toBe(repos);
    expect(repos.history).toBe(modelledHistoryRepository);
    expect(typeof repos.fleet.snapshot).toBe('function');
  });
});

describe('buildNetworkResponse', () => {
  it('passes the envelope and record count through', () => {
    const view = fixtureView({ source: 'fixture', stale: true });
    const res = buildNetworkResponse(view);
    expect(res).toMatchObject({
      feedNow: view.feedNow,
      fetchedAt: view.fetchedAt,
      source: 'fixture',
      stale: true,
      recordCount: 412,
    });
  });

  it('serves depots, KPIs, coverage, scores and exception counts from the analysis', () => {
    const view = fixtureView();
    const res = buildNetworkResponse(view);
    const analysis = analyseSnapshot(view);
    expect(res.depots).toBe(analysis.depots);
    expect(res.scores).toBe(analysis.scores);
    expect(res.exceptionCounts).toBe(analysis.report.counts);
    expect(res.kpis.fleet.value).toBe(fixtureRows.length);
    expect(res.coverage.every((c) => c.of === fixtureRows.length)).toBe(true);
    expect(Object.keys(res).sort()).toEqual([
      'coverage', 'depots', 'exceptionCounts', 'feedNow', 'fetchedAt', 'kpis', 'recordCount',
      'scores', 'source', 'stale',
    ]);
  });

  it('returns the same object for the same fetchedAt and source', () => {
    const first = buildNetworkResponse(fixtureView());
    expect(buildNetworkResponse(fixtureView())).toBe(first);
    const later = buildNetworkResponse(fixtureView({ fetchedAt: '2026-10-06T08:00:20.000Z' }));
    expect(later).not.toBe(first);
    const cached = buildNetworkResponse(
      fixtureView({ fetchedAt: '2026-10-06T08:00:20.000Z', source: 'cache' }),
    );
    expect(cached).not.toBe(later);
  });
});

describe('GET /api/upsrtc/depot/network', () => {
  const request = (): NextRequest => new NextRequest('http://localhost/api/upsrtc/depot/network');

  it('refuses an unauthorised caller before reading the fleet', async () => {
    vi.mocked(requireUpsrtcAccess).mockResolvedValueOnce(null);
    vi.mocked(getRepositories).mockClear();
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(getRepositories).not.toHaveBeenCalled();
  });

  it('answers 503 without leaking the underlying error', async () => {
    vi.mocked(getRepositories).mockReturnValueOnce(reposWith(leakyFailure));
    const res = await GET(request());
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'Depot data unavailable' });
    expect(text).not.toMatch(/ECONNREFUSED|token|10\.0\.0\.7/);
  });

  it('serves the network view of the repository snapshot', async () => {
    vi.mocked(getRepositories).mockReturnValueOnce(reposWith(async () => fixtureView()));
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { depots: unknown[]; recordCount: number };
    expect(body.recordCount).toBe(412);
    expect(body.depots).toHaveLength(113);
  });
});
