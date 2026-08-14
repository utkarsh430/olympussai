// @vitest-environment node
//
// GET /api/ops/control-room/overview — the console's refresh endpoint.
//
// Two things are worth holding here, and neither is about the numbers
// themselves (those are asserted in controlRoomConsoleModel.test.ts):
//
//   1. THE BOUNDARY. This route serves the statewide fleet count and every
//      corridor the control service knows. It must be control_room only, and
//      it must accept no depot parameter of any kind - a route that took one
//      would be a way around the ownership boundary
//      db/migrations/20260812150000__ops_depot_ownership.sql just closed.
//   2. THE PROVENANCE FLAGS. The whole console rests on `ok` telling the truth
//      about whether each upstream answered. Every reader beneath this route is
//      built never to throw, so a failure arrives as a flag or not at all; if
//      the flag is wrong the console reports a confident zero during an outage.
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rolesForOpsApiPath } from '@/lib/auth/rbac/roles';

const requireOpsRole = vi.fn();
const getOpsFleetSnapshot = vi.fn();
const getObservabilitySnapshot = vi.fn();
const getDailyKpiSnapshots = vi.fn();
const getGuardrailBreaches = vi.fn();
const listKillSwitches = vi.fn();

vi.mock('@/lib/auth/rbac/guard', () => ({
  requireOpsRole: (...args: unknown[]) => requireOpsRole(...args),
}));
vi.mock('@/lib/auth/rbac/repo', () => ({
  getOpsRepo: () => ({ listKillSwitches }),
}));
vi.mock('@/lib/ops/fleetData', () => ({
  getOpsFleetSnapshot: (...args: unknown[]) => getOpsFleetSnapshot(...args),
}));
vi.mock('@/lib/controlService/observabilityData', () => ({
  getObservabilitySnapshot: (...args: unknown[]) => getObservabilitySnapshot(...args),
}));
vi.mock('@/lib/controlService/pilotData', () => ({
  getDailyKpiSnapshots: (...args: unknown[]) => getDailyKpiSnapshots(...args),
  getGuardrailBreaches: (...args: unknown[]) => getGuardrailBreaches(...args),
}));

/** Just the per-source provenance flags, which are what these tests are about. */
interface SourceFlags {
  observability: { ok: boolean; error: string | null };
  dailyKpi: { ok: boolean };
  guardrails: { ok: boolean };
  killSwitches: { ok: boolean; active: unknown[] };
}

const PATH = '/api/ops/control-room/overview';
const CORRIDOR = '44444444-4444-4444-4444-444444444444';
const CLAIMS = { sub: 'ops-user-1', email: 'cr@example.com', role: 'control_room' as const };

function healthyObservability(patch: Record<string, unknown> = {}) {
  return {
    source: 'live',
    stale: false,
    error: null,
    fetchedAt: '2026-08-13T10:00:00.000Z',
    routeDirections: [
      { routeDirectionId: CORRIDOR, routeId: 'R1', directionCode: 'up', isLoop: false, totalDistanceMeters: 1000 },
    ],
    selectedRouteDirectionId: CORRIDOR,
    positions: [],
    headway: {
      routeDirectionId: CORRIDOR,
      computedAt: '2026-08-13T10:00:00.000Z',
      pairs: [],
      aggregate: {
        routeDirectionId: CORRIDOR,
        sampleCount: 4,
        meanHeadwaySeconds: 500,
        stddevHeadwaySeconds: 60,
        cv: 0.12,
        ewtSeconds: 40,
        targetHeadwaySeconds: 600,
      },
      incidents: [],
    },
    incidents: [],
    ...patch,
  };
}

