import type { DepotBalance, TransferPlan, UncoveredReason } from '../optimise/types';
import { busesWord, type RowDecision } from './rebalanceModel';

/*
 * Rows for the transfer table and the shortfall list, joined from the plan and
 * the balances it was made from. Pure, so the server's plan and a what-if
 * outcome are described by the same functions.
 */

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
  readonly decision: RowDecision | null;
}

export interface UncoveredRow {
  readonly depotId: string;
  readonly depotName: string;
  readonly buses: number;
  readonly reason: UncoveredReason;
  readonly sentence: string;
}

function indexById(balances: readonly DepotBalance[]): ReadonlyMap<string, DepotBalance> {
  return new Map(balances.map((b) => [b.depotId, b]));
}
/** One row per transfer, in the plan's order, with the context a planner decides on. */
export function transferRows(
  plan: TransferPlan,
  balances: readonly DepotBalance[],
  decisions: ReadonlyMap<string, RowDecision>,
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
