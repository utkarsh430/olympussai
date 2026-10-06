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
import {
  buildExceptionsResponse,
  buildPagedExceptionsResponse,
} from '@/lib/depot/live/exceptionView';
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
  it('carries the envelope, the report without the capped list, and the first page', () => {
    const view = fixtureView({ source: 'cache', stale: true });
    const res = buildExceptionsResponse(view);
    const { report } = analyseSnapshot(view);
    expect(res).toMatchObject({
      feedNow: view.feedNow,
      fetchedAt: view.fetchedAt,
      source: 'cache',
      stale: true,
      report: { depot: report.depot, busTotal: report.busTotal, counts: report.counts },
      busPage: { kind: null, depotId: null, offset: 0, limit: 25, total: report.busTotal },
    });
    expect('bus' in res.report).toBe(false);
    expect(res.busPage.items.length).toBe(Math.min(25, report.busTotal));
  });

  it('passes stale through per request while sharing the list built for the rows', () => {
    const fresh = buildExceptionsResponse(fixtureView({ source: 'cache', stale: false }));
    const lastGood = buildExceptionsResponse(fixtureView({ source: 'cache', stale: true }));
    expect([fresh.stale, lastGood.stale]).toEqual([false, true]);
    expect(lastGood.report.depot).toBe(fresh.report.depot);
    expect(lastGood.busPage.items[0]).toBe(fresh.busPage.items[0]);
  });

  it('agrees with the network counts', () => {
    const { report, busSeverityCounts } = buildExceptionsResponse(fixtureView());
    const severityTotal =
      busSeverityCounts.critical + busSeverityCounts.warning + busSeverityCounts.info;
    expect(severityTotal).toBe(report.busTotal);
  });

  it('pages one kind with its true total, beyond the old 500-row cap', () => {
    const view = fixtureView();
    const { report } = analyseSnapshot(view);
    for (const kind of ['long_dark', 'power_cut', 'tamper_code', 'emergency'] as const) {
      const page = buildPagedExceptionsResponse(view, {
        kind,
        depotId: null,
        offset: 0,
        limit: 100,
      }).busPage;
      expect(page.total).toBe(report.counts[kind]);
      expect(page.items.every((row) => row.kind === kind)).toBe(true);
    }
    const last = buildPagedExceptionsResponse(view, {
      kind: null,
      depotId: null,
      offset: Math.max(0, report.busTotal - 1),
      limit: 100,
    }).busPage;
    expect(last.items.length).toBe(report.busTotal > 0 ? 1 : 0);
  });
});

describe('GET /api/upsrtc/depot/exceptions', () => {
  const request = (query = ''): NextRequest =>
    new NextRequest(`http://localhost/api/upsrtc/depot/exceptions${query}`);

  it('refuses an unauthorised caller before reading the fleet', async () => {
    vi.mocked(requireUpsrtcAccess).mockResolvedValueOnce(null);
    vi.mocked(getRepositories).mockClear();
    expect((await GET(request())).status).toBe(401);
    expect(getRepositories).not.toHaveBeenCalled();
  });

  it('answers 503 without leaking the underlying error', async () => {
    // Silenced, then restored: the 503 must still leave a server-side trace.
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      vi.mocked(getRepositories).mockReturnValueOnce(
        reposWith(() => Promise.reject(new Error('upstream 10.1.2.3 said secret-xyz'))),
      );
      const res = await GET(request());
      expect(res.status).toBe(503);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(expect.stringMatching(/^\[depot:exceptions-api\] /));
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: 'Depot data unavailable' });
      expect(text).not.toMatch(/secret|10\.1\.2\.3|upstream/);
    } finally {
      errorLog.mockRestore();
    }
  });

  it('serves the report', async () => {
    vi.mocked(getRepositories).mockReturnValueOnce(reposWith(async () => fixtureView()));
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { report: { busTotal: number } };
    expect(body.report.busTotal).toBe(analyseSnapshot(fixtureView()).report.busTotal);
  });

  it.each(['?limit=101', '?offset=-5', '?kind=dark_share_high', '?depotId=x;y', '?page=2'])(
    'answers 400 with the fixed body for %s, before reading the fleet',
    async (query) => {
      vi.mocked(getRepositories).mockClear();
      const res = await GET(request(query));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid query' });
      expect(getRepositories).not.toHaveBeenCalled();
    },
  );

  it('refuses an unauthorised caller before validating the query', async () => {
    vi.mocked(requireUpsrtcAccess).mockResolvedValueOnce(null);
    expect((await GET(request('?limit=999'))).status).toBe(401);
  });

  it('serves the page asked for with the true total for its filter', async () => {
    vi.mocked(getRepositories).mockReturnValueOnce(reposWith(async () => fixtureView()));
    const res = await GET(request('?kind=long_dark&offset=0&limit=10'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      busPage: { total: number; limit: number; items: { kind: string }[] };
    };
    const { report } = analyseSnapshot(fixtureView());
    expect(body.busPage.total).toBe(report.counts.long_dark);
    expect(body.busPage.limit).toBe(10);
    expect(body.busPage.items.length).toBe(Math.min(10, report.counts.long_dark));
    expect(body.busPage.items.every((row) => row.kind === 'long_dark')).toBe(true);
  });
});
