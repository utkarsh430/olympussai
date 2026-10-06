// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { DepotBusRow } from '@/models/depotLive';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import type { DepotRepositories, FleetSnapshotView } from '@/lib/depot/repositories/types';
import { modelledCrewRepository } from '@/lib/depot/repositories/modelledCrewRepository';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { dutyPlanFor } from '@/lib/depot/live/operatingDayView';
import { buildCrewResponse, ROSTER_CAP, UNCOVERED_CAP } from '@/lib/depot/live/crewView';
import { rosterCrew } from '@/lib/depot/crew/roster';
import { crewShiftsFor } from '@/lib/depot/crew/roster';
import { modelCrew } from '@/lib/depot/sim/crew';
import type { CrewRepository, CrewSlot } from '@/lib/depot/crew/types';
import { operatingDateOf } from '@/lib/depot/sim/seed';
import { GET } from '@/app/api/upsrtc/depot/[depotId]/crew/route';

vi.mock('@/lib/auth/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/authorize')>();
  return { ...actual, requireUpsrtcAccess: vi.fn() };
});
vi.mock('@/lib/depot/repositories', () => ({ getRepositories: vi.fn() }));

const SESSION = { project: 'upsrtc', role: 'viewer', iat: 0, exp: 0 };
const FEED_NOW = '2026-10-06T08:00:00Z';
const ROUTES = ['ORD_1', 'ORD_2', 'EXP_3'];

function row(i: number, over: Partial<DepotBusRow> = {}): DepotBusRow {
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
    routeName: ROUTES[i % ROUTES.length] ?? null,
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
    ...over,
  };
}

function view(rows: readonly DepotBusRow[], over: Partial<FleetSnapshotView> = {}) {
  return {
    rows,
    feedNow: FEED_NOW,
    fetchedAt: '2026-10-06T08:00:05.000Z',
    source: 'live',
    stale: false,
    recordCount: rows.length,
    ...over,
  } satisfies FleetSnapshotView;
}

const world = (): DepotBusRow[] => Array.from({ length: 30 }, (_, i) => row(i));

const slot = (id: string, role: CrewSlot['role']): CrewSlot => ({
  id,
  role,
  availability: 'available',
  hoursThisWeek: 10,
});

function repoOf(slots: readonly CrewSlot[]): CrewRepository {
  return { crewFor: async () => slots };
}

const build = async (rows: readonly DepotBusRow[], crew: CrewRepository, id = '1') => {
  const response = await buildCrewResponse(view(rows), id, crew);
  if (!response) throw new Error(`no depot ${id}`);
  return response;
};

/** Words that must never appear as a whole word in a key of the response. */
const FORBIDDEN = ['name', 'score', 'rank', 'rating', 'performance', 'speed', 'violation'];

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]);
}

/** Splits camelCase and snake_case into lower-case words. */
const wordsOf = (key: string): string[] =>
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

beforeEach(() => {
  resetAnalysisForTests();
});

