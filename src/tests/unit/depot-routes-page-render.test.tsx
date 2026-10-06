import { renderToStaticMarkup } from 'react-dom/server';
import { TRIP_DEFINITION } from '@/lib/depot/sim/tripFrequencyConfig';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoutesPage } from '@/components/depot/routes/RoutesPage';
import { RECOMMENDATION_ONLY } from '@/lib/depot/routes/allocationWording';
import type { DepotAllocationResponse, DepotRoutesResponse, RouteListItem } from '@/lib/depot/routes/api';

interface Slot<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

const state = vi.hoisted(() => ({
  routes: null as unknown,
  allocation: null as unknown,
}));

vi.mock('@/hooks/useDepotRoutes', () => ({ useDepotRoutes: (): unknown => state.routes }));
vi.mock('@/hooks/useDepotAllocation', () => ({ useDepotAllocation: (): unknown => state.allocation }));

function slot<T>(partial: Partial<Slot<T>>): Slot<T> {
  return { data: null, error: null, loading: false, refresh: () => {}, ...partial };
}

const TRIP_MODEL = {
  factorMin: 1, factorMax: 2, shortRouteMin: 90, longRouteMin: 480, unknownDurationFactor: 1.5, noise: 0.15,
};
const ENVELOPE = {
  feedNow: '2026-10-06T14:02:00Z', fetchedAt: '2026-10-06T14:02:05.000Z', source: 'live' as const,
  stale: false, operatingDate: '2026-10-06', depotId: null, profileEndpoint: '/api/upsrtc/depot/route/{routeName}',
};

const ROUTE: RouteListItem = {
  routeName: 'AGRA-DELHI ORD', routeId: null, description: null, serviceToken: 'ORD', direction: null,
  buses: 5, operators: [{ depotId: '1', depotName: 'AGRA', buses: 3 }, { depotId: '2', depotName: 'MATHURA', buses: 2 }],
  primaryDepotId: '1', states: { inService: 5, onRoad: 0, standing: 0, dark: 0, offRoad: 0 },
  delay: { medianMin: 4, lateShare: 0.2, coverage: { n: 5, of: 5 } }, profiled: true, firstStop: 'A', lastStop: 'B',
  lengthKm: 200, scheduledDurationMin: 300, tripsPerDay: { value: 7, provenance: 'modelled' },
  tripsBasis: 'buses_and_duration', deadKm: null,
};

const ROUTES: DepotRoutesResponse = {
  ...ENVELOPE, routes: [ROUTE], coverage: { profiled: { n: 1, of: 2 }, tripsOnDuration: { n: 1, of: 2 } },
  tripModel: TRIP_MODEL, serviceClass: null, q: null, sort: null, total: 1, inFeed: 2, offset: 0, limit: 25,
  depotOptions: [{ value: '1', label: 'AGRA' }], classOptions: [{ value: 'ORD', label: 'ORD' }],
  tripDefinition: TRIP_DEFINITION,
};

const FIG = (value: number) => ({ value, provenance: 'modelled' as const, coverage: { n: 1, of: 2 } });

