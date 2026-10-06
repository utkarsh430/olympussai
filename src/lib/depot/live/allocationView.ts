import { planAllocation } from '../optimise/allocate';
import { MAX_MOVES, MIN_SAVING_KM_PER_DAY } from '../optimise/allocateConfig';
import { DEFAULT_REBALANCE_PARAMS } from '../optimise/config';
import type { FleetSnapshotView } from '../repositories/types';
import { buildAllocationInput, type AllocationInput } from '../routes/allocationInput';
import { monotonicNow } from '../copilot/limiter';
import {
  ALLOCATION_EXCLUSIONS,
  ROUTE_PROFILE_ENDPOINT,
  UNCHANGED_REASONS,
  type AllocationExcludedRoute,
  type AllocationParams,
  type AllocationUnchangedItem,
  type DepotAllocationResponse,
} from '../routes/api';
import { depotPositions, type DepotPosition } from '../routes/depotPositions';
import { cachedRouteProfiles } from '../routes/routeCatalogue';
import type { RouteRow } from '../routes/routeTableTypes';
import { operatingDateOf } from '../sim/seed';
import { TRIP_DEFINITION, TRIP_MODEL_PARAMS } from '../sim/tripFrequencyConfig';
import { countByReason, nameMatches, pageItems } from '../routes/routeListing';
import type { AllocationQuery } from '../routes/routeQuery';
import type { Coverage, Figure } from '../types';
import { feedEnvelope, type SnapshotAnalysis } from './analysis';
import { planItems, positionCounts } from './allocationItems';
import { coverageOf, memoiseOnCatalogue, operatedBy, routeTableOf, type RouteContext } from './routeInputs';

export { parseAllocationQuery } from '../routes/routeQuery';

/**
 * The least time between two full re-plans on the same rows. A full re-plan
 * (inputs plus `planAllocation`) at 2,000 profiled routes and 143 depots
 * measured about 0.33 s, and it runs on the event loop.
 */
export const REPLAN_MIN_INTERVAL_MS = 30_000;
export const PROFILES_PENDING_NOTE =
  'New route profiles will be included in the next plan, within half a minute.';

const PARAMS: AllocationParams = {
  minSavingKmPerDay: MIN_SAVING_KM_PER_DAY,
  maxMoves: MAX_MOVES,
  detourFactor: DEFAULT_REBALANCE_PARAMS.detourFactor,
  tripModel: TRIP_MODEL_PARAMS,
};

/** The plan as built once per rows; the lists are whole and the per-request fields absent. */
type AllocationBody = Omit<
    DepotAllocationResponse,
    | keyof ReturnType<typeof feedEnvelope>
    | 'depotId'
    | 'reason'
    | 'q'
    | 'offset'
    | 'limit'
    | 'unchangedTotal'
    | 'unchangedByReason'
    | 'excludedTotal'
    | 'excludedByReason'
    | 'profilesPending'
    | 'profilesPendingNote'
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
  const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
  const context: RouteContext = {
    analysis,
    table: routeTableOf(view),
    profiles: cachedRouteProfiles(view, operatingDate),
    operatingDate,
  };
  return inputOf(context, positionsOf(analysis));
}

const modelled = (value: number, coverage: Coverage): Figure => ({
  value,
  provenance: 'modelled',
  coverage,
});

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
    tripDefinition: TRIP_DEFINITION,
    profileEndpoint: ROUTE_PROFILE_ENDPOINT,
  };
}, REPLAN_MIN_INTERVAL_MS);

function forDepot(
  body: AllocationBody,
  table: readonly RouteRow[],
  depotId: string | null,
): AllocationBody {
  if (depotId === null) return body;
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

const listed = <T extends { readonly routeName: string; readonly reason: string }>(
  items: readonly T[],
  query: AllocationQuery,
): readonly T[] =>
  items.filter(
    (i) => (query.reason === null || i.reason === query.reason) && nameMatches(i.routeName, query.q),
  );

/**
 * The allocation panel's payload. A recommendation only: nothing is reassigned.
 * The plan is network-wide and held per rows (see `REPLAN_MIN_INTERVAL_MS`);
 * the depot filter, the list filters and paging are this request's own, and
 * the counts by reason ignore the list filters so the summary never moves.
 * `clock` is monotonic and injected so the interval is testable.
 */
export function buildAllocationResponse(
  view: FleetSnapshotView,
  query: AllocationQuery,
  clock: () => number = monotonicNow,
): DepotAllocationResponse {
  const { body, pending } = allocationBody(view, clock());
  const scoped = forDepot(body, routeTableOf(view), query.depotId);
  const unchanged = listed<AllocationUnchangedItem>(scoped.unchanged, query);
  const excluded = listed<AllocationExcludedRoute>(scoped.excluded, query);
  return {
    ...feedEnvelope(view),
    ...scoped,
    depotId: query.depotId,
    reason: query.reason,
    q: query.q,
    offset: query.offset,
    limit: query.limit,
    unchanged: pageItems(unchanged, query),
    unchangedTotal: unchanged.length,
    unchangedByReason: countByReason(scoped.unchanged, UNCHANGED_REASONS),
    excluded: pageItems(excluded, query),
    excludedTotal: excluded.length,
    excludedByReason: countByReason(scoped.excluded, ALLOCATION_EXCLUSIONS),
    profilesPending: pending,
    profilesPendingNote: pending ? PROFILES_PENDING_NOTE : null,
  };
}
