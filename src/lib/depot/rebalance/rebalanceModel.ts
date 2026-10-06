import type { DepotKind } from '../types';
import type { DepotBalance, NetworkBalanceTotals, TransferPlan } from '../optimise/types';

/*
 * The fleet distribution page's view model: what the summary, the map and the
 * tables render, joined from the balances and the plan. Pure and browser-safe,
 * so the same functions describe the server's plan and a what-if outcome.
 */

/** A planner's verdict on one recommended transfer; recorded, never dispatched. */
export type TransferDecisionKind = 'approved' | 'rejected' | 'deferred';

export type BalanceClass = 'surplus' | 'deficit' | 'balanced';
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