async function callGet(url = `http://localhost:3000${PATH}`) {
  const { GET } = await import('@/app/api/ops/control-room/overview/route');
  return GET(new NextRequest(url, { method: 'GET' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOpsRole.mockResolvedValue({ ok: true, claims: CLAIMS });
  getOpsFleetSnapshot.mockResolvedValue({
    buses: [{ id: 'a' }, { id: 'b' }],
    source: 'live',
    stale: false,
    fetchedAt: '2026-08-13T10:00:00.000Z',
    error: null,
  });
  getObservabilitySnapshot.mockResolvedValue(healthyObservability());
  getDailyKpiSnapshots.mockResolvedValue({ source: 'live', stale: false, error: null, fetchedAt: '', data: [] });
  getGuardrailBreaches.mockResolvedValue({ source: 'live', stale: false, error: null, fetchedAt: '', data: [] });
  listKillSwitches.mockResolvedValue([]);
});

describe('GET /api/ops/control-room/overview — the boundary', () => {
  it('is control_room only', () => {
    // Computed by the real, unmocked roles module from the route tree, so this
    // cannot drift from what the handler actually enforces.
    expect(rolesForOpsApiPath(PATH, 'GET')).toEqual(['control_room']);
  });

  it('refuses a caller the guard rejects, without reading any data', async () => {
    requireOpsRole.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), { status: 403 }),
    });
    const response = await callGet();
    expect(response.status).toBe(403);
    expect(getOpsFleetSnapshot).not.toHaveBeenCalled();
    expect(getObservabilitySnapshot).not.toHaveBeenCalled();
  });

  it('accepts no depot parameter — a forged one changes nothing', async () => {
    const response = await callGet(`http://localhost:3000${PATH}?depotId=99&depot=Bareilly`);
    expect(response.status).toBe(200);
    // The fleet read is statewide regardless of anything in the query string.
    expect(getOpsFleetSnapshot).toHaveBeenCalledWith({ kind: 'all' });
    const body = (await response.json()) as { fleet: { reporting: number } };
    expect(body.fleet.reporting).toBe(2);
  });

  it('is never cached', async () => {
    const response = await callGet();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('GET /api/ops/control-room/overview — provenance survives to the wire', () => {
  it('marks every source ok when they all answered', async () => {
    const body = (await (await callGet()).json()) as SourceFlags;
    expect(body.observability.ok).toBe(true);
    expect(body.dailyKpi.ok).toBe(true);
    expect(body.guardrails.ok).toBe(true);
    expect(body.killSwitches.ok).toBe(true);
  });

  it('marks the control service NOT ok when it degraded to a cached snapshot', async () => {
    // A stale last-known-good is exactly the case that must not read as live:
    // the reader returns real numbers, and they describe an earlier moment.
    getObservabilitySnapshot.mockResolvedValue(
      healthyObservability({ source: 'unavailable', stale: true, error: 'timed out' }),
    );
    const body = (await (await callGet()).json()) as { observability: { ok: boolean; error: string | null } };
    expect(body.observability.ok).toBe(false);
    expect(body.observability.error).toBe('timed out');
  });

  it('marks the KPI roll-up and guardrail reads NOT ok independently', async () => {
    getGuardrailBreaches.mockResolvedValue({
      source: 'unavailable',
      stale: true,
      error: 'down',
      fetchedAt: '',
      data: [],
    });
    const body = (await (await callGet()).json()) as SourceFlags;
    expect(body.guardrails.ok).toBe(false);
    // One dead source must not condemn the others.
    expect(body.dailyKpi.ok).toBe(true);
    expect(body.observability.ok).toBe(true);
  });

  it('reports the kill-switch record as unreadable rather than empty when the query fails', async () => {
    listKillSwitches.mockRejectedValue(new Error('connection refused'));
    const body = (await (await callGet()).json()) as { killSwitches: { ok: boolean; active: unknown[] } };
    // `active: []` with ok:false is what lets the console say UNKNOWN. Reporting
    // ok:true here would promise the network is open on no evidence.
    expect(body.killSwitches).toEqual({ ok: false, active: [] });
  });
});

describe('GET /api/ops/control-room/overview — corridor selection', () => {
  it('keys the KPI and guardrail reads to the corridor the control service actually selected', async () => {
    await callGet(`http://localhost:3000${PATH}?routeDirectionId=${CORRIDOR}`);
    expect(getObservabilitySnapshot).toHaveBeenCalledWith(CORRIDOR, expect.any(Number));
    // Every corridor-scoped read must use the RESOLVED corridor, or the strip
    // would attribute one corridor's recovery rate to another's headway.
    expect(getDailyKpiSnapshots).toHaveBeenCalledWith(undefined, CORRIDOR, expect.any(Number));
    expect(getGuardrailBreaches).toHaveBeenCalledWith(CORRIDOR, expect.any(Number));
  });

  it('attributes no KPI row to a corridor that has none', async () => {
    getDailyKpiSnapshots.mockResolvedValue({
      source: 'live',
      stale: false,
      error: null,
      fetchedAt: '',
      // A row for a DIFFERENT corridor. Picking "the first row" would show its
      // recovery rate under the selected corridor's name.
      data: [{ routeDirectionId: 'some-other-corridor', recoveryRate: 0.9 }],
    });
    const body = (await (await callGet()).json()) as { dailyKpi: { row: unknown } };
    expect(body.dailyKpi.row).toBeNull();
  });

  it('copes with a control service that lists no corridors at all', async () => {
    getObservabilitySnapshot.mockResolvedValue(
      healthyObservability({ routeDirections: [], selectedRouteDirectionId: null, headway: null }),
    );
    const response = await callGet();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { selectedRouteDirectionId: string | null; headway: unknown };
    expect(body.selectedRouteDirectionId).toBeNull();
    expect(body.headway).toBeNull();
  });
});

/**
 * Coverage counting, at the layer where the corridor list's provenance is
 * still known.
 *
 * The numbers themselves are the easy part. What these hold is that they are
 * COUNTED, never assumed: a list the console did not read this cycle produces
 * no coverage figure at all, and a control service that does not report policy
 * state produces an explicit unknown rather than a zero. Both failures would
 * be invisible on screen — a wrong coverage number looks exactly like a right
 * one — so they are pinned here rather than left to the renderer.
 */
describe('GET /api/ops/control-room/overview — corridor coverage is counted, not assumed', () => {
  function corridor(id: string, hasActivePolicy?: boolean) {
    return {
      routeDirectionId: id,
      routeId: `R-${id}`,
      directionCode: 'up',
      isLoop: false,
      totalDistanceMeters: 1000,
      ...(hasActivePolicy === undefined ? {} : { hasActivePolicy }),
    };
  }

  async function coverageOf(patch: Record<string, unknown>) {
    getObservabilitySnapshot.mockResolvedValue(healthyObservability(patch));
    const body = (await (await callGet()).json()) as {
      corridors: { ok: boolean; mapped: number; detecting: number | null };
    };
    return body.corridors;
  }

  it('counts the corridors it was given, whatever that number happens to be', async () => {
    // The point of two different lists in one test: nothing in the pipeline is
    // allowed to hold a constant. The seeder maps more of the network over
    // time, and the readout has to follow it without a code change.
    expect(
      await coverageOf({
        routeDirections: [corridor('a', true), corridor('b', false), corridor('c', false)],
        selectedRouteDirectionId: 'a',
      }),
    ).toEqual({ ok: true, mapped: 3, detecting: 1 });

    expect(
      await coverageOf({
        routeDirections: [corridor('a', true), corridor('b', true)],
        selectedRouteDirectionId: 'a',
      }),
    ).toEqual({ ok: true, mapped: 2, detecting: 2 });
  });

  it('reports coverage as unreadable — not as zero — when the corridor list is a stale copy', async () => {
    // THE DEFECT THIS PREVENTS: an unreachable control service leaves a cached
    // list behind, and counting it would report last week's coverage as
    // today's. `ok: false` is what makes the tile print n/a instead.
    const coverage = await coverageOf({
      source: 'unavailable',
      stale: true,
      error: 'timed out',
      routeDirections: [corridor('a', true)],
    });
    expect(coverage.ok).toBe(false);
  });

  it('still counts coverage when the SELECTED corridor has no policy, because the list itself was read', async () => {
    // `no_active_policy` fails the per-corridor read after the list has already
    // arrived, and the snapshot deliberately keeps that fresh list. Treating
    // this as unreadable would blank a coverage figure the console genuinely
    // has — and it is the DEFAULT view, so it would be blank most of the time.
    const coverage = await coverageOf({
      source: 'unavailable',
      stale: true,
      error: 'no active policy',
      errorCode: 'no_active_policy',
      routeDirections: [corridor('a', false), corridor('b', true)],
      headway: null,
    });
    expect(coverage).toEqual({ ok: true, mapped: 2, detecting: 1 });
  });

  it('reports detection as UNKNOWN, never zero, when the control service omits the flag', async () => {
    // An older control service simply does not send `hasActivePolicy`. Reading
    // that absence as `false` would report "0 of 47 corridors can detect" at a
    // network that may be fully policied — a fabricated number dressed as a
    // measurement, which is the exact failure this strip exists to prevent.
    const coverage = await coverageOf({
      routeDirections: [corridor('a'), corridor('b')],
      selectedRouteDirectionId: 'a',
    });
    expect(coverage).toEqual({ ok: true, mapped: 2, detecting: null });
  });

  it('reports no corridors as a counted zero when the service genuinely lists none', async () => {
    const coverage = await coverageOf({
      routeDirections: [],
      selectedRouteDirectionId: null,
      headway: null,
    });
    expect(coverage).toEqual({ ok: true, mapped: 0, detecting: 0 });
  });
});
