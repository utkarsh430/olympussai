import { planAllocation } from '../optimise/allocate';
import { MAX_MOVES, MIN_SAVING_KM_PER_DAY } from '../optimise/allocateConfig';
import type { AllocRoute, AllocationPlan } from '../optimise/allocateTypes';
import { DEFAULT_REBALANCE_PARAMS } from '../optimise/config';
import type { FleetSnapshotView } from '../repositories/types';
import { buildAllocationInput, type AllocationInput } from '../routes/allocationInput';
import {
  ROUTE_PROFILE_ENDPOINT,
  type AllocationMoveItem,
  type AllocationParams,
  type AllocationUnchangedItem,
  type DepotAllocationResponse,
  type DepotPositionCounts,
  type DepotPositionKind,
} from '../routes/api';
import { depotPositions, type DepotPosition } from '../routes/depotPositions';
import { cachedRouteProfiles } from '../routes/routeCatalogue';
import type { RouteRow } from '../routes/routeTableTypes';
import { operatingDateOf } from '../sim/seed';
import { TRIP_MODEL_PARAMS } from '../sim/tripFrequencyConfig';
import type { Coverage, Figure } from '../types';
import { feedEnvelope, type SnapshotAnalysis } from './analysis';
import {
  coverageOf,
  memoiseOnCatalogue,
  operatedBy,
  parseRouteFilter,
  routeTableOf,
  type ParsedRouteFilter,
  type RouteContext,
  type RouteFilterQuery,
} from './routeInputs';

export type AllocationQuery = RouteFilterQuery;

/** Validates `?depotId=`; see `parseRouteFilter`. */
export function parseAllocationQuery(searchParams: URLSearchParams): ParsedRouteFilter {
  return parseRouteFilter(searchParams);
}

const PARAMS: AllocationParams = {
  minSavingKmPerDay: MIN_SAVING_KM_PER_DAY,
  maxMoves: MAX_MOVES,
  detourFactor: DEFAULT_REBALANCE_PARAMS.detourFactor,
  tripModel: TRIP_MODEL_PARAMS,
};

type AllocationBody = Omit<
  DepotAllocationResponse,
  keyof ReturnType<typeof feedEnvelope> | 'depotId'
>;

function inputOf(
  context: RouteContext,
  positions: ReadonlyMap<string, DepotPosition>,
): AllocationInput {
  const { analysis, table, profiles, operatingDate } = context;
  return buildAllocationInput({
    table,
    profiles,
    depots: analysis.depots,
    positions,
    operatingDate,
    detourFactor: PARAMS.detourFactor,
  });
}

const positionsOf = (analysis: SnapshotAnalysis): ReadonlyMap<string, DepotPosition> =>
  depotPositions(analysis.depots, analysis.yards);

/** The allocator's inputs for this snapshot and the profiles cached now; for reconciliation. */
export function allocationInputFor(
  view: FleetSnapshotView,
  analysis: SnapshotAnalysis,
): AllocationInput {
  const context: RouteContext = {
    analysis,
    table: routeTableOf(view),
    profiles: cachedRouteProfiles(view),
    operatingDate: operatingDateOf(view.feedNow, view.fetchedAt),
  };
  return inputOf(context, positionsOf(analysis));
}

function positionCounts(
  analysis: SnapshotAnalysis,
  positions: ReadonlyMap<string, DepotPosition>,
): DepotPositionCounts {
  const operating = analysis.depots.filter((d) => d.kind === 'depot');
  const count = (kind: DepotPositionKind): number =>
    operating.filter((d) => positions.get(d.id)?.kind === kind).length;
  const yard = count('yard');
  const median = count('median');
  return { yard, median, none: operating.length - yard - median, provenance: 'derived' };
}

const modelled = (value: number, coverage: Coverage): Figure => ({
  value,
  provenance: 'modelled',
  coverage,
});

