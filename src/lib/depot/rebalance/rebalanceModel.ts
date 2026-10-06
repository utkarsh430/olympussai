import type { DepotKind, LatLng } from '../types';
import type {
  DepotBalance,
  NetworkBalanceTotals,
  TransferPlan,
  UncoveredReason,
} from '../optimise/types';

/*
 * The fleet distribution page's view model: what the summary, the map and the
 * tables render, joined from the balances and the plan. Pure and browser-safe,
 * so the same functions describe the server's plan and a what-if outcome.
 */

/** A planner's verdict on one recommended transfer; recorded, never dispatched. */
export type TransferDecisionKind = 'approved' | 'rejected' | 'deferred';

export type BalanceClass = 'surplus' | 'deficit' | 'balanced';

/** Thinnest arc that still reads as a line on the dark basemap. */
export const MIN_ARC_PX = 1.5;
/** Widest arc before neighbouring arcs start to merge at network zoom. */
export const MAX_ARC_PX = 8;

export interface PlanSummary {
  readonly before: NetworkBalanceTotals;
  readonly after: NetworkBalanceTotals;
  readonly transfers: number;
  readonly busesMoved: number;
  readonly coveredDeficit: number;
  readonly uncoveredDeficit: number;
  readonly busKm: number;
}

export interface BalanceRow {
  readonly depotId: string;
  readonly depotName: string;
  readonly kind: DepotKind;
  /** Only operating depots give or receive; other kinds are listed but never planned. */
  readonly takesPart: boolean;
  readonly fleet: number;
  readonly offRoad: number;
  readonly available: number;
  readonly peakRequirement: number;
  readonly spareTarget: number;
  readonly required: number;
  readonly balance: number;
  readonly cls: BalanceClass;
  readonly positioned: boolean;
}

export interface TransferRow {
  readonly id: string;
  readonly fromDepotId: string;
  readonly fromName: string;
  readonly toDepotId: string;
  readonly toName: string;
  readonly buses: number;
  readonly distanceKm: number;
  readonly busKm: number;
  readonly giverSurplusBefore: number;
  readonly receiverDeficitBefore: number;
  readonly decision: TransferDecisionKind | null;
}

export interface UncoveredRow {
  readonly depotId: string;
  readonly depotName: string;
  readonly buses: number;
  readonly reason: UncoveredReason;
  readonly sentence: string;
}

export interface MapNode {
  readonly depotId: string;
  readonly depotName: string;
  readonly position: LatLng;
  readonly balance: number;
  readonly cls: BalanceClass;
}

export interface MapArc {
  readonly transferId: string;
  readonly fromDepotId: string;
  readonly toDepotId: string;
  readonly from: LatLng;
  readonly to: LatLng;
  readonly buses: number;
  readonly widthPx: number;
}

export interface MapGeometry {
  readonly nodes: readonly MapNode[];
  readonly arcs: readonly MapArc[];
}

export function classifyBalance(balance: number): BalanceClass {
  if (balance > 0) return 'surplus';
  if (balance < 0) return 'deficit';
  return 'balanced';
}

export function busesWord(n: number): string {
  return n === 1 ? '1 bus' : `${n} buses`;
}

/** Headline figures; before and after are the plan's own, so they always reconcile. */
export function planSummary(plan: TransferPlan): PlanSummary {
  return {
    before: plan.before,
    after: plan.after,
    transfers: plan.transfers.length,
    busesMoved: plan.transfers.reduce((sum, t) => sum + t.buses, 0),
    coveredDeficit: plan.coveredDeficit,
    uncoveredDeficit: plan.uncovered.reduce((sum, u) => sum + u.buses, 0),
    busKm: plan.totalBusKm,
  };
}

function toRow(b: DepotBalance): BalanceRow {
  return {
    depotId: b.depotId,
    depotName: b.depotName,
    kind: b.kind,
    takesPart: b.kind === 'depot',
    fleet: b.fleet,
    offRoad: b.offRoad,
    available: b.available,
    peakRequirement: b.peakRequirement,
    spareTarget: b.spareTarget,
    required: b.required,
    balance: b.balance,
    cls: classifyBalance(b.balance),
    positioned: b.position !== null,
  };
}

function byBalanceThenName(a: BalanceRow, b: BalanceRow): number {
  return a.balance - b.balance || a.depotName.localeCompare(b.depotName, 'en');
}

