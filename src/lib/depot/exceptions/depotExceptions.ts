import type { DepotBusRow } from '@/models/depotLive';
import type { BusOpState, DepotSummary } from '../types';
import { UNASSIGNED_DEPOT_ID } from '../types';
import type { DeiComponent, DepotScore } from '../score/types';
import {
  COMPONENT_EXCEPTIONS,
  CRITICAL_Z,
  EXCEPTION_BASIS,
  EXCEPTION_Z,
  MIN_RATE_GAP,
  POWER_CUT_CLUSTER_MIN,
  POWER_CUT_CLUSTER_SHARE,
  SEVERITY_ORDER,
} from './config';
import type { DepotException, DepotExceptionKind } from './types';
import { compareText } from '@/lib/depot/stats/order';

/** Code-point order: deterministic on every runtime, unlike locale collation. */

/** Buses behind the rate: the ones a manager would go and look at. */
function affectedFor(kind: DepotExceptionKind, depot: DepotSummary): number {
  const { states, fleet } = depot;
  if (kind === 'dark_share_high') return states.dark;
  if (kind === 'off_road_high') return states.offRoad;
  // on_road_low: `value` is the on-road share of the depot's *available* buses,
  // (inService + onRoad) / (fleet - offRoad), the score's onRoad component.
  // `affected` is the available buses not on the road: fleet - offRoad - inService
  // - onRoad. `fleet` is the whole fleet, off-road included, so value is not
  // affected / fleet and must not be shown as a share "of fleet".
  return Math.max(0, fleet - states.offRoad - states.inService - states.onRoad);
}

/**
 * Scores carry z signed so that higher is better, so the bad direction is
 * always negative z. The rate gap is measured in the same bad direction.
 */
function fromComponent(
  depot: DepotSummary,
  kind: Exclude<DepotExceptionKind, 'power_cut_cluster'>,
  component: DeiComponent,
): DepotException | null {
  const { value, peerMedian, z } = component;
  if (value === null || peerMedian === null || z === null) return null;
  if (z > -EXCEPTION_Z) return null;
  const gap = Math.abs(value - peerMedian);
  // A small epsilon so a gap of exactly MIN_RATE_GAP is not lost to float error.
  if (gap + 1e-9 < MIN_RATE_GAP) return null;
  return {
    id: `${kind}:${depot.id}`,
    depotId: depot.id,
    depotName: depot.name,
    kind,
    severity: Math.abs(z) >= CRITICAL_Z ? 'critical' : 'warning',
    value,
    peerMedian,
    z,
    affected: affectedFor(kind, depot),
    fleet: depot.fleet,
    basis: EXCEPTION_BASIS[kind],
  };
}

function powerCutCounts(
  rows: readonly DepotBusRow[],
  stateOf: (row: DepotBusRow) => BusOpState,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.mainPowerOn !== false || stateOf(row) === 'off_road') continue;
    const id = row.depotId ?? UNASSIGNED_DEPOT_ID;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function powerCutCluster(depot: DepotSummary, count: number): DepotException | null {
  const threshold = Math.max(POWER_CUT_CLUSTER_MIN, POWER_CUT_CLUSTER_SHARE * depot.fleet);
  if (count < threshold) return null;
  return {
    id: `power_cut_cluster:${depot.id}`,
    depotId: depot.id,
    depotName: depot.name,
    kind: 'power_cut_cluster',
    severity: 'warning',
    value: count,
    peerMedian: null,
    z: null,
    affected: count,
    fleet: depot.fleet,
    basis: EXCEPTION_BASIS.power_cut_cluster,
  };
}

function compareDepotExceptions(a: DepotException, b: DepotException): number {
  return (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    compareText(a.depotName, b.depotName) ||
    compareText(a.depotId, b.depotId) ||
    compareText(a.kind, b.kind)
  );
}

/**
 * Depot-level exceptions. Only ranked depots are judged: an unranked unit
 * (an enforcement squad, a five-bus outpost) has no peers to be unusual against.
 */
export function detectDepotExceptions(
  depots: readonly DepotSummary[],
  scores: readonly DepotScore[],
  rows: readonly DepotBusRow[],
  stateOf: (row: DepotBusRow) => BusOpState,
): DepotException[] {
  const ranked = new Map(scores.filter((s) => s.ranked).map((s) => [s.depotId, s] as const));
  const powerCuts = powerCutCounts(rows, stateOf);
  const found: DepotException[] = [];
  for (const depot of depots) {
    const score = ranked.get(depot.id);
    if (!score) continue;
    for (const { key, kind } of COMPONENT_EXCEPTIONS) {
      const component = score.components.find((c) => c.key === key);
      const exception = component ? fromComponent(depot, kind, component) : null;
      if (exception) found.push(exception);
    }
    const cluster = powerCutCluster(depot, powerCuts.get(depot.id) ?? 0);
    if (cluster) found.push(cluster);
  }
  return found.sort(compareDepotExceptions);
}