describe('buildCrewResponse', () => {
  it('is null for a depot the snapshot does not know', async () => {
    expect(await buildCrewResponse(view(world()), '999', modelledCrewRepository)).toBeNull();
  });

  it('reconciles with the roster built from the same duties and crew', async () => {
    const rows = world();
    const v = view(rows);
    const analysis = analyseSnapshot(v);
    const date = operatingDateOf(v.feedNow, v.fetchedAt);
    const duties = dutyPlanFor(analysis, '1', date)?.duties ?? [];
    const depot = analysis.depotsById.get('1');
    if (!depot) throw new Error('no depot');
    const expected = rosterCrew(
      duties,
      modelCrew(depot, crewShiftsFor(duties).shifts.length, date),
    );
    expect(expected.shiftsRequired).toBeGreaterThan(0);

    const response = await build(rows, modelledCrewRepository);
    const { summary } = response;
    expect(summary.shiftsRequired).toBe(expected.shiftsRequired);
    // One literal figure, so an engine error the wiring above repeats on both sides still fails:
    // this fixture's 30 buses give 26 modelled duties, each one shift needing one driver.
    expect([duties.length, summary.shiftsRequired, summary.driver.required]).toEqual([26, 26, 26]);
    expect(summary.shiftsCovered).toBe(expected.shiftsCovered);
    expect(summary.shiftsUncovered).toBe(expected.shiftsUncovered);
    expect(summary.shiftsCovered + summary.shiftsUncovered).toBe(summary.shiftsRequired);
    expect(summary.driver).toEqual({
      required: expected.required.driver,
      available: expected.available.driver,
    });
    expect(summary.dutiesFullyCovered + summary.dutiesPartlyCovered + summary.dutiesUncovered).toBe(
      duties.length,
    );
    expect(summary.dutiesNeedingRelief).toBe(expected.dutiesNeedingRelief);
    expect(response.uncovered).toHaveLength(summary.shiftsUncovered);
    expect(response.rosterTotal).toBe(summary.shiftsCovered);
    expect(response.roster.length).toBe(Math.min(summary.shiftsCovered, ROSTER_CAP));
  });

  it('summarises the modelled day from the same duty plan: duties and routes', async () => {
    const rows = world();
    const v = view(rows);
    const analysis = analyseSnapshot(v);
    const date = operatingDateOf(v.feedNow, v.fetchedAt);
    const duties = dutyPlanFor(analysis, '1', date)?.duties ?? [];
    const response = await build(rows, modelledCrewRepository);
    expect(response.day.duties).toBe(duties.length);
    expect(response.day.routes).toBe(new Set(duties.map((d) => d.routeName)).size);
    expect(response.day.duties).toBeGreaterThan(0);
    expect(Object.keys(response.day).sort()).toEqual(['duties', 'routes']);
  });

  it('summarises an empty day as zero duties and zero routes', async () => {
    const rows = world().map((r) => ({ ...r, routeName: null }));
    const response = await build(rows, modelledCrewRepository);
    expect(response.day).toEqual({ duties: 0, routes: 0 });
  });

  it('lists every shift as uncovered, with both roles short, when there is no crew', async () => {
    const response = await build(world(), repoOf([]));
    expect(response.summary.shiftsCovered).toBe(0);
    expect(response.roster).toEqual([]);
    expect(response.uncovered.every((u) => u.reason === 'no_available_crew')).toBe(true);
    expect(response.uncovered.every((u) => u.shortRoles.length === 2)).toBe(true);
    expect(
      response.uncovered.every(
        (u) =>
          u.shortfalls.length === 2 && u.shortfalls.every((f) => f.cause === 'no_slot_available'),
      ),
    ).toBe(true);
    expect(response.uncovered[0]?.route).toBeTruthy();
  });

  it('puts shifts short of both roles first, then the earliest start', async () => {
    const response = await build(world(), repoOf([slot('D-001', 'driver'), slot('D-002', 'driver')]));
    const roles = response.uncovered.map((u) => u.shortRoles.length);
    expect(roles).toEqual([...roles].sort((a, b) => b - a));
    for (let i = 1; i < response.uncovered.length; i += 1) {
      const a = response.uncovered[i - 1];
      const b = response.uncovered[i];
      if (a && b && a.shortRoles.length === b.shortRoles.length) {
        expect(a.startMin).toBeLessThanOrEqual(b.startMin);
      }
    }
  });

  it('counts availability per role from the crew slots', async () => {
    const crew: CrewSlot[] = [
      slot('D-001', 'driver'),
      { ...slot('D-002', 'driver'), availability: 'absent' },
      { ...slot('D-003', 'driver'), availability: 'leave' },
      slot('C-001', 'conductor'),
      { ...slot('C-002', 'conductor'), availability: 'weekly_off' },
    ];
    const response = await build(world(), repoOf(crew));
    expect(response.availability.driver).toEqual({
      available: 1,
      weekly_off: 0,
      leave: 1,
      training: 0,
      absent: 1,
    });
    expect(response.availability.conductor).toEqual({
      available: 1,
      weekly_off: 1,
      leave: 0,
      training: 0,
      absent: 0,
    });
  });

  it('caps the roster and states the full count', async () => {
    const many = Array.from({ length: 300 }, (_, i) => slot(`D-${i}`, 'driver'));
    const more = Array.from({ length: 300 }, (_, i) => slot(`C-${i}`, 'conductor'));
    const response = await build(world(), repoOf([...many, ...more]));
    expect(response.roster.length).toBeLessThanOrEqual(ROSTER_CAP);
    expect(response.rosterCap).toBe(ROSTER_CAP);
    expect(response.rosterTotal).toBe(response.summary.shiftsRequired);
  });

  it('caps the uncovered list and states the true count', async () => {
    const big = Array.from({ length: 500 }, (_, i) =>
      row(i, { routeName: `R_${i % 300}`, registrationNumber: `B${i}` }),
    );
    const response = await build(big, repoOf([]));
    expect(response.summary.shiftsUncovered).toBeGreaterThan(UNCOVERED_CAP);
    expect(response.uncovered).toHaveLength(UNCOVERED_CAP);
    expect(response.uncoveredCap).toBe(UNCOVERED_CAP);
    expect(response.uncoveredTotal).toBe(response.summary.shiftsUncovered);
  });

  it('states the true uncovered count when nothing is capped', async () => {
    const response = await build(world(), repoOf([]));
    expect(response.uncoveredTotal).toBe(response.uncovered.length);
  });

  it('answers an empty depot with zero shifts, not an error', async () => {
    const rows = world().map((r) => ({ ...r, routeName: null }));
    const response = await build(rows, modelledCrewRepository);
    expect(response.summary.shiftsRequired).toBe(0);
    expect(response.uncovered).toEqual([]);
    expect(response.roster).toEqual([]);
  });

  it('carries the limits from the module constants and is tagged MODELLED', async () => {
    const response = await build(world(), modelledCrewRepository);
    expect(response.provenance).toBe('modelled');
    expect(response.limits).toEqual({ dailyHours: 10, weeklyHours: 48 });
  });

  it('says nothing about a person: no forbidden word in a key and no weekly hours', async () => {
    const response = await build(world(), modelledCrewRepository);
    const words = keysOf(response).flatMap(wordsOf);
    for (const word of FORBIDDEN) expect(words).not.toContain(word);
    expect(JSON.stringify(response)).not.toContain('hoursThisWeek');
    expect(response.roster.length).toBeGreaterThan(0);
    for (const shift of response.roster) {
      expect(Object.keys(shift).sort()).toEqual(
        ['dutyId', 'driverSlot', 'conductorSlot', 'endMin', 'route', 'shiftCount', 'shiftIndex', 'startMin'].sort(),
      );
    }
  });

  it('builds the envelope per call while reusing the body for the same rows', async () => {
    const rows = world();
    const fresh = await buildCrewResponse(view(rows), '1', modelledCrewRepository);
    const stale = await buildCrewResponse(
      view(rows, { stale: true, source: 'cache' }),
      '1',
      modelledCrewRepository,
    );
    expect(fresh?.stale).toBe(false);
    expect(stale?.stale).toBe(true);
    expect(stale?.source).toBe('cache');
    expect(stale?.summary).toBe(fresh?.summary);
    expect(stale?.roster).toBe(fresh?.roster);
  });

  it('shares one build between concurrent first requests for the same depot', async () => {
    const rows = world();
    const crewFor = vi.fn(modelledCrewRepository.crewFor);
    const counted = { ...modelledCrewRepository, crewFor };
    const [one, two] = await Promise.all([
      buildCrewResponse(view(rows), '1', counted),
      buildCrewResponse(view(rows), '1', counted),
    ]);
    expect(crewFor).toHaveBeenCalledTimes(1);
    expect(two?.roster).toBe(one?.roster);
  });
});

