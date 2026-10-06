import type { DepotFeedEnvelope } from '../api';
import type { ModelledDaySummary } from '../sim/operatingDayTypes';
import type { ServiceClass } from '../sim/types';
import type { FuelComparisonScope, FuelGroupRow, FuelTotals } from './types';

/** Most routes the page lists; the true count travels beside the list. */
export const FUEL_ROUTE_CAP = 100;
/** Most flagged buses the page lists; the true count travels beside the list. */
export const FUEL_FLAGGED_CAP = 50;

/** One bus whose consumption stands out from its peers: a variance, never a cause. */
export interface FuelFlaggedBus {
  readonly registrationNumber: string;
  readonly routeName: string | null;
  readonly serviceClass: ServiceClass;
  /** Kilometres per litre for the day, one decimal. */
  readonly kmPerLitre: number;
  /** Median of its peers, as the analysis measured the variance against it; one decimal. */
  readonly peerMedianKmPerLitre: number;
  readonly variancePct: number;
  readonly comparison: FuelComparisonScope;
  /** The analysis module's own sentence. */
  readonly statement: string;
}

/** The routes not listed individually, with their combined figures. */
export interface FuelOtherRoutes {
  readonly routeCount: number;
  readonly totals: FuelTotals;
}

/** GET /api/upsrtc/depot/[depotId]/fuel. Everything here is modelled. */
export interface FuelResponse extends DepotFeedEnvelope {
  readonly depot: { readonly id: string; readonly name: string };
  readonly provenance: 'modelled';
  /** The operating date, taken from the feed's clock. */
  readonly operatingDate: string;
  readonly pricePerLitre: number;
  /** True when no price was supplied and the planning price stands in; the view supplies none. */
  readonly priceDefaulted: boolean;
  /** The modelled day these figures are built on: its duties, routes and the buses that ran. */
  readonly day: ModelledDaySummary;
  /** Buses that did not run that day: they have no distance and are in no total or row. */
  readonly notRunCount: number;
  /** Totals over the buses that ran; `busCount` is their number. */
  readonly totals: FuelTotals;
  readonly perClass: readonly FuelGroupRow[];
  /** The FUEL_ROUTE_CAP routes with the highest cost, dearest first. */
  readonly perRoute: readonly FuelGroupRow[];
  readonly routeTotal: number;
  /** The routes beyond the cap, summed, so the listed rows and this one add to `totals`. */
  readonly otherRoutes: FuelOtherRoutes | null;
  /** At most FUEL_FLAGGED_CAP, largest variance first. */
  readonly flagged: readonly FuelFlaggedBus[];
  readonly flaggedTotal: number;
  /** Buses with no distance for the day: counted, never listed as zero. */
  readonly noDistanceCount: number;
  /** Buses with distance but too few peers to compare. */
  readonly noComparisonCount: number;
  /**
   * Buses above the threshold that are not listed because fewer than `minPeers`
   * of their peers lie near the peers' median (`peers_differ`).
   */
  readonly peersDifferCount: number;
  readonly rule: { readonly thresholdPct: number; readonly minPeers: number };
}
