// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import type { SessionClaims } from '@/lib/auth/session';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { getRepositories, getServiceRepositories } from '@/lib/depot/repositories';
import type { DepotRepositories, FleetSnapshotView } from '@/lib/depot/repositories/types';
import { getLiveSnapshot, type LiveSnapshotResult } from '@/lib/upsrtc/liveSnapshot';
import { getCopilotRuntime } from '@/lib/depot/copilot/service/runtime';
import { modelledCrewRepository } from '@/lib/depot/repositories/modelledCrewRepository';
import { modelledFuelRepository } from '@/lib/depot/repositories/modelledFuelRepository';
import { modelledHistoryRepository } from '@/lib/depot/repositories/modelledHistoryRepository';
import { modelledRevenueRepository } from '@/lib/depot/repositories/modelledRevenueRepository';
import { getRouteProfile } from '@/lib/depot/routes/routeCatalogue';
import { fetchUpstream } from '@/lib/upsrtc/client';
import { fetchBusSchedule } from '@/lib/upsrtc/scheduleService';
import { filesUnder, ROOT } from './depot-guard-source';
import { GUARD_FEED_NOW, guardServiceRepositories, guardView } from './depot-guard-fixtures';

/*
 * Every depot API route, found by walking the folder, so a route added later
 * joins every row below without anyone editing this file. For each exported
 * method: no session answers the fixed 401 before any data is read; every
 * answer, success or error, carries `Cache-Control: no-store`; an error never
 * carries the thrown message; and a malformed id or query answers a fixed 400
 * that reflects nothing from the request.
 */

vi.mock('@/lib/auth/authorize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/authorize')>()),
  requireUpsrtcAccess: vi.fn(),
}));
vi.mock('@/lib/depot/repositories', () => ({
  getRepositories: vi.fn(),
  getServiceRepositories: vi.fn(),
}));
vi.mock('@/lib/upsrtc/liveSnapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/upsrtc/liveSnapshot')>()),
  getLiveSnapshot: vi.fn(),
}));
vi.mock('@/lib/depot/copilot/service/runtime', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/depot/copilot/service/runtime')>();
  return { ...real, getCopilotRuntime: vi.fn(real.getCopilotRuntime) };
});
// The upstream paths are watched (and left working) so the success rows can show
// that only the route lookup reaches the corporation's servers.
vi.mock('@/lib/upsrtc/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/upsrtc/client')>();
  return { ...real, fetchUpstream: vi.fn(real.fetchUpstream) };
});
vi.mock('@/lib/upsrtc/scheduleService', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/upsrtc/scheduleService')>();
  return { ...real, fetchBusSchedule: vi.fn(real.fetchBusSchedule) };
});
vi.mock('@/lib/depot/routes/routeCatalogue', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/depot/routes/routeCatalogue')>();
  return { ...real, getRouteProfile: vi.fn(real.getRouteProfile) };
});
vi.mock('@/lib/serverLog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/serverLog')>()),
  logDepotError: vi.fn(),
}));

const API_DIR = 'src/app/api/upsrtc/depot';
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const SESSION: SessionClaims = { project: 'upsrtc', role: 'viewer', iat: 1, exp: 4_102_444_800 };
const SECRET = 'upstream-host.internal token=abc123';
/** Marks every hostile value, so a reflected one is found in any answer. */
const HOSTILE = '..%2Fzq<b>REFLECTED</b>';
const HOSTILE_RAW = 'REFLECTED';

/*
 * Every parameter name the depot API reads today, each given a hostile value, plus a
 * name no route knows: whichever of them a route reads (or however strictly it parses),
 * at least one is malformed for it.
 */
const PARAM_NAMES = [
  'depotId', 'bus', 'metric', 'scope', 'days', 'horizon', 'kind', 'q', 'offset', 'limit',
  'sort', 'dir', 'reason', 'serviceClass', 'date',
];
const HOSTILE_QUERY = [...PARAM_NAMES, HOSTILE]
  .map((name) => `${name}=${encodeURIComponent(`-1${HOSTILE}`)}`)
  .join('&');

/** A valid value for each dynamic segment name the depot API uses; anything else gets '1'. */
const VALID_SEGMENT: Readonly<Record<string, string>> = { routeName: 'AGRA_EXP_1' };

