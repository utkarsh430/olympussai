import { DEFAULT_REBALANCE_PARAMS } from '../optimise/config';
import type { FleetSnapshotView } from '../repositories/types';
import {
  ROUTE_PROFILE_ENDPOINT,
  type DepotRoutesResponse,
  type RouteDeadKm,
  type RouteListItem,
  type RoutesCoverage,
} from '../routes/api';
import { deadKmFor } from '../routes/deadKm';
import { depotPositions, type DepotPosition } from '../routes/depotPositions';
import type { RouteRow } from '../routes/routeTableTypes';
import type { RouteProfile } from '../routes/types';
import { modelTripsPerDay } from '../sim/tripFrequency';
import { TRIP_DEFINITION, TRIP_MODEL_PARAMS } from '../sim/tripFrequencyConfig';
import {
  classOptions,
  depotOptions,
  inClass,
  nameMatches,
  pageItems,
  sortRoutes,
} from '../routes/routeListing';
import type { RoutesQuery } from '../routes/routeQuery';
import type { FilterOption } from '../routes/api';
import { feedEnvelope } from './analysis';
import { coverageOf, memoiseOnCatalogue, operatedBy } from './routeInputs';

export { parseRoutesQuery } from '../routes/routeQuery';

interface RoutesBody {
  readonly operatingDate: string;
  readonly routes: readonly RouteListItem[];
  readonly depotOptions: readonly FilterOption[];
  readonly classOptions: readonly FilterOption[];
}

/** The route table is cheap to rebuild, so a newly cached profile shows on the next request. */
const ROUTES_MIN_REBUILD_MS = 0;

function deadKmFromPrimary(
  row: RouteRow,
  profile: RouteProfile | undefined,
  positions: ReadonlyMap<string, DepotPosition>,
): RouteDeadKm | null {
  if (!profile || row.primaryDepotId === null) return null;
  const depot = positions.get(row.primaryDepotId);
  if (!depot) return null;
  const deadKm = deadKmFor(depot.position, profile, DEFAULT_REBALANCE_PARAMS.detourFactor);
  if (deadKm === null) return null;
  return {
    ...deadKm,
    depotId: row.primaryDepotId,
    depotPosition: depot.kind,
    provenance: 'derived',
  };
}

function listItem(
  row: RouteRow,
  profile: RouteProfile | undefined,
  positions: ReadonlyMap<string, DepotPosition>,
  operatingDate: string,
): RouteListItem {
  const duration = profile?.scheduledDurationMin ?? null;
  const trips = modelTripsPerDay(
    { routeName: row.routeName, buses: row.buses, scheduledDurationMin: duration },
    operatingDate,
  );
  return {
    ...row,
    profiled: profile !== undefined,
    firstStop: profile?.origin?.name ?? null,
    lastStop: profile?.destination?.name ?? null,
    lengthKm: profile?.lengthKm ?? null,
    scheduledDurationMin: duration,
    tripsPerDay: { value: trips.tripsPerDay, provenance: 'modelled' },
    tripsBasis: trips.basis,
    deadKm: deadKmFromPrimary(row, profile, positions),
  };
}

/*
 * Every route in the snapshot, with whichever profiles are already cached. The
 * body is shared by every request on the same rows until another profile is
 * cached or the day turns; the envelope is this request's own.
 */
const routesBody = memoiseOnCatalogue<RoutesBody>(
  ({ analysis, table, profiles, operatingDate }) => {
    const positions = depotPositions(analysis.depots, analysis.yards);
    const routes = table.map((row) =>
      listItem(row, profiles.get(row.routeName), positions, operatingDate),
    );
    return {
      operatingDate,
      routes,
      depotOptions: depotOptions(routes),
      classOptions: classOptions(routes),
    };
  },
  ROUTES_MIN_REBUILD_MS,
);

function coverage(routes: readonly RouteListItem[]): RoutesCoverage {
  return {
    profiled: coverageOf(routes, (r) => r.profiled),
    tripsOnDuration: coverageOf(routes, (r) => r.tripsBasis === 'buses_and_duration'),
  };
}

function matching(routes: readonly RouteListItem[], query: RoutesQuery): readonly RouteListItem[] {
  const { depotId, serviceClass, q } = query;
  if (depotId === null && serviceClass === null && q === null) return routes;
  return routes.filter(
    (r) =>
      (depotId === null || operatedBy(r, depotId)) &&
      inClass(r, serviceClass) &&
      nameMatches(r.routeName, q),
  );
}

/**
 * One page of the route table, filtered and sorted before paging; never
 * fetches a profile. Totals, coverage and the filter options are true for
 * the whole list, so the page never needs all of it.
 */
export function buildRoutesResponse(
  view: FleetSnapshotView,
  query: RoutesQuery,
): DepotRoutesResponse {
  const { body } = routesBody(view, 0);
  const filtered = sortRoutes(matching(body.routes, query), query.sort);
  return {
    ...feedEnvelope(view),
    operatingDate: body.operatingDate,
    depotId: query.depotId,
    serviceClass: query.serviceClass,
    q: query.q,
    sort: query.sort,
    routes: pageItems(filtered, query),
    total: filtered.length,
    inFeed: body.routes.length,
    offset: query.offset,
    limit: query.limit,
    coverage: coverage(filtered),
    depotOptions: body.depotOptions,
    classOptions: body.classOptions,
    tripModel: TRIP_MODEL_PARAMS,
    tripDefinition: TRIP_DEFINITION,
    profileEndpoint: ROUTE_PROFILE_ENDPOINT,
  };
}
