// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { loadFleetFixture } from '@/lib/upsrtc/fleetFixture';
import { normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import {
  buildRouteHourlyResponse,
  heldRouteHourlyBodies,
  parseRouteHourlyQuery,
  type RouteHourlyQuery,
} from '@/lib/depot/live/routeHourlyView';
import type { FleetSnapshotView, ServiceRepositories } from '@/lib/depot/repositories/types';
import { createMemoryHourlyObservationRepository } from '@/lib/depot/repositories/memoryHourlyObservationRepository';
import { createMemoryScheduledTripRepository } from '@/lib/depot/repositories/memoryScheduledTripRepository';
import { defaultServiceHoldStore } from '@/lib/depot/live/serviceHold';
import type { RouteHourlyResponse } from '@/lib/depot/service/types';
import { routeTableOf } from '@/lib/depot/live/routeInputs';

const rows = normalizeDepotRows(loadFleetFixture()).rows;
/** The recorded sample's own clock reads about 15:38 on 6 October (feed digits). */
const FEED_NOW = '2026-10-06T15:38:00.000Z';
const DATE = '2026-10-06';
const ROUTE = 'VND_1613_ORD_OUT';

function sampleView(over: Partial<FleetSnapshotView> = {}): FleetSnapshotView {
  return {
    rows, feedNow: FEED_NOW, fetchedAt: '2026-10-06T10:08:05.000Z', source: 'live', stale: false,
    recordCount: rows.length, ...over,
  };
}

function services(): ServiceRepositories {
  return {
    hourly: createMemoryHourlyObservationRepository(() => defaultServiceHoldStore()),
    scheduled: createMemoryScheduledTripRepository(),
  };
}

const query = (routeName: string, date: string | null = null): RouteHourlyQuery => ({ routeName, date });

async function body(view: FleetSnapshotView, q: RouteHourlyQuery): Promise<RouteHourlyResponse> {
  const result = await buildRouteHourlyResponse(view, q, services());
  if (result.status !== 200) throw new Error(`expected 200, got ${result.status}`);
  return result.body;
}

beforeEach(() => resetAnalysisForTests());

describe('the route hourly query', () => {
  const parse = (name: unknown, search: string) =>
    parseRouteHourlyQuery(name, new URLSearchParams(search));

  it('takes a valid route name and an optional date', () => {
    expect(parse(ROUTE, '')).toEqual({ ok: true, query: { routeName: ROUTE, date: null } });
    expect(parse(ROUTE, `date=${DATE}`)).toEqual({ ok: true, query: { routeName: ROUTE, date: DATE } });
  });

  it('refuses a bad name, an unknown or repeated parameter and a malformed date', () => {
    for (const [name, search] of [
      ['../x', ''],
      [42, ''],
      [ROUTE, 'days=3'],
      [ROUTE, `date=${DATE}&date=${DATE}`],
      [ROUTE, 'date=6-10-2026'],
      [ROUTE, 'date=2026-02-30'],
    ] as const) {
      expect(parse(name, search)).toEqual({ ok: false });
    }
  });
});

describe('one route, hour by hour, on the recorded sample', () => {
  it('answers 24 hours with the current hour from the feed clock and the rest modelled', async () => {
    const answer = await body(sampleView(), query(ROUTE));
    expect(answer.routeName).toBe(ROUTE);
    expect(answer.operatingDate).toBe(DATE);
    expect(answer.currentHour).toBe(15);
    expect(answer.hours).toHaveLength(24);
    expect(answer.hours.map((h) => h.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(answer.hours[15]?.deployedBasis).toBe('current');
    expect(answer.hours.filter((h) => h.hour !== 15).every((h) => h.deployedBasis === 'modelled')).toBe(true);
    // The current hour counts the route's buses in service or on the road; standing is apart.
    const row = routeTableOf(sampleView()).find((r) => r.routeName === ROUTE)!;
    expect(row.states.standing).toBeGreaterThan(0);
    expect(answer.hours[15]?.deployed).toBe(row.states.inService + row.states.onRoad);
    expect(answer.standingNow).toBe(row.states.standing);
    // The modelled day runs the route in some hours, and demand needs buses in some.
    expect(answer.hours.some((h) => h.deployedBasis === 'modelled' && h.deployed > 0)).toBe(true);
    expect(answer.hours.some((h) => h.needed > 0)).toBe(true);
    expect(answer.hours.every((h) => h.gap === Math.round((h.needed - h.deployed) * 10) / 10)).toBe(true);
  });

  it('carries the need, the coverage, punctuality and the envelope', async () => {
    const answer = await body(sampleView(), query(ROUTE));
    expect(answer.need.routeName).toBe(ROUTE);
    expect(answer.need.journeyMinutes).toBeGreaterThan(0);
    expect(answer.serviceClass).toBe(answer.need.serviceClass);
    expect(answer.routeCoverage.of).toBe(rows.length);
    expect(answer.routeCoverage.n).toBeGreaterThan(0);
    expect(answer.routeCoverage.n).toBeLessThan(answer.routeCoverage.of);
    expect(answer.scheduledCoverage.n).toBeLessThanOrEqual(answer.scheduledCoverage.of);
    expect(answer.reliability).toHaveLength(24);
    expect(answer.demandBasis.length).toBeGreaterThan(0);
    expect(answer).toMatchObject({ feedNow: FEED_NOW, source: 'live', stale: false });
    // One snapshot is one sample slot: no hour is observed yet.
    expect(answer.observed?.samples ?? 0).toBeLessThanOrEqual(1);
  });

  it('places the journeys of the day the feed reported on the route as scheduled supply', async () => {
    const answer = await body(sampleView(), query(ROUTE));
    // A reported journey is one trip of a bus, not its day: no bus day is recorded yet.
    expect(answer.scheduledCoverage.n).toBe(0);
    // The route's journey of the day starts at 11:01 and runs past 19:00.
    expect(answer.hours[11]?.scheduledTripsStarting).toBeGreaterThanOrEqual(1);
    expect(answer.hours[12]?.scheduled).toBeGreaterThan(0);
  });

  it('gives each proposal a reason and an id, or none with an empty list', async () => {
    const answer = await body(sampleView(), query(ROUTE));
    for (const p of answer.proposals) {
      expect(p.routeName).toBe(ROUTE);
      expect(p.reason.length).toBeGreaterThan(20);
      expect(p.id).toMatch(/^p-[0-9a-f]{8}$/);
      if (p.kind === 'add_buses' && p.source?.standingInYard !== null && p.source !== null) {
        expect(p.change).toBeLessThanOrEqual(p.source.standingInYard ?? Infinity);
      }
    }
  });

  it('has no feed clock hour without a feed clock', async () => {
    const answer = await body(sampleView({ feedNow: null }), query(ROUTE));
    expect(answer.currentHour).toBeNull();
    expect(answer.hours.every((h) => h.deployedBasis === 'modelled')).toBe(true);
  });

  it('answers the fixed 404 for a route the snapshot does not carry', async () => {
    const result = await buildRouteHourlyResponse(sampleView(), query('NO_SUCH_ROUTE'), services());
    expect(result).toEqual({ status: 404, body: { error: 'Route not found' } });
  });

  it('answers the fixed 400 for a date other than the feed date', async () => {
    const result = await buildRouteHourlyResponse(sampleView(), query(ROUTE, '2026-10-05'), services());
    expect(result).toEqual({ status: 400, body: { error: 'Invalid query' } });
    expect((await buildRouteHourlyResponse(sampleView(), query(ROUTE, DATE), services())).status).toBe(200);
  });

  it('holds one body per route for the snapshot, with a fresh envelope per request', async () => {
    const view = sampleView();
    const first = await body(view, query(ROUTE));
    const stale = await body({ ...view, stale: true }, query(ROUTE));
    expect(stale.hours).toBe(first.hours);
    expect(stale.proposals).toBe(first.proposals);
    expect(first.stale).toBe(false);
    expect(stale.stale).toBe(true);
    expect(heldRouteHourlyBodies(view)).toBe(1);
    await buildRouteHourlyResponse(view, query('NO_SUCH_ROUTE'), services());
    expect(heldRouteHourlyBodies(view)).toBe(1);
  });
});
