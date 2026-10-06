// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import type { DepotRepositories } from '@/lib/depot/repositories/types';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { GET as getDistribution } from '@/app/api/upsrtc/depot/distribution/route';
import { GET as getHistory } from '@/app/api/upsrtc/depot/history/route';

vi.mock('@/lib/auth/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/authorize')>();
  return { ...actual, requireUpsrtcAccess: vi.fn() };
});

vi.mock('@/lib/depot/repositories', () => ({ getRepositories: vi.fn() }));

const SESSION = { project: 'upsrtc', role: 'viewer', iat: 0, exp: 0 };
const request = (path: string): NextRequest =>
  new NextRequest(`http://localhost:3000/api/upsrtc/depot/${path}`);

const snapshot = vi.fn();
const series = vi.fn();
const LEAKY = 'ECONNREFUSED 10.0.0.7 token=abc';
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetAnalysisForTests();
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

describe.each([
  ['distribution', getDistribution, 'distribution', 'distribution-api'],
  ['history', getHistory, 'history?metric=index&scope=network', 'history-api'],
] as const)('%s route', (_name, GET, path, logScope) => {
  it('answers 401 before touching the repositories', async () => {
    vi.mocked(requireUpsrtcAccess).mockResolvedValue(null);
    const response = await GET(request(path));
    expect(response.status).toBe(401);
    expect(getRepositories).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('answers 503 with a fixed body and logs once when the fleet read throws', async () => {
    snapshot.mockRejectedValue(new Error(LEAKY));
    const response = await GET(request(path));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Depot data unavailable' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain(`[depot:${logScope}]`);
  });
});

describe('history route query handling', () => {
  it('answers 400 for an invalid query without reading the fleet or the history', async () => {
    const response = await getHistory(request('history?metric=speed&scope=network'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid query' });
    expect(snapshot).not.toHaveBeenCalled();
    expect(series).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('answers 503 when the history repository throws', async () => {
    snapshot.mockResolvedValue({
      rows: [],
      feedNow: null,
      fetchedAt: '2026-10-06T08:00:05.000Z',
      source: 'live',
      stale: false,
      recordCount: 0,
    });
    series.mockRejectedValue(new Error(LEAKY));
    const response = await getHistory(request('history?metric=available&scope=network'));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('token');
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
