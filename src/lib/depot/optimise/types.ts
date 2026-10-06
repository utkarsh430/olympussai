import type { DepotKind, LatLng } from '../types';

/**
 * Fleet distribution types.
 *
 * `fleet`, `offRoad` and `available` are live or derived. `peakRequirement`,
 * `spareTarget` and `required` are modelled until a network timetable is
 * supplied, so any plan built on a balance is labelled MODELLED.
 */
export interface DepotBalance {
  readonly depotId: string;
  readonly depotName: string;
  readonly kind: DepotKind;
  readonly fleet: number;
  readonly offRoad: number;
  /** fleet − offRoad. */
  readonly available: number;
  readonly peakRequirement: number;
  readonly spareTarget: number;
  /** peakRequirement + spareTarget. */
  readonly required: number;
  /** available − required. Positive is surplus, negative is deficit. */
  readonly balance: number;
  /** Yard centre when established, else the depot centroid; null when neither. */
  readonly position: LatLng | null;
}

export interface RebalanceParams {
  readonly maxTransferKm: number;
  /** Straight-line distance times this approximates road distance. */
  readonly detourFactor: number;
  /** Depots that may receive but never give. */
  readonly lockedDepotIds: readonly string[];
  /** Depots that neither give nor receive. */
  readonly excludedDepotIds: readonly string[];
}

export interface Transfer {
  /** Stable: `<fromDepotId>><toDepotId>`. */
  readonly id: string;
  readonly fromDepotId: string;
  readonly toDepotId: string;
  readonly buses: number;
  readonly distanceKm: number;
  readonly busKm: number;
}

export interface NetworkBalanceTotals {
  readonly depotsInDeficit: number;
  readonly depotsInSurplus: number;
  readonly totalDeficit: number;
  readonly totalSurplus: number;
}

export type UncoveredReason = 'no_surplus_in_range' | 'insufficient_surplus' | 'no_position';

export interface UncoveredDeficit {
  readonly depotId: string;
  readonly buses: number;
  readonly reason: UncoveredReason;
}

export interface TransferPlan {
  readonly transfers: readonly Transfer[];
  readonly before: NetworkBalanceTotals;
  readonly after: NetworkBalanceTotals;
  readonly coveredDeficit: number;
  readonly uncovered: readonly UncoveredDeficit[];
  readonly totalBusKm: number;
}

export interface Scenario {
  readonly spareRatio?: number;
  readonly maxTransferKm?: number;
  readonly lockedDepotIds?: readonly string[];
  readonly excludedDepotIds?: readonly string[];
  readonly fleetAdjustments?: readonly { readonly depotId: string; readonly deltaBuses: number }[];
  readonly demandSurges?: readonly { readonly depotId: string; readonly percent: number }[];
}

export interface ScenarioOutcome {
  readonly balances: readonly DepotBalance[];
  readonly plan: TransferPlan;
  /** One human-readable note per input that had to be clamped. */
  readonly clamped: readonly string[];
}

export interface ScenarioDelta {
  readonly transfers: number;
  readonly busesMoved: number;
  readonly totalBusKm: number;
  readonly coveredDeficit: number;
  readonly uncoveredDeficit: number;
  readonly depotsInDeficitAfter: number;
}
