// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildCrewResponse } from '@/lib/depot/live/crewView';
import { buildDutyBoard } from '@/lib/depot/live/dutyView';
import { buildEconomicsResponse } from '@/lib/depot/live/economicsView';
import { buildFuelResponse } from '@/lib/depot/live/fuelView';
import { operatingDayFor } from '@/lib/depot/live/operatingDayView';
import { buildRevenueResponse } from '@/lib/depot/live/revenueView';
import { modelledCrewRepository } from '@/lib/depot/repositories/modelledCrewRepository';
import { modelledFuelRepository } from '@/lib/depot/repositories/modelledFuelRepository';
import { modelledRevenueRepository } from '@/lib/depot/repositories/modelledRevenueRepository';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { cachedRouteProfiles, routeCatalogueRevision } from '@/lib/depot/routes/routeCatalogue';
import type { RouteProfile } from '@/lib/depot/routes/types';

vi.mock('@/lib/depot/routes/routeCatalogue', () => ({
  cachedRouteProfiles: vi.fn(),
  routeCatalogueRevision: vi.fn(() => 1),
}));

/*
 * Review I4, through the REAL response builders: on one fixture with repeated
 * registrations, every live state and one cached route profile, the duty
 * board, crew, fuel, revenue and economics describe one day, down to the bus
 * that runs each duty. Then a newly cached profile (a catalogue revision)
 * moves fuel and revenue together and leaves the board alone.
 */

const FEED_NOW = '2026-10-06T08:00:00Z';
const ROUTES = ['AGRA_EXP_1', 'KANPUR_ORD_2', 'DELHI_AC_3'];
const profile = (lengthKm: number): RouteProfile => ({ lengthKm }) as unknown as RouteProfile;

function row(over: Partial<DepotBusRow>): DepotBusRow {
  return {
    registrationNumber: 'UP32A0001', latitude: 26.85, longitude: 80.95, speedKmph: 0,
    ignitionOn: false, gpsTimestamp: FEED_NOW, receivedAt: FEED_NOW, depotId: '1',
    depotName: 'Depot 1', vehicleStatus: 'stationary', tripStatus: 'Stationary', routeId: null,
    routeName: null, routeDescription: null, journeyId: null, journeyCode: null,
    scheduledStart: null, scheduledEnd: null, actualStart: null, delayMinutes: null,
    odometerRaw: null, mainPowerOn: true, mainVoltage: null, tamperCode: 'C', emergency: false,
    ...over,
  };
}

const MOVING = { speedKmph: 30, latitude: 27.2, longitude: 79.9, vehicleStatus: 'live' } as const;

/** Depot 1's 40 buses in every live state, the route per bus fixed by its index. */
function depotOne(): DepotBusRow[] {
  return Array.from({ length: 40 }, (_, i) => {
    const base = { registrationNumber: `UP1X${i}`, routeName: `${ROUTES[i % 3]}1` };
    if (i < 4) return row({ ...base, ...MOVING, scheduledStart: '2026-10-06T06:00:00Z' });
    if (i < 8) return row({ ...base, ...MOVING });
    if (i < 11) return row({ ...base, latitude: 25.3, longitude: 82.9 });
    if (i < 13) return row({ ...base, vehicleStatus: 'no_signal' });
    if (i < 16) return row({ ...base, vehicleStatus: 'under_maintenance' });
    return row(base);
  }) as DepotBusRow[];
}

function world(): DepotBusRow[] {
  const others = ['2', '3', '4', '5', '6'].flatMap((depotId) =>
    Array.from({ length: 40 }, (_, i) =>
      row({ registrationNumber: `UP${depotId}X${i}`, depotId, depotName: `Depot ${depotId}`,
        routeName: `${ROUTES[i % 3]}${depotId}` }),
    ),
  );
  const repeats = [
    row({ registrationNumber: 'UP1X20', routeName: 'ZZZ_ORD_9' }),
    row({ registrationNumber: 'UP1X21 ', routeName: 'AGRA_EXP_11' }),
  ];
  return [...depotOne(), ...repeats, ...others];
}

const VIEW: FleetSnapshotView = {
  rows: world(), feedNow: FEED_NOW, fetchedAt: '2026-10-06T08:00:05.000Z', source: 'live',
  stale: false, recordCount: 242,
};
const SOURCES = { revenue: modelledRevenueRepository, fuel: modelledFuelRepository };
const tenths = (km: number): number => Math.round(km * 10);

beforeEach(() => {
  resetAnalysisForTests();
  vi.mocked(routeCatalogueRevision).mockReturnValue(1);
  vi.mocked(cachedRouteProfiles).mockReturnValue(new Map([['AGRA_EXP_11', profile(61.4)]]));
});

