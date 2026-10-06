import type { AllocDepot, AllocRoute } from '../optimise/allocateTypes';
import { modelDepotMaster } from '../sim/depotMaster';
import { modelTripsPerDay, overBusCap } from '../sim/tripFrequency';
import { UNASSIGNED_DEPOT_ID, type DepotSummary } from '../types';
import type { AllocationExcludedRoute, AllocationExclusion } from './api';
import { deadKmFor, terminalsOf } from './deadKm';
import type { DepotPosition } from './depotPositions';
import type { RouteRow } from './routeTableTypes';
import type { RouteProfile } from './types';

export interface AllocationSource {
  readonly table: readonly RouteRow[];
  /** Profiles already cached; nothing here may fetch another. */
  readonly profiles: ReadonlyMap<string, RouteProfile>;
  readonly depots: readonly DepotSummary[];
  readonly positions: ReadonlyMap<string, DepotPosition>;
  readonly operatingDate: string;
  readonly detourFactor: number;
}

export interface AllocationInput {
  /** Planned routes, each at its majority operator, with dead km to every candidate depot. */
  readonly routes: readonly AllocRoute[];
  readonly depots: readonly AllocDepot[];
  /** Every other route in the table, with why it is not planned. */
  readonly excluded: readonly AllocationExcludedRoute[];
}

type Classified =
  | { readonly kind: 'route'; readonly route: AllocRoute }
  | { readonly kind: 'excluded'; readonly route: AllocationExcludedRoute };

function excluded(row: RouteRow, reason: AllocationExclusion): Classified {
  const route = {
    routeName: row.routeName,
    primaryDepotId: row.primaryDepotId,
    depotName: row.operators.find((o) => o.depotId === row.primaryDepotId)?.depotName ?? null,
    buses: row.buses,
    reason,
  };
  return { kind: 'excluded', route };
}

function classify(
  row: RouteRow,
  source: AllocationSource,
  candidates: ReadonlyMap<string, DepotPosition>,
  kinds: ReadonlyMap<string, DepotSummary['kind']>,
): Classified {
  const primary = row.primaryDepotId;
  if (primary === null) return excluded(row, 'no_primary_depot');
  if (primary === UNASSIGNED_DEPOT_ID) return excluded(row, 'unassigned_bucket');
  if (kinds.get(primary) !== 'depot') return excluded(row, 'operator_not_depot');
  if (overBusCap(row.buses)) return excluded(row, 'bus_count_over_cap');
  const profile = source.profiles.get(row.routeName);
  if (!profile) return excluded(row, 'not_profiled');
  if (terminalsOf(profile) === null) return excluded(row, 'too_few_located_stops');
  if (!candidates.has(primary)) return excluded(row, 'no_depot_position');
  const deadKmByDepot = Object.fromEntries(
    [...candidates].flatMap(([id, { position }]) => {
      const deadKm = deadKmFor(position, profile, source.detourFactor);
      return deadKm === null ? [] : [[id, deadKm.perTripKm] as const];
    }),
  );
  const trips = modelTripsPerDay(
    {
      routeName: row.routeName,
      buses: row.buses,
      scheduledDurationMin: profile.scheduledDurationMin,
    },
    source.operatingDate,
  );
  const route: AllocRoute = {
    routeName: row.routeName,
    currentDepotId: primary,
    busesNeeded: row.buses,
    tripsPerDay: trips.tripsPerDay,
    deadKmByDepot,
  };
  return { kind: 'route', route };
}

/**
 * Room for routes at one depot: its modelled parking less the buses it keeps
 * that the plan does not place (idle, off-road, or on unplanned routes). A
 * depot starts the plan feasible whenever its parking holds its own fleet.
 */
function capacityOf(depot: DepotSummary, planLoad: number): number {
  const kept = Math.max(0, depot.fleet - planLoad);
  return modelDepotMaster(depot).parkingCapacity - kept;
}

/**
 * Turns the live route table and the cached profiles into the allocator's
 * inputs. Candidates are operating depots (not hired, electric or enforcement
 * units) with a known position; the route keeps its whole bus count as one
 * unit at its majority operator.
 */
export function buildAllocationInput(source: AllocationSource): AllocationInput {
  const kinds = new Map(source.depots.map((d) => [d.id, d.kind]));
  const candidates = new Map([...source.positions].filter(([id]) => kinds.get(id) === 'depot'));
  const classified = source.table.map((row) => classify(row, source, candidates, kinds));
  const routes = classified.flatMap((c) => (c.kind === 'route' ? [c.route] : []));
  const loads = new Map<string, number>();
  for (const r of routes)
    loads.set(r.currentDepotId, (loads.get(r.currentDepotId) ?? 0) + r.busesNeeded);
  const depots = source.depots
    .filter((d) => candidates.has(d.id))
    .map((d) => ({ depotId: d.id, capacity: capacityOf(d, loads.get(d.id) ?? 0) }));
  return {
    routes,
    depots,
    excluded: classified.flatMap((c) => (c.kind === 'excluded' ? [c.route] : [])),
  };
}
