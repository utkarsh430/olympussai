// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import { modelledHistoryRepository } from '@/lib/depot/repositories/modelledHistoryRepository';
import type { DepotRepositories, FleetSnapshotView } from '@/lib/depot/repositories/types';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildExceptionsResponse } from '@/lib/depot/live/exceptionView';
import { GET } from '@/app/api/upsrtc/depot/exceptions/route';

vi.mock('@/lib/auth/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/authorize')>();
  return { ...actual, requireUpsrtcAccess: vi.fn() };
});

vi.mock('@/lib/depot/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/depot/repositories')>();
  return { ...actual, getRepositories: vi.fn(actual.getRepositories) };
});

const SESSION = { project: 'upsrtc', role: 'viewer', iat: 0, exp: 0 };
const fixtureRows = normalizeDepotRows(liveFixture).rows;

function fixtureView(over: Partial<FleetSnapshotView> = {}): FleetSnapshotView {
  return {
    rows: fixtureRows,
    feedNow: deriveFeedNow(fixtureRows),
    fetchedAt: '2026-10-06T08:00:05.000Z',
    source: 'live',
    stale: false,
    recordCount: fixtureRows.length,
    ...over,
  };
}

function reposWith(snapshot: () => Promise<FleetSnapshotView>): DepotRepositories {
  return { history: modelledHistoryRepository, fleet: { snapshot } };
}

beforeEach(() => {
  resetAnalysisForTests();
  vi.mocked(requireUpsrtcAccess).mockResolvedValue(SESSION);
});

describe('buildExceptionsResponse', () => {
  it('carries the envelope and the analysis report, nothing else', () => {
    const view = fixtureView({ source: 'cache', stale: true });
    const res = buildExceptionsResponse(view);
    expect(res).toEqual({
      feedNow: view.feedNow,
      fetchedAt: view.fetchedAt,
      source: 'cache',
      stale: true,
      report: analyseSnapshot(view).report,
    });
    expect(res.report).toBe(analyseSnapshot(view).report);
  });

  it('passes stale through per request while sharing the report built for the rows', () => {
    const fresh = buildExceptionsResponse(fixtureView({ source: 'cache', stale: false }));
    const lastGood = buildExceptionsResponse(fixtureView({ source: 'cache', stale: true }));
    expect([fresh.stale, lastGood.stale]).toEqual([false, true]);
    expect(lastGood.report).toBe(fresh.report);
  });

  it('agrees with the network counts', () => {
    const { report } = buildExceptionsResponse(fixtureView());
    const busCounted = (['long_dark', 'power_cut', 'tamper_code', 'emergency'] as const).reduce(
      (sum, kind) => sum + report.counts[kind],
      0,
    );
    expect(busCounted).toBe(report.busTotal);
    expect(report.bus.length).toBeLessThanOrEqual(report.busTotal);
  });
});

describe('GET /api/upsrtc/depot/exceptions', () => {
  const request = (): NextRequest =>
    new NextRequest('http://localhost/api/upsrtc/depot/exceptions');

  it('refuses an unauthorised caller before reading the fleet', async () => {
    vi.mocked(requireUpsrtcAccess).mockResolvedValueOnce(null);
    vi.mocked(getRepositories).mockClear();
    expect((await GET(request())).status).toBe(401);
    expect(getRepositories).not.toHaveBeenCalled();
  });

  it('answers 503 without leaking the underlying error', async () => {
    vi.mocked(getRepositories).mockReturnValueOnce(
      reposWith(() => Promise.reject(new Error('upstream 10.1.2.3 said secret-xyz'))),
    );
    const res = await GET(request());
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'Depot data unavailable' });
    expect(text).not.toMatch(/secret|10\.1\.2\.3|upstream/);
  });

  it('serves the report', async () => {
    vi.mocked(getRepositories).mockReturnValueOnce(reposWith(async () => fixtureView()));
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { report: { busTotal: number } };
    expect(body.report.busTotal).toBe(analyseSnapshot(fixtureView()).report.busTotal);
  });
});
