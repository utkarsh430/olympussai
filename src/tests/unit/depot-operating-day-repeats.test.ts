// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildCrewResponse } from '@/lib/depot/live/crewView';
import { buildDutyBoard } from '@/lib/depot/live/dutyView';
import { buildFuelResponse } from '@/lib/depot/live/fuelView';
import { buildRevenueResponse } from '@/lib/depot/live/revenueView';
import { modelledCrewRepository } from '@/lib/depot/repositories/modelledCrewRepository';
import { modelledFuelRepository } from '@/lib/depot/repositories/modelledFuelRepository';
import { modelledRevenueRepository } from '@/lib/depot/repositories/modelledRevenueRepository';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';

/*
 * A registration the feed repeats (the same text twice, or once
 * with a trailing space) must not give the duty board and crew one day and
 * fuel and revenue another. Both scenarios of the review, through the real
 * response builders.
 */

const FEED_NOW = '2026-10-06T08:00:00Z';
const ROUTES = ['AGRA_EXP_1', 'KANPUR_ORD_2', 'DELHI_AC_3'];

function row(over: Partial<DepotBusRow>): DepotBusRow {
  return {
    registrationNumber: 'UP32A0001', latitude: 26.85, longitude: 80.95, speedKmph: 0,
    ignitionOn: false, gpsTimestamp: FEED_NOW, receivedAt: FEED_NOW, depotId: '1',
    depotName: 'Alambagh', vehicleStatus: 'stationary', tripStatus: 'Stationary', routeId: null,
    routeName: null, routeDescription: null, journeyId: null, journeyCode: null,
    scheduledStart: null, scheduledEnd: null, actualStart: null, delayMinutes: null,
    odometerRaw: null, mainPowerOn: true, mainVoltage: null, tamperCode: 'C', emergency: false,
    ...over,
  };
}

function world(): DepotBusRow[] {
  const depots = ['1', '2', '3', '4', '5', '6'].flatMap((depotId) =>
    Array.from({ length: 40 }, (_, i) =>
      row({
        registrationNumber: `UP${depotId}X${i}`,
        depotId,
        depotName: `Depot ${depotId}`,
        routeName: `${ROUTES[i % 3]}${depotId}`,
      }),
    ),
  );
  // (b) depot 1: a repeat on a new route, and a repeat with a trailing space.
  const repeats = [
    row({ registrationNumber: 'UP1X0', depotName: 'Depot 1', routeName: 'ZZZ_ORD_9' }),
    row({ registrationNumber: 'UP1X1 ', depotName: 'Depot 1', routeName: 'AGRA_EXP_11' }),
  ];
  // (a) depot 7: a bus with no route, then the same bus on a route, then five with none.
  const seven = [
    row({ registrationNumber: 'UP7X0', depotId: '7', depotName: 'Depot 7' }),
    row({ registrationNumber: 'UP7X0', depotId: '7', depotName: 'Depot 7', routeName: 'LKO_ORD_1' }),
    ...Array.from({ length: 5 }, (_, i) =>
      row({ registrationNumber: `UP7Y${i}`, depotId: '7', depotName: 'Depot 7' }),
    ),
  ];
  return [...depots, ...repeats, ...seven];
}

const VIEW: FleetSnapshotView = {
  rows: world(), feedNow: FEED_NOW, fetchedAt: '2026-10-06T08:00:05.000Z', source: 'live',
  stale: false, recordCount: 249,
};
const SOURCES = { revenue: modelledRevenueRepository, fuel: modelledFuelRepository };

beforeEach(() => resetAnalysisForTests());

async function pages(depotId: string) {
  const board = buildDutyBoard(VIEW, depotId);
  const crew = await buildCrewResponse(VIEW, depotId, modelledCrewRepository);
  const fuel = await buildFuelResponse(VIEW, depotId, modelledFuelRepository);
  const revenue = await buildRevenueResponse(VIEW, depotId, SOURCES);
  if (!board || !crew || !fuel || !revenue) throw new Error(`depot ${depotId} is missing`);
  return { board, crew, fuel, revenue };
}

describe('a repeated registration gives every page the same day', () => {
  it('(a) a repeat that first appears without a route: every page shows the same duties', async () => {
    const { board, crew, fuel, revenue } = await pages('7');
    expect(fuel.day).toEqual(revenue.day);
    expect(fuel.day.duties).toBe(board.duties.length);
    expect(crew.day.duties).toBe(board.duties.length);
    expect(revenue.summary.trips + fuel.day.dutiesWithoutBus).toBe(board.duties.length);
    expect(fuel.day.buses).toBe(6);
    expect(board.duplicateRowsDropped).toBe(1);
  });

  it('(b) a repeat on a new route and a space-padded repeat: same routes, one bus each', async () => {
    const { board, crew, fuel, revenue } = await pages('1');
    const boardRoutes = new Set(board.duties.map((d) => d.routeName));
    expect(boardRoutes.has('ZZZ_ORD_9')).toBe(false);
    expect(fuel.day).toEqual(revenue.day);
    expect(fuel.day.duties).toBe(board.duties.length);
    expect(fuel.day.routes).toBe(boardRoutes.size);
    expect(crew.day).toEqual({ duties: board.duties.length, routes: boardRoutes.size });
    expect(fuel.day.buses).toBe(40);
    expect(board.duplicateRowsDropped).toBe(2);
    expect(fuel.day.busesRan + fuel.notRunCount).toBe(fuel.day.buses);
  });
});