async function pages() {
  const board = buildDutyBoard(VIEW, '1');
  const crew = await buildCrewResponse(VIEW, '1', modelledCrewRepository);
  const fuel = await buildFuelResponse(VIEW, '1', modelledFuelRepository);
  const revenue = await buildRevenueResponse(VIEW, '1', SOURCES);
  const economics = await buildEconomicsResponse(VIEW, SOURCES);
  const day = operatingDayFor(VIEW, '1');
  if (!board || !crew || !fuel || !revenue || !day) throw new Error('depot 1 is missing');
  return { board, crew, fuel, revenue, economics, day };
}

const countBy = (names: readonly string[]): Record<string, number> =>
  names.reduce<Record<string, number>>((acc, n) => ({ ...acc, [n]: (acc[n] ?? 0) + 1 }), {});

describe('every page reads the one shared day (review I4)', () => {
  it('carries the operating date the day is for on every response, so pages can date it (M2)', async () => {
    const { board, crew, fuel, revenue, economics, day } = await pages();
    const dates = [board, crew, fuel, revenue, economics].map((r) => r.operatingDate);
    expect(new Set(dates)).toEqual(new Set([day.operatingDate]));
  });

  it('states the same day summary, the same route split and the same bus for every duty', async () => {
    const { board, crew, fuel, revenue, economics, day } = await pages();
    expect(board.duties.length).toBeGreaterThan(0);
    expect(fuel.day).toEqual(revenue.day);
    expect(fuel.day.duties).toBe(board.duties.length);
    expect(crew.day).toEqual({ duties: board.duties.length, routes: fuel.day.routes });
    const boardSplit = countBy(board.duties.map((d) => d.routeName));
    expect(Object.fromEntries(day.routes.map((r) => [r.routeName, r.duties]))).toEqual(boardSplit);
    const ranBy = new Map(day.runs.map((r) => [r.dutyId, r.registrationNumber]));
    for (const duty of board.duties) {
      expect(ranBy.get(duty.id) ?? null).toBe(duty.registrationNumber);
    }
    expect(fuel.day.busesRan).toBe(board.counts.assigned);
    const one = economics.depots.find((d) => d.depotId === '1');
    expect(one?.lengthCoverage).toEqual(revenue.summary.lengthCoverage);
    const cost = one?.score.components.find((c) => c.key === 'costPerKm');
    expect(cost?.value ?? null).toBe(fuel.totals.costPerKm);
  });

  it('counts each bus once: runs + not run = the deduplicated fleet', async () => {
    const { board, fuel, day } = await pages();
    expect(board.duplicateRowsDropped).toBe(2);
    expect(day.fleet).toBe(40);
    expect(day.runs.length + day.notRun.length).toBe(40);
    expect(fuel.day.busesRan + fuel.notRunCount).toBe(fuel.day.buses);
    expect(new Set(day.notRun.map((b) => b.registrationNumber)).size).toBe(day.notRun.length);
  });

  it('runs every bus out on the road, and never one off the road or dark', async () => {
    const { board, day } = await pages();
    const ran = new Set(day.runs.map((r) => r.registrationNumber));
    for (let i = 0; i < 8; i += 1) expect(ran.has(`UP1X${i}`)).toBe(true);
    for (let i = 11; i < 16; i += 1) expect(ran.has(`UP1X${i}`)).toBe(false);
    const standing = new Map(board.duties.map((d) => [d.registrationNumber, d.busStanding]));
    expect(standing.get('UP1X0')).toBe('on_road');
    expect([...standing.values()].every((s) => s !== undefined)).toBe(true);
  });

  it('after a newly cached profile fuel and revenue move together and the board is unchanged', async () => {
    const before = await pages();
    vi.mocked(routeCatalogueRevision).mockReturnValue(2);
    vi.mocked(cachedRouteProfiles).mockReturnValue(
      new Map([['AGRA_EXP_11', profile(61.4)], ['KANPUR_ORD_21', profile(12.5)]]),
    );
    const after = await pages();
    expect(tenths(after.fuel.totals.distanceKm)).toBe(tenths(after.revenue.summary.serviceKm));
    expect(after.fuel.totals.distanceKm).not.toBe(before.fuel.totals.distanceKm);
    expect(after.board.duties).toEqual(before.board.duties);
    expect(after.board.counts).toEqual(before.board.counts);
    expect(after.day.runs.map((r) => r.registrationNumber)).toEqual(
      before.day.runs.map((r) => r.registrationNumber),
    );
  });
});
