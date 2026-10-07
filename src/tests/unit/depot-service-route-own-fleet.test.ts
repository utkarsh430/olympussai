// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { loadFleetFixture } from '@/lib/upsrtc/fleetFixture';
import { normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { operatingDayFor } from '@/lib/depot/live/operatingDayView';
import { buildRouteHourlyResponse } from '@/lib/depot/live/routeHourlyView';
import { routeTableOf } from '@/lib/depot/live/routeInputs';
import { defaultServiceHoldStore } from '@/lib/depot/live/serviceHold';
import type { FleetSnapshotView, ServiceRepositories } from '@/lib/depot/repositories/types';
import { createMemoryHourlyObservationRepository } from '@/lib/depot/repositories/memoryHourlyObservationRepository';
import { createMemoryScheduledTripRepository } from '@/lib/depot/repositories/memoryScheduledTripRepository';
import { routeDayBoardings } from '@/lib/depot/service/routeDayBoardings';
import type { RouteHourlyResponse } from '@/lib/depot/service/types';

/*
 * On the recorded sample, a route's modelled hours are drawn from the buses the
 * feed shows on the route, so the chart's observed and modelled hours are one
 * route on one scale.
 */

const rows = normalizeDepotRows(loadFleetFixture()).rows;
const BUSY = 'VND_1613_ORD_OUT';
const ROUTES = [BUSY, 'AKP_1577_ORD_OUT'] as const;

const view: FleetSnapshotView = {
  rows,
  feedNow: '2026-10-06T15:38:00.000Z',
  fetchedAt: '2026-10-06T10:08:05.000Z',
  source: 'live',
  stale: false,
  recordCount: rows.length,
};

function services(): ServiceRepositories {
  return {
    hourly: createMemoryHourlyObservationRepository(() => defaultServiceHoldStore()),
    scheduled: createMemoryScheduledTripRepository(),
  };
}

async function body(routeName: string): Promise<RouteHourlyResponse> {
  const result = await buildRouteHourlyResponse(view, { routeName, date: null }, services());
  if (result.status !== 200) throw new Error(`expected 200, got ${result.status}`);
  return result.body;
}

const rowOf = (routeName: string) => routeTableOf(view).find((r) => r.routeName === routeName)!;

beforeEach(() => resetAnalysisForTests());

describe("the route's modelled day is drawn from its own buses", () => {
  it('peaks within a factor of two of the current hour on the busy route', async () => {
    const answer = await body(BUSY);
    const current = answer.hours.find((h) => h.deployedBasis === 'current')!.deployed;
    const peak = Math.max(...answer.hours.filter((h) => h.deployedBasis === 'modelled').map((h) => h.deployed));
    expect(current).toBeGreaterThan(10);
    expect(peak).toBeGreaterThanOrEqual(current / 2);
    expect(peak).toBeLessThanOrEqual(current * 2);
  });

  it('never runs more buses in an hour than the feed shows on the route', async () => {
    for (const routeName of ROUTES) {
      const answer = await body(routeName);
      const fleet = rowOf(routeName).buses;
      expect(answer.hours.every((h) => h.deployed >= 0 && h.deployed <= fleet)).toBe(true);
    }
  });

  it("shares out the route's own day of boardings over the hours", async () => {
    const answer = await body(BUSY);
    const journeyMinutes = answer.need.journeyMinutesProvenance === 'derived' ? answer.need.journeyMinutes : null;
    const day = routeDayBoardings({
      routeName: BUSY,
      operatingDate: answer.operatingDate,
      buses: rowOf(BUSY).buses,
      journeyMinutes,
    });
    expect(answer.hours.reduce((s, h) => s + h.demand, 0)).toBe(day.boardings);
  });

  it('leaves an add without a source only when its depot truly has none', async () => {
    for (const routeName of ROUTES) {
      const answer = await body(routeName);
      const depotId = rowOf(routeName).primaryDepotId ?? rowOf(routeName).operators[0]!.depotId;
      const idle = operatingDayFor(view, depotId)?.notRun.filter((b) => b.reason === 'no_duty').length ?? 0;
      const sourceless = answer.proposals.filter((p) => p.kind === 'add_buses' && p.source === null);
      // One snapshot observes no depot hour, so only the modelled day plan can be a source.
      for (const p of sourceless) {
        expect(p.tier).toBe('C');
        expect(idle).toBe(0);
      }
    }
  });
});
