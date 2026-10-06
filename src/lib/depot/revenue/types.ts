import type { OperatingDay, RouteLengthProvenance } from '../sim/operatingDayTypes';
import type { ServiceClass } from '../sim/types';
import type { Coverage, DepotSummary } from '../types';

/*
 * Ridership, revenue and economics. Nothing here is measured: the feed carries
 * no ticketing. Every figure is MODELLED; a route length, where real, is
 * DERIVED, but the earnings built on it stay MODELLED.
 */

/** One route's modelled day. Whole boardings, whole rupees. */
export interface RouteRidershipDay {
  readonly routeName: string;
  readonly serviceClass: ServiceClass;
  readonly trips: number;
  readonly seatsPerTrip: number;
  /**
   * The seats offered on the route over the modelled day (the day's seats offered, capped at
   * trips times the largest bus); seats per trip is derived from it, not the other way round.
   */
  readonly seatCapacity: number;
  /** Modelled share of seats filled, never above MAX_LOAD_FACTOR. */
  readonly loadFactor: number;
  readonly boardings: number;
  readonly revenue: number;
  /** One way: the real length (DERIVED) or the modelled typical length of the class. */
  readonly lengthKm: number;
  readonly lengthProvenance: RouteLengthProvenance;
  /** The operating day's figure: trips times the route out and back, to one decimal. */
  readonly serviceKm: number;
  readonly provenance: 'modelled';
}

/** Earnings per km are withheld only when nothing ran on the route. */
export type EarningsWithheldReason = 'no_service_km';

export interface RouteRevenueFigure extends RouteRidershipDay {
  /** Rupees per service kilometre, two decimals; null when withheld. */
  readonly earningsPerKm: number | null;
  readonly earningsWithheld: EarningsWithheldReason | null;
}

export interface DepotRevenueTotals {
  readonly routes: number;
  readonly trips: number;
  readonly boardings: number;
  readonly revenue: number;
  /** Ratio of sums: occupied seats over seats offered; null with no capacity. */
  readonly loadFactor: number | null;
  /** Kilometres run on every route, to one decimal: the fuel page's distance. */
  readonly serviceKm: number;
  /** Share of the revenue on routes whose length is modelled; null with no revenue. */
  readonly modelledLengthRevenueShare: number | null;
  /** Revenue over service km of every route. */
  readonly earningsPerKm: number | null;
  /** Routes whose length is from a real profile, out of the routes run. Never a reason to hide a figure. */
  readonly lengthCoverage: Coverage;
  readonly provenance: 'modelled';
}

export interface RevenueAnalysis {
  readonly perRoute: readonly RouteRevenueFigure[];
  readonly depot: DepotRevenueTotals;
}

/** The seam to where ridership comes from; modelled today, ticketing data later. */
export interface RevenueRepository {
  ridershipDay(day: OperatingDay): Promise<readonly RouteRidershipDay[]>;
}

export type EconomicsComponentKey = 'earningsPerKm' | 'costPerKm' | 'loadFactor';

export type EconomicsRankReason =
  | 'ok'
  | 'not_a_depot'
  | 'fleet_too_small'
  | 'missing_component'
  | 'peer_group_too_small';

export interface EconomicsInput {
  readonly depot: DepotSummary;
  readonly earningsPerKm: number | null;
  /** From the fuel analysis. */
  readonly costPerKm: number | null;
  readonly loadFactor: number | null;
  /** Routes whose length is from a real profile, out of the routes run. */
  readonly lengthCoverage: Coverage;
}

export interface EconomicsComponent {
  readonly key: EconomicsComponentKey;
  readonly value: number | null;
  readonly peerMedian: number | null;
  /** Routes the value rests on; set on earnings per km only, null on the others. */
  readonly coverage: Coverage | null;
  /** Robust z signed so higher is better; null when unscored. */
  readonly z: number | null;
  readonly contribution: number;
  readonly provenance: 'modelled';
}

/** A modelled score kept apart from the efficiency index; never a `DepotScore`. */
export interface DepotEconomicsScore {
  readonly depotId: string;
  readonly peerGroup: 'small' | 'medium' | 'large' | 'all' | null;
  readonly ranked: boolean;
  readonly reason: EconomicsRankReason;
  readonly missing: readonly EconomicsComponentKey[];
  /** 0 to 100, one decimal; null when not ranked. */
  readonly economicsIndex: number | null;
  readonly rank: number | null;
  readonly peerCount: number | null;
  readonly components: readonly EconomicsComponent[];
  readonly provenance: 'modelled';
}
