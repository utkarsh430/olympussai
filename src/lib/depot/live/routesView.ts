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
import { TRIP_MODEL_PARAMS } from '../sim/tripFrequencyConfig';
import { feedEnvelope } from './analysis';
import {
  coverageOf,
  memoiseOnCatalogue,
  operatedBy,
  parseRouteFilter,
  type ParsedRouteFilter,
  type RouteFilterQuery,
} from './routeInputs';

export type RoutesQuery = RouteFilterQuery;

/** Validates `?depotId=`; see `parseRouteFilter`. */
export function parseRoutesQuery(searchParams: URLSearchParams): ParsedRouteFilter {
  return parseRouteFilter(searchParams);
}

interface RoutesBody {
  readonly operatingDate: string;
  readonly routes: readonly RouteListItem[];
}

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
    return { operatingDate, routes };
  },
);

function coverage(routes: readonly RouteListItem[]): RoutesCoverage {
  return {
    profiled: coverageOf(routes, (r) => r.profiled),
    tripsOnDuration: coverageOf(routes, (r) => r.tripsBasis === 'buses_and_duration'),
  };
}

/** The route table page's payload; never fetches a profile. */
export function buildRoutesResponse(
  view: FleetSnapshotView,
  query: RoutesQuery,
): DepotRoutesResponse {
  const body = routesBody(view);
  const { depotId } = query;
  const routes = depotId === null ? body.routes : body.routes.filter((r) => operatedBy(r, depotId));
  return {
    ...feedEnvelope(view),
    operatingDate: body.operatingDate,
    depotId,
    routes,
    coverage: coverage(routes),
    tripModel: TRIP_MODEL_PARAMS,
    profileEndpoint: ROUTE_PROFILE_ENDPOINT,
  };
}
