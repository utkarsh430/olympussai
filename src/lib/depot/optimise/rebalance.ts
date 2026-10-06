import { haversineKm } from '@/lib/simulation/seededRandom';
import type { LatLng } from '../types';
import { minCostMaxFlow, type FlowEdgeInput } from './minCostFlow';
import type {
  DepotBalance,
  NetworkBalanceTotals,
  RebalanceParams,
  Transfer,
  TransferPlan,
  UncoveredDeficit,
} from './types';

const METRES_PER_KM = 1000;

/** Straight-line distance scaled by the detour factor to approximate road distance. */
export function roadDistanceKm(a: LatLng, b: LatLng, detourFactor: number): number {
  return haversineKm(a.lat, a.lng, b.lat, b.lng) * detourFactor;
}

/** Counts and sums of surplus and deficit across the operating depots among the balances. */
export function summariseBalances(balances: readonly DepotBalance[]): NetworkBalanceTotals {
  let depotsInDeficit = 0;
  let depotsInSurplus = 0;
  let totalDeficit = 0;
  let totalSurplus = 0;
  for (const b of balances) {
    if (b.kind !== 'depot') continue;
    if (b.balance < 0) {
      depotsInDeficit += 1;
      totalDeficit -= b.balance;
    } else if (b.balance > 0) {
      depotsInSurplus += 1;
      totalSurplus += b.balance;
    }
  }
  return { depotsInDeficit, depotsInSurplus, totalDeficit, totalSurplus };
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Moves buses between depots, returning new balances; non-depot rows and inputs are untouched. */
export function applyTransfers(
  balances: readonly DepotBalance[],
  transfers: readonly Transfer[],
): DepotBalance[] {
  const delta = new Map<string, number>();
  for (const t of transfers) {
    delta.set(t.fromDepotId, (delta.get(t.fromDepotId) ?? 0) - t.buses);
    delta.set(t.toDepotId, (delta.get(t.toDepotId) ?? 0) + t.buses);
  }
  return balances.map((b) => {
    const change = b.kind === 'depot' ? (delta.get(b.depotId) ?? 0) : 0;
    if (change === 0) return { ...b };
    const available = b.available + change;
    return { ...b, fleet: b.fleet + change, available, balance: available - b.required };
  });
}

interface Candidate {
  readonly balance: DepotBalance;
  readonly position: LatLng;
}

function withPosition(balance: DepotBalance): Candidate | null {
  return balance.position === null ? null : { balance, position: balance.position };
}

/**
 * Plans the cheapest set of bus transfers that covers as much deficit as
 * possible: maximum buses moved first, then minimum bus-kilometres.
 *
 * Only rows with kind `depot` take part; hired, electric and enforcement
 * units never give or receive and appear nowhere in the totals or the report.
 * Every participating depot is counted in `before` and `after`. Excluded
 * depots neither give nor receive, locked depots may receive but never give,
 * and a depot without a position cannot be routed to or from.
 *
 * Each deficit left uncovered gets one entry carrying its remaining buses and
 * the first reason that applies, in this order: `excluded` (the depot itself
 * is excluded), `no_position`, `no_surplus_in_range` (no eligible surplus
 * depot within the maximum distance), `insufficient_surplus` (reachable
 * surplus existed but ran out). Balances are processed in id order so the
 * plan does not depend on the order of the input.
 */
export function planTransfers(
  balances: readonly DepotBalance[],
  params: RebalanceParams,
): TransferPlan {
  const excluded = new Set(params.excludedDepotIds);
  const locked = new Set(params.lockedDepotIds);
  const active = balances
    .filter((b) => b.kind === 'depot')
    .sort((a, b) => compareIds(a.depotId, b.depotId));

  const givers = active
    .filter((b) => b.balance > 0 && !locked.has(b.depotId) && !excluded.has(b.depotId))
    .map(withPosition)
    .filter((c): c is Candidate => c !== null);
  const receivers = active
    .filter((b) => b.balance < 0 && !excluded.has(b.depotId))
    .map(withPosition)
    .filter((c): c is Candidate => c !== null);

  const source = 0;
  const sink = 1 + givers.length + receivers.length;
  const edges: FlowEdgeInput[] = [];
  givers.forEach((g, i) => {
    edges.push({ from: source, to: 1 + i, capacity: g.balance.balance, cost: 0 });
  });
  const pairEdges: { readonly edge: number; readonly giver: number; readonly receiver: number }[] =
    [];
  const reachable = new Set<number>();
  givers.forEach((g, i) => {
    receivers.forEach((r, j) => {
      const metres = Math.round(
        roadDistanceKm(g.position, r.position, params.detourFactor) * METRES_PER_KM,
      );
      if (metres > params.maxTransferKm * METRES_PER_KM) return;
      reachable.add(j);
      pairEdges.push({ edge: edges.length, giver: i, receiver: j });
      edges.push({
        from: 1 + i,
        to: 1 + givers.length + j,
        capacity: Math.min(g.balance.balance, -r.balance.balance),
        cost: metres,
      });
    });
  });
  receivers.forEach((r, j) => {
    edges.push({ from: 1 + givers.length + j, to: sink, capacity: -r.balance.balance, cost: 0 });
  });

  const result = minCostMaxFlow(sink + 1, edges, source, sink);

  const received = new Array<number>(receivers.length).fill(0);
  const transfers: Transfer[] = [];
  for (const { edge, giver, receiver } of pairEdges) {
    const buses = result.edgeFlows[edge] ?? 0;
    if (buses <= 0) continue;
    const from = givers[giver] as Candidate;
    const to = receivers[receiver] as Candidate;
    const distanceKm =
      Math.round(roadDistanceKm(from.position, to.position, params.detourFactor) * METRES_PER_KM) /
      METRES_PER_KM;
    received[receiver] = (received[receiver] ?? 0) + buses;
    transfers.push({
      id: `${from.balance.depotId}>${to.balance.depotId}`,
      fromDepotId: from.balance.depotId,
      toDepotId: to.balance.depotId,
      buses,
      distanceKm,
      busKm: buses * distanceKm,
    });
  }
  transfers.sort(
    (a, b) =>
      b.buses - a.buses ||
      compareIds(a.fromDepotId, b.fromDepotId) ||
      compareIds(a.toDepotId, b.toDepotId),
  );

  const uncovered: UncoveredDeficit[] = [];
  for (const b of active) {
    if (b.balance >= 0) continue;
    if (excluded.has(b.depotId)) {
      uncovered.push({ depotId: b.depotId, buses: -b.balance, reason: 'excluded' });
      continue;
    }
    const j = receivers.findIndex((r) => r.balance.depotId === b.depotId);
    if (j === -1) {
      uncovered.push({ depotId: b.depotId, buses: -b.balance, reason: 'no_position' });
      continue;
    }
    const remaining = -b.balance - (received[j] ?? 0);
    if (remaining <= 0) continue;
    uncovered.push({
      depotId: b.depotId,
      buses: remaining,
      reason: reachable.has(j) ? 'insufficient_surplus' : 'no_surplus_in_range',
    });
  }

  const after = summariseBalances(applyTransfers(active, transfers));
  return {
    transfers,
    before: summariseBalances(active),
    after,
    coveredDeficit: result.flow,
    uncovered,
    totalBusKm: transfers.reduce((sum, t) => sum + t.busKm, 0),
  };
}