/*
 * A query that each parameterised route accepts, so its success path runs.
 * A route missing here is still called (with no query) and still checked.
 */
const ACCEPTED_QUERY: Readonly<Record<string, string>> = {
  'trends/route.ts': 'metric=index',
  'history/route.ts': 'metric=index&scope=network',
  'forecast/route.ts': 'metric=index&scope=network',
  'service/route/[routeName]/route.ts': `date=${GUARD_FEED_NOW.slice(0, 10)}`,
};

/*
 * Handlers whose success needs more than a GET on a valid id: the copilot
 * takes a signed, same-origin question body and has its own suite. Their
 * answers are still checked for the 401, no-store and fixed error bodies.
 */
const NOT_PLAIN_GETS: Readonly<Record<string, string>> = {
  'POST copilot/route.ts': 'needs a same-origin question body; covered by the copilot suites',
};

/** The one route allowed to reach the corporation's route service: a lookup a person starts, rate limited. */
const ROUTE_LOOKUP = 'route/[routeName]/route.ts';

type Handler = (request: NextRequest, context: { params: Promise<object> }) => Promise<Response>;

interface RouteCase {
  readonly file: string;
  readonly method: string;
  readonly handler: Handler;
  readonly segments: readonly string[];
  readonly readsQuery: boolean;
}

const FILES = filesUnder(API_DIR, (name) => name === 'route.ts');

async function load(file: string): Promise<RouteCase[]> {
  const mod = (await import(/* @vite-ignore */ join(ROOT, file))) as Record<string, unknown>;
  const source = readFileSync(join(ROOT, file), 'utf8');
  const segments = [...file.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1] ?? '');
  return METHODS.filter((m) => typeof mod[m] === 'function').map((method) => ({
    file: file.slice(API_DIR.length + 1),
    method,
    handler: mod[method] as Handler,
    segments,
    readsQuery: source.includes('searchParams'),
  }));
}

const CASES: readonly RouteCase[] = (await Promise.all(FILES.map(load))).flat();

function call(c: RouteCase, opts: { segment?: string; query?: string } = {}): Promise<Response> {
  const params = Object.fromEntries(
    c.segments.map((s) => [s, opts.segment ?? VALID_SEGMENT[s] ?? '1']),
  );
  const query = opts.query ?? ACCEPTED_QUERY[c.file];
  const url = `http://localhost:3000/api/upsrtc/depot/x${query ? `?${query}` : ''}`;
  const init = c.method === 'GET' ? { method: c.method } : { method: c.method, body: '{}' };
  return c.handler(new NextRequest(url, init), { params: Promise.resolve(params) });
}

const sampleSnapshot = (): LiveSnapshotResult => {
  const view = guardView();
  return {
    snapshot: {
      buses: [], depotRows: view.rows, recordCount: view.recordCount, rejectedRecordCount: 0,
      fetchedAt: view.fetchedAt, feedNow: view.feedNow, feedClockAheadRows: 0,
    },
    source: 'live',
    stale: false,
  };
};

const fetchStub = vi.fn(() => {
  throw new Error('a depot route made a network call');
});

