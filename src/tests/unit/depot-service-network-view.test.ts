// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { loadFleetFixture } from '@/lib/upsrtc/fleetFixture';
import { normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import {
  buildNetworkHourlyResponse,
  heldNetworkHourlyBodies,
  parseNetworkHourlyQuery,
  type NetworkHourlyQuery,
} from '@/lib/depot/live/networkHourlyView';
import { buildRouteHourlyResponse } from '@/lib/depot/live/routeHourlyView';
import type { FleetSnapshotView, ServiceRepositories } from '@/lib/depot/repositories/types';
import { createMemoryHourlyObservationRepository } from '@/lib/depot/repositories/memoryHourlyObservationRepository';
import { createMemoryScheduledTripRepository } from '@/lib/depot/repositories/memoryScheduledTripRepository';
import { createServiceHoldStore } from '@/lib/depot/live/serviceHold';
import type { NetworkHourlyResponse } from '@/lib/depot/service/types';

const rows = normalizeDepotRows(loadFleetFixture()).rows;
/** The recorded sample's own clock reads about 15:38 on 6 October (feed digits). */
const FEED_NOW = '2026-10-06T15:38:00.000Z';

const view: FleetSnapshotView = {
  rows, feedNow: FEED_NOW, fetchedAt: '2026-10-06T10:08:05.000Z', source: 'live', stale: false,
  recordCount: rows.length,
};

function services(): ServiceRepositories {
  return {
    hourly: createMemoryHourlyObservationRepository(createServiceHoldStore()),
    scheduled: createMemoryScheduledTripRepository(),
  };
}

const query = (over: Partial<NetworkHourlyQuery> = {}): NetworkHourlyQuery => ({
  band: null, depotId: null, page: 0, ...over,
});

async function body(q: NetworkHourlyQuery): Promise<NetworkHourlyResponse> {
  const result = await buildNetworkHourlyResponse(view, q, services());
  if (result.status !== 200) throw new Error(`expected 200, got ${result.status}`);
  return result.body;
}

beforeEach(() => resetAnalysisForTests());

describe('the network hourly query', () => {
  const parse = (search: string) => parseNetworkHourlyQuery(new URLSearchParams(search));

  it('takes an optional band, depot and page', () => {
    expect(parse('')).toEqual({ ok: true, query: { band: null, depotId: null, page: 0 } });
    expect(parse('band=midday&depot=12&page=2')).toEqual({
      ok: true, query: { band: 'midday', depotId: '12', page: 2 },
    });
  });

  it('refuses an unknown band, a bad depot or page, an unknown or repeated parameter', () => {
    for (const search of ['band=night', 'depot=../x', 'page=-1', 'page=1.5', 'page=999', 'x=1', 'band=early&band=late']) {
      expect(parse(search), search).toEqual({ ok: false });
    }
  });
});

describe('the network hourly view on the recorded sample', () => {
  it('answers the evening peak by default at 15:38, with every band tallied', async () => {
    const b = await body(query());
    expect(b.band).toBe('evening_peak');
    expect(b.nextPeak).toBe('evening_peak');
    expect(b.currentHour).toBe(15);
    expect(b.bands.map((x) => x.band)).toEqual(['early', 'morning_peak', 'midday', 'evening_peak', 'late']);
    expect(b.routes.rows.length).toBeLessThanOrEqual(25);
    expect(b.routes.total).toBeGreaterThan(25);
    expect(b.routes.rows[0]?.gaps).toHaveLength(24);
    expect(b.feedNow).toBe(FEED_NOW);
  });

  it('orders the strips by the band’s peak gap, largest first', async () => {
    const strips = (await body(query({ band: 'morning_peak' }))).routes.rows;
    for (let i = 1; i < strips.length; i += 1) {
      expect(strips[i - 1]!.peakGap).toBeGreaterThanOrEqual(strips[i]!.peakGap);
    }
  });

  it('shows a route as its own day page shows it', async () => {
    const b = await body(query({ band: 'midday' }));
    const strip = b.routes.rows[0]!;
    const route = await buildRouteHourlyResponse(view, { routeName: strip.routeName, date: null }, services());
    if (route.status !== 200) throw new Error('route not found');
    expect(strip.gaps).toEqual(route.body.hours.map((h) => h.gap));
  });

  it('keeps totals consistent with the band tally and the reallocation', async () => {
    const b = await body(query({ band: 'evening_peak' }));
    const tally = b.bands.find((x) => x.band === 'evening_peak')!;
    expect(b.totals.busesShort).toBe(tally.busesShort);
    expect(b.totals.movesWithin).toBe(b.reallocation.busesWithin);
    expect(b.totals.movesBetween).toBe(b.reallocation.busesBetween);
    const moved = b.reallocation.moves.reduce((s, m) => s + m.buses, 0);
    expect(moved + b.totals.uncovered).toBe(b.totals.busesShort);
    expect(b.totals.passengersPerDay.low).toBeLessThanOrEqual(b.totals.passengersPerDay.high);
    for (const p of b.proposals) expect(['changes', 'findings', 'network']).toContain(p.group);
  });

  it('filters to one depot, and answers the fixed 404 for a depot the snapshot lacks', async () => {
    const all = await body(query());
    const depotId = all.depots[0]!.depotId;
    const own = await body(query({ depotId }));
    expect(own.depotId).toBe(depotId);
    expect(own.routes.rows.every((r) => r.depotId === depotId)).toBe(true);
    expect(own.routes.total).toBeLessThan(all.routes.total);
    const missing = await buildNetworkHourlyResponse(view, query({ depotId: '99999' }), services());
    expect(missing).toEqual({ status: 404, body: { error: 'Depot not found' } });
  });

  it('holds each selection per snapshot, the envelope built per request', async () => {
    const first = await body(query({ band: 'late' }));
    const second = await body(query({ band: 'late' }));
    expect(second.proposals).toBe(first.proposals);
    await body(query({ band: 'early' }));
    expect(heldNetworkHourlyBodies(view)).toBe(2);
  });
});
