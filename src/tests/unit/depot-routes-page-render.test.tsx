import { renderToStaticMarkup } from 'react-dom/server';
import { TRIP_DEFINITION } from '@/lib/depot/sim/tripFrequencyConfig';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoutesPage } from '@/components/depot/routes/RoutesPage';
import { RECOMMENDATION_ONLY } from '@/lib/depot/routes/allocationWording';
import type { DepotAllocationResponse, DepotRoutesResponse, RouteListItem } from '@/lib/depot/routes/api';
import { EMPTY_PLAN_FIXTURE } from './depot-routes.fixtures';

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

vi.mock('@/hooks/useDepotRoutes', async (original) => ({
  ...(await original<typeof import('@/hooks/useDepotRoutes')>()),
  useDepotRoutes: (): unknown => state.routes,
}));
vi.mock('@/hooks/useDepotAllocation', () => ({ useDepotAllocation: (): unknown => state.allocation }));
vi.mock('next/navigation', () => ({ useSearchParams: (): URLSearchParams => new URLSearchParams() }));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({ data: { depots: [{ id: '1', assigned: 3 }] }, error: null }),
}));

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

describe('RoutesPage recommended moves', () => {
  beforeEach(() => {
    state.routes = slot({ data: ROUTES });
    state.allocation = slot({ data: PLAN });
  });

  it('carries one MODELLED tag on the moves label, none in its headers, SAVING KM/DAY in full', () => {
    const markup = renderToStaticMarkup(<RoutesPage />);
    const label = markup.slice(
      markup.indexOf('data-testid="moves-label"'),
      markup.indexOf('aria-label="Recommended moves"'),
    );
    expect(label).toContain('data-provenance="modelled"');
    const table = markup.slice(markup.indexOf('aria-label="Recommended moves"'));
    const head = table.slice(0, table.indexOf('</thead>'));
    expect(head).not.toContain('data-provenance="modelled"');
    expect(textOf(head)).toContain('Saving km/day');
  });

  it('says the trip definition only in the closing disclosure, not between band and moves', () => {
    const markup = renderToStaticMarkup(<RoutesPage />);
    const section = markup.slice(markup.indexOf('id="allocation-title"'), markup.indexOf('route-table-title'));
    expect(textOf(section)).not.toContain(TRIP_DEFINITION);
    const method = markup.slice(markup.indexOf('data-testid="routes-method"'));
    expect(textOf(method)).toContain(TRIP_DEFINITION);
  });
});

describe('RoutesPage plan panel', () => {
  beforeEach(() => {
    state.routes = slot({ data: ROUTES });
  });

  it('puts the plan panel above the route table and states the thresholds in a title', () => {
    state.allocation = slot({ data: PLAN });
    const markup = renderToStaticMarkup(<RoutesPage />);
    expect(markup.indexOf('allocation-title')).toBeLessThan(markup.indexOf('route-table-title'));
    expect(markup).toContain('title="The plan moves a route only for a saving of at least 5 km a day');
    expect(textOf(markup)).toContain(TRIP_DEFINITION);
    expect(textOf(markup)).toContain('within half a minute');
    expect(markup).toContain('data-testid="route-profile-loader"');
  });

  it('puts the route table on fixed rows with the delay unit in its header', () => {
    state.allocation = slot({ data: PLAN });
    const markup = renderToStaticMarkup(<RoutesPage />);
    expect(markup).toContain('depot-table depot-table-fixed');
    expect(textOf(markup)).toContain('Delay min');
    expect(markup).toContain('title="Median delay of the buses with a usable delay, in minutes"');
    expect(textOf(markup)).not.toMatch(/\d min</);
    // the basis is the delay cells' title, not a column of sentences
    expect(markup).toContain('title="based on 5 of 5 buses"');
  });

  it('has one pager, under the table, and no range sentence or top pager', () => {
    state.allocation = slot({ data: PLAN });
    const many = { ...ROUTES, total: 1271, inFeed: 1271 };
    state.routes = slot({ data: many });
    const markup = renderToStaticMarkup(<RoutesPage />);
    expect(textOf(markup)).toContain('Rows 1 to 25 of 1,271');
    expect(markup.indexOf('data-testid="depot-pager"')).toBeGreaterThan(markup.indexOf('</table>'));
    expect(textOf(markup)).not.toMatch(/Showing \d|Page \d+ of/);
    expect(markup).toContain('data-testid="depot-filter-row"');
  });

  it('hides the pager at 25 rows or fewer', () => {
    state.allocation = slot({ data: PLAN });
    expect(renderToStaticMarkup(<RoutesPage />)).not.toContain('data-testid="depot-pager"');
  });

  it('is one row, the sentence and the loader on its default depot, when nothing can be planned', () => {
    state.allocation = slot({ data: EMPTY_PLAN_FIXTURE });
    const markup = renderToStaticMarkup(<RoutesPage />);
    const section = markup.slice(markup.indexOf('id="allocation-title"'), markup.indexOf('route-table-title'));
    expect(textOf(section)).toContain("No route can be planned yet: no route&#x27;s details have been loaded.");
    expect(section).toContain('data-testid="route-profile-loader"');
    expect(section).not.toContain('data-testid="depot-figure-band"');
    expect(section).not.toContain('data-testid="depot-state-panel"');
    // the explanations live in the closing disclosure, not in the row
    expect(textOf(section)).not.toContain(TRIP_DEFINITION);
    expect(textOf(section)).not.toContain('Each route is one lookup');
    expect(textOf(section)).not.toContain('One lookup on the route-details service');
    expect(section).toMatch(/<option value="1" selected="">AGRA · 3 buses on routes<\/option>/);
    const method = markup.slice(markup.indexOf('data-testid="routes-method"'));
    expect(textOf(method)).toContain(TRIP_DEFINITION);
    expect(textOf(method)).toContain('Lookups run one at a time, at most 40 a press.');
    expect(textOf(method)).toContain('Each route is one lookup on the route-details service.');
    expect(textOf(method)).toContain('at most 40 a press and never by itself');
  });
});
