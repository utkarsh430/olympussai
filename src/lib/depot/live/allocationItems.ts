import type { AllocRoute, AllocationPlan } from '../optimise/allocateTypes';
import type { AllocationInput } from '../routes/allocationInput';
import type {
  AllocationMoveItem,
  AllocationUnchangedItem,
  DepotPositionCounts,
  DepotPositionKind,
} from '../routes/api';
import type { DepotPosition } from '../routes/depotPositions';
import type { SnapshotAnalysis } from './analysis';

/** The allocation response's items, named and costed from the plan and its inputs. */

export function positionCounts(
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

export interface PlanItems {
  readonly moves: readonly AllocationMoveItem[];
  readonly unchanged: readonly AllocationUnchangedItem[];
}

/** Every planned route is in the input and moves only between costed depots. */
export function planItems(
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
