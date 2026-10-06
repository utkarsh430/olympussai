import type { DepotBusView } from '../api';
import type { ServiceClass } from '../sim/types';

/** A bus is flagged when it uses more than this share more fuel per km than its group median. */
export const FUEL_VARIANCE_FLAG_PCT = 15;

/** A bus is compared only when at least this many other buses (peers) have distance. */
export const MIN_PEERS = 2;

/**
 * Diesel price in rupees per litre used when the caller supplies none or an
 * unusable one. A planning figure as of October 2026, not a quoted price.
 */
export const DEFAULT_PRICE_PER_LITRE = 92;

/** One bus's modelled distance and fuel issue for one operating date. */
export interface BusFuelDay {
  readonly registrationNumber: string;
  readonly distanceKm: number;
  /** Litres issued, to one decimal. */
  readonly fuelLitres: number;
  readonly serviceClass: ServiceClass;
  readonly routeName: string | null;
}

export interface FuelFigure {
  readonly kmPerLitre: number | null;
  /** Rupees per kilometre. */
  readonly costPerKm: number | null;
  /** Percent more fuel per km than the comparison median; negative is better. */
  readonly variancePct: number | null;
}

/** Why a figure is withheld. */
export type FuelWithheldReason =
  | 'no_distance'
  | 'no_fuel'
  | 'no_comparison_group'
  | 'peers_differ';

export const FUEL_REASON_LABELS: Readonly<Record<FuelWithheldReason, string>> = {
  no_distance: 'No distance recorded',
  no_fuel: 'No fuel recorded',
  no_comparison_group: 'Too few similar buses to compare',
  peers_differ: 'peers differ too much to compare',
};

export type FuelComparisonScope = 'route' | 'depot';

export interface BusFuelFigure extends FuelFigure {
  readonly registrationNumber: string;
  readonly serviceClass: ServiceClass;
  readonly routeName: string | null;
  readonly distanceKm: number;
  readonly fuelLitres: number;
  /** Whole rupees. */
  readonly cost: number;
  readonly comparison: FuelComparisonScope | null;
  readonly withheldReason: FuelWithheldReason | null;
}

/** Totals for a group of buses; ratios are of sums, not means of ratios. */
export interface FuelTotals {
  readonly distanceKm: number;
  readonly fuelLitres: number;
  readonly cost: number;
  readonly kmPerLitre: number | null;
  readonly costPerKm: number | null;
  /** Counts every bus in the group, including those with no distance; never a divisor. */
  readonly busCount: number;
}

export interface FuelGroupRow extends FuelTotals {
  /** Route name or service class; null for buses with no route. */
  readonly key: string | null;
}

export interface FlaggedBus {
  readonly registrationNumber: string;
  readonly routeName: string | null;
  readonly serviceClass: ServiceClass;
  readonly variancePct: number;
  readonly comparison: FuelComparisonScope;
  /** The sentence a page shows: states a variance, never a cause. */
  readonly statement: string;
}

export interface FuelAnalysis {
  /** The price used: the one supplied, or the default when that was unusable. */
  readonly pricePerLitre: number;
  /** True when the supplied price was unusable and the default was used. */
  readonly priceDefaulted: boolean;
  readonly perBus: readonly BusFuelFigure[];
  readonly perRoute: readonly FuelGroupRow[];
  readonly perClass: readonly FuelGroupRow[];
  readonly depot: FuelTotals;
  readonly flagged: readonly FlaggedBus[];
}

/** The seam to where fuel data comes from; modelled today, a feed later. */
export interface FuelRepository {
  fuelDay(buses: readonly DepotBusView[], operatingDate: string): Promise<readonly BusFuelDay[]>;
}