const PLAN: DepotAllocationResponse = {
  ...ENVELOPE, recommendationOnly: true,
  coverage: { profiled: { n: 1, of: 2 }, planned: { n: 1, of: 2 } },
  depotPositions: { yard: 1, median: 1, none: 0, provenance: 'derived' },
  beforeKmPerDay: FIG(140), afterKmPerDay: FIG(70), savedKmPerDay: FIG(70),
  moves: [{
    routeName: 'AGRA-DELHI ORD', fromDepotId: '1', toDepotId: '2', busesNeeded: 5, savedKmPerDay: 0, madeRoom: true,
    fromDepotName: 'AGRA', toDepotName: 'MATHURA', tripsPerDay: 7, fromDeadKmPerTrip: 10, toDeadKmPerTrip: 10,
  }],
  unchanged: [{ routeName: 'X', depotId: '1', depotName: 'AGRA', reason: 'already_best', tripsPerDay: 2, deadKmPerTrip: 3 }],
  excluded: [{ routeName: 'Y', primaryDepotId: '2', depotName: 'KANPUR', buses: 1, reason: 'not_profiled' }],
  reason: null, q: null, offset: 0, limit: 0, unchangedTotal: 1, excludedTotal: 1,
  unchangedByReason: { no_candidate: 0, already_best: 1, below_threshold: 0, over_capacity: 0, move_limit: 0, no_capacity: 0 },
  excludedByReason: {
    no_primary_depot: 0, unassigned_bucket: 0, operator_not_depot: 0, bus_count_over_cap: 0,
    not_profiled: 1, too_few_located_stops: 0, no_depot_position: 0,
  },
  profilesPending: true, profilesPendingNote: 'New route profiles will be included in the next plan, within half a minute.',
  tripDefinition: TRIP_DEFINITION,
  provenance: { deadKmPerTrip: 'derived', tripsPerDay: 'modelled', kmPerDay: 'modelled', capacity: 'modelled' },
  params: { minSavingKmPerDay: 5, maxMoves: 200, detourFactor: 1.3, tripModel: TRIP_MODEL },
};

const textOf = (markup: string): string => markup.replace(/<[^>]*>/g, '');

describe('RoutesPage states', () => {
  beforeEach(() => {
    state.routes = slot({ data: ROUTES });
    state.allocation = slot({ data: PLAN });
  });

  it('shows the page footprint while neither response has arrived', () => {
    state.routes = slot({ loading: true });
    state.allocation = slot({ loading: true });
    expect(renderToStaticMarkup(<RoutesPage />)).toContain('data-testid="routes-loading"');
  });

  it('says why there is nothing when the feed carries no route', () => {
    state.routes = slot({ data: { ...ROUTES, routes: [], total: 0, inFeed: 0 } });
    const markup = renderToStaticMarkup(<RoutesPage />);
    expect(markup).toContain('data-testid="depot-empty"');
    expect(textOf(markup)).toContain('no bus carrying a route name');
  });

  it('keeps the route table when only the plan fails, with a Retry', () => {
    state.allocation = slot({ error: 'Depot data unavailable' });
    const markup = renderToStaticMarkup(<RoutesPage />);
    expect(markup).toContain('data-testid="depot-error"');
    expect(textOf(markup)).toContain('AGRA-DELHI ORD');
  });

  it('shows a stale strip with the feed time when the data is stale', () => {
    state.routes = slot({ data: { ...ROUTES, stale: true } });
    expect(textOf(renderToStaticMarkup(<RoutesPage />))).toContain('Showing last good data from 14:02');
  });
});

describe('RoutesPage content', () => {
  beforeEach(() => {
    state.routes = slot({ data: ROUTES });
    state.allocation = slot({ data: PLAN });
  });

  it('says recommendation only exactly once, and never "simulated"', () => {
    const text = textOf(renderToStaticMarkup(<RoutesPage />));
    expect(text.split(RECOMMENDATION_ONLY)).toHaveLength(2);
    expect(text.toLowerCase()).not.toContain('simulated');
  });

  it('tags modelled and derived figures in words and marks a move made to make room', () => {
    const markup = renderToStaticMarkup(<RoutesPage />);
    expect(markup).toContain('data-provenance="modelled"');
    expect(markup).toContain('data-provenance="derived"');
    expect(textOf(markup)).toContain('moved to make room, no saving of its own');
    expect(textOf(markup)).toContain('1 of 2 routes have no known profile yet');
  });

  it('links depot names into the depot scope and keeps unmoved groups collapsed', () => {
    const markup = renderToStaticMarkup(<RoutesPage />);
    expect(markup).toContain('href="/project/depots/d/1"');
    expect(markup).toContain('<details');
    expect(markup).not.toContain('<details open');
    expect(textOf(markup)).toContain('Already at its nearest depot.');
    expect(markup).not.toMatch(/\shidden(=|\s|>)/);
  });
});
