import { TRIP_DEFINITION } from '@/lib/depot/sim/tripFrequencyConfig';
import type { DepotAllocationResponse, DepotRoutesResponse, RouteListItem } from '@/lib/depot/routes/api';

/** Shared fixtures for the routes page tests: one route, one plan with one move. */
export interface Slot<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

export function slot<T>(partial: Partial<Slot<T>>): Slot<T> {
  return { data: null, error: null, loading: false, refresh: () => {}, ...partial };
}

const TRIP_MODEL = {
  factorMin: 1, factorMax: 2, shortRouteMin: 90, longRouteMin: 480, unknownDurationFactor: 1.5, noise: 0.15,
};
const ENVELOPE = {
  feedNow: '2026-10-06T14:02:00Z', fetchedAt: '2026-10-06T14:02:05.000Z', source: 'live' as const,
  stale: false, operatingDate: '2026-10-06', depotId: null, profileEndpoint: '/api/upsrtc/depot/route/{routeName}',
};

export const ROUTE_FIXTURE: RouteListItem = {
  routeName: 'AGRA-DELHI ORD', routeId: null, description: null, serviceToken: 'ORD', direction: null,
  buses: 5, operators: [{ depotId: '1', depotName: 'AGRA', buses: 3 }, { depotId: '2', depotName: 'MATHURA', buses: 2 }],
  primaryDepotId: '1', states: { inService: 5, onRoad: 0, standing: 0, dark: 0, offRoad: 0 },
  delay: { medianMin: 4, lateShare: 0.2, coverage: { n: 5, of: 5 } }, profiled: true, firstStop: 'A', lastStop: 'B',
  lengthKm: 200, scheduledDurationMin: 300, tripsPerDay: { value: 7, provenance: 'modelled' },
  tripsBasis: 'buses_and_duration', deadKm: null,
};

export const ROUTES_FIXTURE: DepotRoutesResponse = {
  ...ENVELOPE, routes: [ROUTE_FIXTURE], coverage: { profiled: { n: 1, of: 2 }, tripsOnDuration: { n: 1, of: 2 } },
  tripModel: TRIP_MODEL, serviceClass: null, q: null, sort: null, total: 1, inFeed: 2, offset: 0, limit: 25,
  depotOptions: [{ value: '1', label: 'AGRA' }, { value: '2', label: 'MATHURA' }],
  classOptions: [{ value: 'ORD', label: 'ORD' }],
  tripDefinition: TRIP_DEFINITION,
};

const FIG = (value: number) => ({ value, provenance: 'modelled' as const, coverage: { n: 1, of: 2 } });

export const PLAN_FIXTURE: DepotAllocationResponse = {
  ...ENVELOPE, recommendationOnly: true,
  plannedAt: ENVELOPE.feedNow,
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

/** A plan with nothing measurable: no route has its details loaded yet. */
export const EMPTY_PLAN_FIXTURE: DepotAllocationResponse = {
  ...PLAN_FIXTURE,
  coverage: { profiled: { n: 0, of: 2 }, planned: { n: 0, of: 2 } },
  beforeKmPerDay: FIG(0), afterKmPerDay: FIG(0), savedKmPerDay: FIG(0),
  moves: [], unchanged: [], unchangedTotal: 0, profilesPending: false, profilesPendingNote: null,
  unchangedByReason: { ...PLAN_FIXTURE.unchangedByReason, already_best: 0 },
  excluded: [], excludedTotal: 2,
  excludedByReason: { ...PLAN_FIXTURE.excludedByReason, not_profiled: 2 },
};