/** Operating depots first, deepest deficit leading; other kinds after, by name. */
export function balanceRows(balances: readonly DepotBalance[]): BalanceRow[] {
  const rows = balances.map(toRow);
  const taking = rows.filter((r) => r.takesPart).sort(byBalanceThenName);
  const others = rows
    .filter((r) => !r.takesPart)
    .sort((a, b) => a.depotName.localeCompare(b.depotName, 'en'));
  return [...taking, ...others];
}

function indexById(balances: readonly DepotBalance[]): ReadonlyMap<string, DepotBalance> {
  return new Map(balances.map((b) => [b.depotId, b]));
}

/** One row per transfer, in the plan's order, with the context a planner decides on. */
export function transferRows(
  plan: TransferPlan,
  balances: readonly DepotBalance[],
  decisions: ReadonlyMap<string, TransferDecisionKind>,
): TransferRow[] {
  const byId = indexById(balances);
  return plan.transfers.map((t) => {
    const from = byId.get(t.fromDepotId);
    const to = byId.get(t.toDepotId);
    return {
      id: t.id,
      fromDepotId: t.fromDepotId,
      fromName: from?.depotName ?? t.fromDepotId,
      toDepotId: t.toDepotId,
      toName: to?.depotName ?? t.toDepotId,
      buses: t.buses,
      distanceKm: t.distanceKm,
      busKm: t.busKm,
      giverSurplusBefore: Math.max(0, from?.balance ?? 0),
      receiverDeficitBefore: Math.max(0, -(to?.balance ?? 0)),
      decision: decisions.get(t.id) ?? null,
    };
  });
}

/** What an uncovered reason means for one depot, in a sentence. */
export function uncoveredSentence(
  depotName: string,
  buses: number,
  reason: UncoveredReason,
  maxTransferKm: number,
): string {
  const head = `${depotName} stays ${busesWord(buses)} short`;
  switch (reason) {
    case 'no_surplus_in_range':
      return `${head}: no depot with spare buses lies within the maximum transfer distance of ${maxTransferKm} km.`;
    case 'insufficient_surplus':
      return `${head}: depots within ${maxTransferKm} km had spare buses, but not enough for every depot in range.`;
    case 'no_position':
      return `${head}: it has no known position, so no transfer can be routed to it.`;
    case 'excluded':
      return `${head}: it is excluded from this plan, so it neither gives nor receives.`;
  }
}

export function uncoveredRows(
  plan: TransferPlan,
  balances: readonly DepotBalance[],
  maxTransferKm: number,
): UncoveredRow[] {
  const byId = indexById(balances);
  return plan.uncovered.map((u) => {
    const depotName = byId.get(u.depotId)?.depotName ?? u.depotId;
    return {
      depotId: u.depotId,
      depotName,
      buses: u.buses,
      reason: u.reason,
      sentence: uncoveredSentence(depotName, u.buses, u.reason, maxTransferKm),
    };
  });
}

/** Arc width on a square-root scale, so area-like perception tracks buses moved. */
export function arcWidthPx(buses: number, maxBuses: number): number {
  if (!Number.isFinite(buses) || !Number.isFinite(maxBuses) || buses <= 0 || maxBuses <= 0) {
    return MIN_ARC_PX;
  }
  const share = Math.sqrt(Math.min(1, buses / maxBuses));
  return MIN_ARC_PX + (MAX_ARC_PX - MIN_ARC_PX) * share;
}

/** Nodes for operating depots with a position; one arc per transfer between positioned ends. */
export function mapGeometry(balances: readonly DepotBalance[], plan: TransferPlan): MapGeometry {
  const nodes: MapNode[] = balances
    .filter((b) => b.kind === 'depot' && b.position !== null)
    .map((b) => ({
      depotId: b.depotId,
      depotName: b.depotName,
      position: b.position as LatLng,
      balance: b.balance,
      cls: classifyBalance(b.balance),
    }));
  const positions = new Map(nodes.map((n) => [n.depotId, n.position]));
  const maxBuses = plan.transfers.reduce((max, t) => Math.max(max, t.buses), 0);
  const arcs: MapArc[] = [];
  for (const t of plan.transfers) {
    const from = positions.get(t.fromDepotId);
    const to = positions.get(t.toDepotId);
    if (!from || !to) continue;
    arcs.push({
      transferId: t.id,
      fromDepotId: t.fromDepotId,
      toDepotId: t.toDepotId,
      from,
      to,
      buses: t.buses,
      widthPx: arcWidthPx(t.buses, maxBuses),
    });
  }
  return { nodes, arcs };
}