beforeEach(() => {
  resetAnalysisForTests();
  vi.mocked(requireUpsrtcAccess).mockResolvedValue(SESSION);
  vi.stubGlobal('fetch', fetchStub);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function useRepositories(snapshot: () => Promise<FleetSnapshotView>): void {
  const repositories: DepotRepositories = {
    fleet: { snapshot },
    history: modelledHistoryRepository,
    crew: modelledCrewRepository,
    fuel: modelledFuelRepository,
    revenue: modelledRevenueRepository,
  };
  vi.mocked(getRepositories).mockReturnValue(repositories);
  vi.mocked(getServiceRepositories).mockReturnValue(guardServiceRepositories());
}

function useGoodData(): void {
  useRepositories(async () => guardView());
  vi.mocked(getLiveSnapshot).mockResolvedValue(sampleSnapshot());
}

function useFailingData(): void {
  useRepositories(() => Promise.reject(new Error(SECRET)));
  vi.mocked(getLiveSnapshot).mockRejectedValue(new Error(SECRET));
}

/** An error body is fixed: one `error` sentence (and a retry hint for 429), nothing from the request or the failure. */
async function expectFixedErrorBody(res: Response): Promise<string> {
  const text = await res.text();
  const body = JSON.parse(text) as Record<string, unknown>;
  expect(typeof body.error).toBe('string');
  expect(Object.keys(body).filter((k) => k !== 'error' && k !== 'retryAfterSeconds')).toEqual([]);
  expect(text).not.toContain(HOSTILE_RAW);
  expect(text).not.toContain('upstream-host');
  return text;
}

const named = (cases: readonly RouteCase[]) => cases.map((c) => [`${c.method} ${c.file}`, c] as const);

describe('the depot API routes', () => {
  it('finds every route file and at least one handler in each', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(18);
    expect(new Set(CASES.map((c) => c.file)).size).toBe(FILES.length);
  });

  it.each(CASES.map((c) => [`${c.method} ${c.file}`, c] as const))(
    '%s without a session answers the fixed 401 and reads no data',
    async (_name, c) => {
      vi.mocked(requireUpsrtcAccess).mockResolvedValue(null);
      const res = await call(c);
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
      expect(getRepositories).not.toHaveBeenCalled();
      expect(getServiceRepositories).not.toHaveBeenCalled();
      expect(getLiveSnapshot).not.toHaveBeenCalled();
      expect(getCopilotRuntime).not.toHaveBeenCalled();
      expect(fetchStub).not.toHaveBeenCalled();
    },
  );

  it.each(named(CASES))('%s with a session answers with no-store, and only the route lookup goes upstream', async (_n, c) => {
    useGoodData();
    const res = await call(c);
    expect(res.headers.get('cache-control')).toBe('no-store');
    if (res.status >= 400) await expectFixedErrorBody(res);
    if (c.file === ROUTE_LOOKUP) return;
    // No upstream call from any other route: not a fetch, not the upstream client,
    // not a route lookup, not a fresh live snapshot outside the fleet repository.
    expect(fetchStub).not.toHaveBeenCalled();
    expect(fetchUpstream).not.toHaveBeenCalled();
    expect(fetchBusSchedule).not.toHaveBeenCalled();
    expect(getRouteProfile).not.toHaveBeenCalled();
    expect(getLiveSnapshot).not.toHaveBeenCalled();
  });

  it('answers 200 on the success path of every data route', async () => {
    useGoodData();
    const statuses = await Promise.all(
      CASES.map(async (c) => [`${c.method} ${c.file}`, (await call(c)).status] as const),
    );
    const failed = statuses.filter(([name, status]) => status !== 200 && !(name in NOT_PLAIN_GETS));
    expect(failed).toEqual([]);
  });

  it.each(named(CASES))('%s answers a failing data read with no-store and a fixed body', async (_n, c) => {
    useFailingData();
    const res = await call(c);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const readData = vi.mocked(getRepositories).mock.calls.length > 0 ||
      vi.mocked(getLiveSnapshot).mock.calls.length > 0;
    // A success is possible only for a route that read no data at all.
    if (readData) expect(res.status).toBeGreaterThanOrEqual(400);
    if (res.status >= 400) await expectFixedErrorBody(res);
  });

  const withSegments = CASES.filter((c) => c.segments.length > 0);
  it.each(named(withSegments))('%s refuses a malformed id with the fixed 400', async (_n, c) => {
    useGoodData();
    const res = await call(c, { segment: HOSTILE });
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const first = await expectFixedErrorBody(res);
    const again = await call(c, { segment: `${'9'.repeat(70)}${HOSTILE}` });
    expect(await again.text()).toBe(first);
    expect(getRepositories).not.toHaveBeenCalled();
    expect(getServiceRepositories).not.toHaveBeenCalled();
    expect(getLiveSnapshot).not.toHaveBeenCalled();
  });

  const withQuery = CASES.filter((c) => c.readsQuery);
  it.each(named(withQuery))('%s refuses a malformed query with the fixed 400', async (_n, c) => {
    useGoodData();
    const res = await call(c, { query: HOSTILE_QUERY });
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const first = await expectFixedErrorBody(res);
    const again = await call(c, { query: `days=-1${HOSTILE}` });
    expect(await again.text()).toBe(first);
    expect(getRepositories).not.toHaveBeenCalled();
    expect(getServiceRepositories).not.toHaveBeenCalled();
  });
});
