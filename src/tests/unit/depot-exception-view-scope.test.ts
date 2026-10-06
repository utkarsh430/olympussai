// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import { modelledHistoryRepository } from '@/lib/depot/repositories/modelledHistoryRepository';
import { modelledCrewRepository } from '@/lib/depot/repositories/modelledCrewRepository';
import { modelledFuelRepository } from '@/lib/depot/repositories/modelledFuelRepository';
import { modelledRevenueRepository } from '@/lib/depot/repositories/modelledRevenueRepository';
import type { DepotRepositories, FleetSnapshotView } from '@/lib/depot/repositories/types';
import type { DepotExceptionsResponse } from '@/lib/depot/api';
import { BUS_EXCEPTION_KINDS, DEFAULT_BUS_PAGE_QUERY } from '@/lib/depot/exceptions/busPage';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildPagedExceptionsResponse } from '@/lib/depot/live/exceptionView';
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

function reposWith(view: FleetSnapshotView): DepotRepositories {
  return {
    history: modelledHistoryRepository,
    crew: modelledCrewRepository,
    fuel: modelledFuelRepository,
    revenue: modelledRevenueRepository,
    fleet: { snapshot: async () => view },
  };
}

/** The real depot with the most bus exceptions on the fixture. */
function busiestDepot(): string {
  const analysis = analyseSnapshot(fixtureView());
  const ranked = [...analysis.exceptionsByDepot.entries()]
    .filter(([id]) => id !== 'unassigned')
    .sort((a, b) => b[1].bus.length - a[1].bus.length);
  const id = ranked[0]?.[0];
  if (id === undefined) throw new Error('fixture has no depot exceptions');
  return id;
}

/** A depot on the fixture with no exception of either sort. */
function quietDepot(): string {
  const analysis = analyseSnapshot(fixtureView());
  const quiet = analysis.depots.find((d) => {
    const own = analysis.exceptionsByDepot.get(d.id);
    return own === undefined || (own.bus.length === 0 && own.depot.length === 0);
  });
  if (quiet === undefined) throw new Error('fixture has no quiet depot');
  return quiet.id;
}

const page = (depotId: string | null, kind: DepotExceptionsResponse['busPage']['kind'] = null) => ({
  ...DEFAULT_BUS_PAGE_QUERY,
  depotId,
  kind,
});

beforeEach(() => {
  resetAnalysisForTests();
  vi.mocked(requireUpsrtcAccess).mockResolvedValue(SESSION);
});

describe('buildPagedExceptionsResponse with a depot', () => {
  it('sends no depot scope without a depot, exactly as before', () => {
    const res = buildPagedExceptionsResponse(fixtureView(), page(null));
    expect('depotScope' in res).toBe(false);
  });

  it('scopes counts, total and depot exceptions to the depot, and names it', () => {
    const id = busiestDepot();
    const analysis = analyseSnapshot(fixtureView());
    const res = buildPagedExceptionsResponse(fixtureView(), page(id));
    const scope = res.depotScope;
    expect(scope?.depotId).toBe(id);
    expect(scope?.depotName).toBe(analysis.depotsById.get(id)?.name);
    const own = analysis.busExceptions.filter((e) => e.depotId === id);
    for (const kind of BUS_EXCEPTION_KINDS) {
      expect(scope?.busCounts[kind]).toBe(own.filter((e) => e.kind === kind).length);
    }
    expect(scope?.busTotal).toBe(own.length);
    expect(scope?.busTotal).toBe(res.busPage.total);
    expect(scope?.busTotal).toBeLessThan(res.report.busTotal);
    expect(scope?.depot.every((e) => e.depotId === id)).toBe(true);
    expect(scope?.depot).toEqual(res.report.depot.filter((e) => e.depotId === id));
    // The network's figures stay as they were.
    expect(res.report.busTotal).toBe(analysis.report.busTotal);
  });

  it('with a kind as well, the list total is that depot and kind', () => {
    const id = busiestDepot();
    for (const kind of BUS_EXCEPTION_KINDS) {
      const res = buildPagedExceptionsResponse(fixtureView(), page(id, kind));
      expect(res.busPage.total).toBe(res.depotScope?.busCounts[kind]);
      expect(res.busPage.items.every((e) => e.kind === kind && e.depotId === id)).toBe(true);
    }
  });

  it('a depot with no exceptions says zero and is still named', () => {
    const id = quietDepot();
    const scope = buildPagedExceptionsResponse(fixtureView(), page(id)).depotScope;
    expect(scope).toEqual({
      depotId: id,
      depotName: analyseSnapshot(fixtureView()).depotsById.get(id)?.name,
      busCounts: { long_dark: 0, power_cut: 0, tamper_code: 0, emergency: 0 },
      busTotal: 0,
      depot: [],
    });
  });

  it('a well-formed id the snapshot does not hold is scoped to nothing, with no name', () => {
    const scope = buildPagedExceptionsResponse(fixtureView(), page('999999')).depotScope;
    expect(scope).toMatchObject({ depotId: '999999', depotName: null, busTotal: 0, depot: [] });
  });

  it('shares the scope built for the rows while the envelope is per request', () => {
    const id = busiestDepot();
    const fresh = buildPagedExceptionsResponse(fixtureView({ stale: false }), page(id));
    const stale = buildPagedExceptionsResponse(fixtureView({ stale: true }), page(id, 'long_dark'));
    expect([fresh.stale, stale.stale]).toEqual([false, true]);
    expect(stale.depotScope).toBe(fresh.depotScope);
  });
});

describe('GET /api/upsrtc/depot/exceptions with a depot', () => {
  const request = (query: string): NextRequest =>
    new NextRequest(`http://localhost/api/upsrtc/depot/exceptions${query}`);

  it('serves no scope without a depot', async () => {
    vi.mocked(getRepositories).mockReturnValueOnce(reposWith(fixtureView()));
    const res = await GET(request(''));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect('depotScope' in ((await res.json()) as object)).toBe(false);
  });

  it("serves the depot's scope, and the list total for its depot and kind", async () => {
    const id = busiestDepot();
    vi.mocked(getRepositories).mockReturnValueOnce(reposWith(fixtureView()));
    const res = await GET(request(`?depotId=${id}&kind=long_dark`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as DepotExceptionsResponse;
    expect(body.depotScope?.depotId).toBe(id);
    expect(body.busPage.total).toBe(body.depotScope?.busCounts.long_dark);
  });

  it('refuses a malformed depot id with the fixed body, as for any bad filter', async () => {
    vi.mocked(getRepositories).mockClear();
    const res = await GET(request('?depotId=abc'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid query' });
    expect(getRepositories).not.toHaveBeenCalled();
  });
});