interface PlanItems {
  readonly moves: readonly AllocationMoveItem[];
  readonly unchanged: readonly AllocationUnchangedItem[];
}

/** Every planned route is in the input and moves only between costed depots. */
function planItems(
  plan: AllocationPlan,
  input: AllocationInput,
  analysis: SnapshotAnalysis,
): PlanItems {
  const routes = new Map<string, AllocRoute>(input.routes.map((r) => [r.routeName, r]));
  const nameOf = (id: string): string => analysis.depotsById.get(id)?.name ?? id;
  const moves = plan.moves.map((m): AllocationMoveItem => {
    const route = routes.get(m.routeName)!;
    return {
      ...m,
      fromDepotName: nameOf(m.fromDepotId),
      toDepotName: nameOf(m.toDepotId),
      tripsPerDay: route.tripsPerDay,
      fromDeadKmPerTrip: route.deadKmByDepot[m.fromDepotId] ?? 0,
      toDeadKmPerTrip: route.deadKmByDepot[m.toDepotId] ?? 0,
    };
  });
  const unchanged = plan.unchanged.map((u): AllocationUnchangedItem => {
    const route = routes.get(u.routeName)!;
    return {
      routeName: u.routeName,
      depotId: route.currentDepotId,
      depotName: nameOf(route.currentDepotId),
      reason: u.reason,
      tripsPerDay: route.tripsPerDay,
      deadKmPerTrip: route.deadKmByDepot[route.currentDepotId] ?? 0,
    };
  });
  return { moves, unchanged };
}

/*
 * Plans only the routes whose profiles are already cached, so a request never
 * fetches from the upstream. Held per snapshot rows, operating date and
 * catalogue revision; the envelope and the depot filter are per request.
 */
const allocationBody = memoiseOnCatalogue<AllocationBody>((context) => {
  const { analysis, table, profiles, operatingDate } = context;
  const positions = positionsOf(analysis);
  const input = inputOf(context, positions);
  const plan = planAllocation(input.routes, input.depots);
  const plannedNames = new Set(input.routes.map((r) => r.routeName));
  const planned = coverageOf(table, (r) => plannedNames.has(r.routeName));
  return {
    operatingDate,
    recommendationOnly: true,
    coverage: { profiled: coverageOf(table, (r) => profiles.has(r.routeName)), planned },
    depotPositions: positionCounts(analysis, positions),
    beforeKmPerDay: modelled(plan.beforeKmPerDay, planned),
    afterKmPerDay: modelled(plan.afterKmPerDay, planned),
    savedKmPerDay: modelled(plan.savedKmPerDay, planned),
    ...planItems(plan, input, analysis),
    excluded: input.excluded,
    provenance: {
      deadKmPerTrip: 'derived',
      tripsPerDay: 'modelled',
      kmPerDay: 'modelled',
      capacity: 'modelled',
    },
    params: PARAMS,
    profileEndpoint: ROUTE_PROFILE_ENDPOINT,
  };
});

function forDepot(
  body: AllocationBody,
  table: readonly RouteRow[],
  depotId: string,
): AllocationBody {
  const ours = new Set(table.filter((r) => operatedBy(r, depotId)).map((r) => r.routeName));
  return {
    ...body,
    moves: body.moves.filter(
      (m) => ours.has(m.routeName) || m.fromDepotId === depotId || m.toDepotId === depotId,
    ),
    unchanged: body.unchanged.filter((u) => ours.has(u.routeName)),
    excluded: body.excluded.filter((e) => ours.has(e.routeName)),
  };
}

/** The allocation panel's payload. A recommendation only: nothing is reassigned. */
export function buildAllocationResponse(
  view: FleetSnapshotView,
  query: AllocationQuery,
): DepotAllocationResponse {
  const body = allocationBody(view);
  const { depotId } = query;
  const scoped = depotId === null ? body : forDepot(body, routeTableOf(view), depotId);
  return { ...feedEnvelope(view), ...scoped, depotId };
}