describe('crew route', () => {
  const snapshot = vi.fn();
  const context = (depotId: string) => ({ params: Promise.resolve({ depotId }) });
  const request = new NextRequest('http://localhost:3000/api/upsrtc/depot/1/crew');
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    snapshot.mockReset();
    vi.mocked(getRepositories).mockReset();
    vi.mocked(requireUpsrtcAccess).mockResolvedValue(SESSION);
    vi.mocked(getRepositories).mockReturnValue({
      fleet: { snapshot },
      crew: modelledCrewRepository,
    } as unknown as DepotRepositories);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('answers 401 before any repository is touched', async () => {
    vi.mocked(requireUpsrtcAccess).mockResolvedValue(null);
    const response = await GET(request, context('1'));
    expect(response.status).toBe(401);
    expect(getRepositories).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('answers 400 for an invalid depot id without reading the fleet', async () => {
    const response = await GET(request, context('1; DROP'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid depot id' });
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('answers 404 for a depot that is not in the feed', async () => {
    snapshot.mockResolvedValue(view(world()));
    const response = await GET(request, context('999'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Depot not found' });
  });

  it('answers 200 with the response and no-store for a known depot', async () => {
    snapshot.mockResolvedValue(view(world()));
    const response = await GET(request, context('1'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const body = (await response.json()) as { provenance: string; summary: { shiftsRequired: number } };
    expect(body.provenance).toBe('modelled');
    expect(body.summary.shiftsRequired).toBeGreaterThan(0);
  });

  it('answers 503 with a fixed body and one logged error when the fleet read fails', async () => {
    snapshot.mockRejectedValue(new Error('upstream https://secret-host/token=abc failed'));
    const response = await GET(request, context('1'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Depot data unavailable' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('answers 503 the same way when the crew read fails', async () => {
    snapshot.mockResolvedValue(view(world()));
    vi.mocked(getRepositories).mockReturnValue({
      fleet: { snapshot },
      crew: { crewFor: async () => Promise.reject(new Error('roster down')) },
    } as unknown as DepotRepositories);
    const response = await GET(request, context('1'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Depot data unavailable' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
