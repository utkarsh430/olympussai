import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { modelSeries } from '@/lib/depot/sim/history';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildTrendsResponse, parseTrendsQuery } from '@/lib/depot/live/trendsView';
import { depotTrendsUrl } from '@/hooks/useDepotTrends';
import { GET } from '@/app/api/upsrtc/depot/trends/route';

vi.mock('@/lib/auth/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/authorize')>();
  return { ...actual, requireUpsrtcAccess: vi.fn() };
});
vi.mock('@/lib/depot/repositories', () => ({ getRepositories: vi.fn() }));

const rows = normalizeDepotRows(liveFixture).rows;
const view = (over: Partial<FleetSnapshotView> = {}): FleetSnapshotView => ({
  rows,
  feedNow: deriveFeedNow(rows),
  fetchedAt: '2026-10-06T08:00:05.000Z',
  source: 'live',
  stale: false,
  recordCount: rows.length,
  ...over,
});
const history = {
  series: vi.fn(async (...args: Parameters<typeof modelSeries>) => modelSeries(...args)),
};

beforeEach(() => {
  resetAnalysisForTests();
  history.series.mockClear();
  vi.mocked(requireUpsrtcAccess).mockResolvedValue({ user: { id: 'u' } } as never);
  vi.mocked(getRepositories).mockReturnValue({
    fleet: { snapshot: async () => view() },
    history,
  } as never);
});

describe('parseTrendsQuery', () => {
  it.each([
    ['metric=index', { metric: 'index', days: 30 }],
    ['metric=available&days=7', { metric: 'available', days: 7 }],
    ['metric=darkRate&days=90', { metric: 'darkRate', days: 90 }],
  ])('accepts %s', (query, expected) => {
    expect(parseTrendsQuery(new URLSearchParams(query))).toEqual({ ok: true, query: expected });
  });

  it.each([
    '',
    'metric=speed',
    'metric=index&days=6',
    'metric=index&days=91',
    'metric=index&days=1e1',
    'metric=index&metric=index',
    'metric=index&scope=network',
    'metric=index&days=30&days=30',
  ])('refuses "%s"', (query) => {
    expect(parseTrendsQuery(new URLSearchParams(query))).toEqual({ ok: false });
  });
});

describe('buildTrendsResponse', () => {
  it('returns the network and every unit with a compact series and a trend, all MODELLED', async () => {
    const body = await buildTrendsResponse(view(), { metric: 'available', days: 30 });
    const units = analyseSnapshot(view()).depots;
    expect(body.provenance).toBe('modelled');
    expect(body.units.map((u) => u.id)).toEqual(units.map((d) => d.id));
    expect(body.network.id).toBe('network');
    for (const row of [body.network, ...body.units]) {
      expect(row.values).toHaveLength(30);
      expect(row.trend?.sentence).toMatch(/^MODELLED trend: /);
    }
    expect(JSON.stringify(body)).not.toMatch(/simulated/i);
    expect(JSON.stringify(body)).not.toMatch(/forecast|"points"/);
  });

  it('holds the body per snapshot rows and query; the envelope is per request', async () => {
    const first = await buildTrendsResponse(view(), { metric: 'index', days: 30 });
    const calls = history.series.mock.calls.length;
    const again = await buildTrendsResponse(view({ stale: true }), { metric: 'index', days: 30 });
    expect(history.series.mock.calls.length).toBe(calls);
    expect(again.units).toBe(first.units);
    expect(again.stale).toBe(true);
  });

  it('stays small: one metric for every unit over 30 days', async () => {
    const body = await buildTrendsResponse(view(), { metric: 'onRoadShare', days: 30 });
    const perUnit = JSON.stringify(body).length / (body.units.length + 1);
    expect(perUnit).toBeLessThan(700);
  });
});

describe('GET /api/upsrtc/depot/trends', () => {
  const get = (q: string): Promise<Response> =>
    GET(new NextRequest(`http://localhost:3000/api/upsrtc/depot/trends?${q}`));

  it('checks the session before anything else', async () => {
    vi.mocked(requireUpsrtcAccess).mockResolvedValue(null);
    vi.mocked(getRepositories).mockClear();
    expect((await get('metric=index')).status).toBe(401);
    expect(getRepositories).not.toHaveBeenCalled();
  });

  it('refuses a bad query with a fixed body, and never caches', async () => {
    const response = await get('metric=index&days=500');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid query' });
  });

  it('answers 200 with no-store, and 503 with a fixed body when the feed fails', async () => {
    const ok = await get('metric=index&days=14');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toContain('no-store');
    vi.mocked(getRepositories).mockReturnValue({
      fleet: { snapshot: async () => Promise.reject(new Error('token=secret host=x')) },
      history,
    } as never);
    const failed = await get('metric=index');
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: 'Depot data unavailable' });
  });

  it('builds the hook URL from the metric and window', () => {
    expect(depotTrendsUrl({ metric: 'darkRate', days: 30 })).toBe(
      '/api/upsrtc/depot/trends?metric=darkRate&days=30',
    );
    expect(depotTrendsUrl(null)).toBeNull();
  });
});
