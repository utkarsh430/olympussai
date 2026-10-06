// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import type { DepotRepositories } from '@/lib/depot/repositories/types';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { GET } from '@/app/api/upsrtc/depot/forecast/route';

vi.mock('@/lib/auth/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/authorize')>();
  return { ...actual, requireUpsrtcAccess: vi.fn() };
});

vi.mock('@/lib/depot/repositories', () => ({ getRepositories: vi.fn() }));

const SESSION = { project: 'upsrtc', role: 'viewer', iat: 0, exp: 0 };
const request = (query: string): NextRequest =>
  new NextRequest(`http://localhost:3000/api/upsrtc/depot/forecast?${query}`);
const EMPTY_VIEW = {
  rows: [],
  feedNow: null,
  fetchedAt: '2026-10-06T08:00:05.000Z',
  source: 'live',
  stale: false,
  recordCount: 0,
};

const snapshot = vi.fn();
const series = vi.fn();
const LEAKY = 'ECONNREFUSED 10.0.0.7 token=abc';
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetAnalysisForTests();
  vi.mocked(getRepositories).mockReset();
  snapshot.mockReset();
  series.mockReset();
  vi.mocked(requireUpsrtcAccess).mockResolvedValue(SESSION);
  vi.mocked(getRepositories).mockReturnValue({
    fleet: { snapshot },
    history: { series },
  } as unknown as DepotRepositories);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('forecast route', () => {
  it('answers 401 before touching the repositories', async () => {
    vi.mocked(requireUpsrtcAccess).mockResolvedValue(null);
    const response = await GET(request('metric=index&scope=network'));
    expect(response.status).toBe(401);
    expect(getRepositories).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it.each([
    'metric=index&scope=network&horizon=6',
    'metric=index&scope=network&horizon=29',
    'metric=index&scope=network&horizon=14.0',
    'metric=index&scope=network&horizon=14&horizon=14',
    'metric=index&scope=network&scope=network',
    'metric=index&scope=network&extra=1',
    'metric=speed&scope=network',
    'metric=index&scope=depot&depotId=../1',
  ])('answers 400 for %s without reading anything', async (query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid query' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(snapshot).not.toHaveBeenCalled();
    expect(series).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('answers 404 for a depot not in the feed', async () => {
    snapshot.mockResolvedValue(EMPTY_VIEW);
    const response = await GET(request('metric=index&scope=depot&depotId=4321'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Depot not found' });
    expect(series).not.toHaveBeenCalled();
  });

  it('answers 503 with a fixed body and one log line when the fleet read throws', async () => {
    snapshot.mockRejectedValue(new Error(LEAKY));
    const response = await GET(request('metric=index&scope=network'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Depot data unavailable' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('[depot:forecast-api]');
  });

  it('answers 503 when the history repository throws', async () => {
    snapshot.mockResolvedValue(EMPTY_VIEW);
    series.mockRejectedValue(new Error(LEAKY));
    const response = await GET(request('metric=available&scope=network'));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('token');
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('answers 200, uncached, with the series it used', async () => {
    snapshot.mockResolvedValue(EMPTY_VIEW);
    series.mockImplementation(async (_m: unknown, _s: unknown, days: number) =>
      Array.from({ length: days }, (_, i) => ({
        date: new Date(Date.UTC(2026, 6, 1) + i * 86_400_000).toISOString().slice(0, 10),
        value: 100 + (i % 7),
      })),
    );
    const response = await GET(request('metric=available&scope=network&days=60&horizon=7'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(series).toHaveBeenCalledTimes(1);
    expect(series.mock.calls[0]?.[2]).toBe(60);
    expect(body.history.series).toHaveLength(60);
    expect(body.horizonDays).toBe(7);
    expect(body.forecast.result.status).toBe('ok');
    expect(body.forecast.result.forecast.points).toHaveLength(7);
    expect(body.metric.range).toEqual({ min: 0, max: null });
  });
});
