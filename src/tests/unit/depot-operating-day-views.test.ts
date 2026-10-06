// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildEconomicsResponse } from '@/lib/depot/live/economicsView';
import { buildFuelResponse } from '@/lib/depot/live/fuelView';
import { buildRevenueResponse } from '@/lib/depot/live/revenueView';
import { modelledFuelRepository } from '@/lib/depot/repositories/modelledFuelRepository';
import { modelledRevenueRepository } from '@/lib/depot/repositories/modelledRevenueRepository';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { emptyText } from '@/lib/depot/fuel/fuelPageModel';
import { modelledDaySentence, NO_DUTIES_REASON } from '@/lib/depot/sim/operatingDayWording';

/*
 * The pages side by side, through the real views: for one depot and feed date
 * the duty board, the fuel page, the revenue page and the economics ranking
 * all describe the same modelled day.
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

/** Six depots of 40 buses, so they share a peer group; depot 9 reports no route at all. */
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
  const idle = Array.from({ length: 40 }, (_, i) =>
    row({ registrationNumber: `UP9X${i}`, depotId: '9', depotName: 'Depot 9' }),
  );
  return [...depots, ...idle];
}

const VIEW: FleetSnapshotView = {
  rows: world(), feedNow: FEED_NOW, fetchedAt: '2026-10-06T08:00:05.000Z', source: 'live',
  stale: false, recordCount: 280,
};
const SOURCES = { revenue: modelledRevenueRepository, fuel: modelledFuelRepository };

beforeEach(() => resetAnalysisForTests());

describe('one modelled day behind every page', () => {
  it('the economics index uses the fuel page’s cost per kilometre and ranks without profiles', async () => {
    const economics = await buildEconomicsResponse(VIEW, SOURCES);
    for (const depotId of ['1', '2', '3']) {
      const fuel = await buildFuelResponse(VIEW, depotId, modelledFuelRepository);
      const entry = economics.depots.find((d) => d.depotId === depotId);
      const cost = entry?.score.components.find((c) => c.key === 'costPerKm');
      expect(fuel?.totals.costPerKm).not.toBeNull();
      expect(cost?.value).toBe(fuel?.totals.costPerKm);
      expect(entry?.score.missing).toEqual([]);
      expect(entry?.lengthCoverage.n).toBe(0);
    }
    // No route has a profile here, and the depots are still ranked (ruling S39).
    expect(economics.depots.filter((d) => d.score.ranked).length).toBeGreaterThanOrEqual(5);
  });

  it('a depot with no duties says so in the same words on every page', async () => {
    const fuel = await buildFuelResponse(VIEW, '9', modelledFuelRepository);
    const revenue = await buildRevenueResponse(VIEW, '9', SOURCES);
    expect(fuel?.day).toMatchObject({ duties: 0, routes: 0, busesRan: 0, buses: 40 });
    expect([fuel?.totals.distanceKm, fuel?.notRunCount]).toEqual([0, 40]);
    expect([revenue?.summary.trips, revenue?.routes.length]).toEqual([0, 0]);
    const sentence = modelledDaySentence({ scheduled: { n: 0, of: 40 }, duties: 0, routes: 0 });
    // The crew page model keeps its own copy of this sentence; it is not in this unit's files.
    for (const text of [sentence, emptyText(fuel?.day)]) {
      expect(text).toContain(NO_DUTIES_REASON);
    }
  });

  it('names the date, says how the day is rebuilt, and never says today or ran (review M2, M6)', () => {
    expect(
      modelledDaySentence({ scheduled: { n: 5, of: 200 }, duties: 158, routes: 14, operatingDate: '2026-10-06' }),
    ).toBe(
      "The live feed carries a schedule for 5 of 200 of this depot's buses at the feed time. This page is built on the modelled day for 2026-10-06, rebuilt from the live fleet as of the feed time: 158 duties on 14 routes.",
    );
    const empty = modelledDaySentence({ scheduled: null, duties: 0, routes: 0, operatingDate: '2026-10-06' });
    expect(empty).toBe(
      'No duties are modelled for this depot for 2026-10-06 (no route is seen running from it), so this page has no modelled day to show.',
    );
    for (const text of [empty, modelledDaySentence({ scheduled: { n: 1, of: 2 }, duties: 3, routes: 1 })]) {
      expect(text).not.toMatch(/today|\bran\b|simulated/i);
      expect(text).toMatch(/modelled/);
    }
  });
});
