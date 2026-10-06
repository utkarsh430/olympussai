import type { DepotBusView } from '../api';
import type { ServiceClass } from '../sim/types';
import type { Coverage, DepotSummary } from '../types';

/*
 * Ridership, revenue and economics. Nothing here is measured: the feed carries
 * no ticketing. Every figure is MODELLED; a route length, where real, is
 * DERIVED, but the earnings built on it stay MODELLED.
 */

/** What the generator needs to know about one route on one day. */
export interface RouteRidershipInput {
  readonly routeName: string;
  readonly serviceClass: ServiceClass;
  /** Buses running the route today. */
  readonly buses: number;
  readonly seatsPerBus: number;
  readonly scheduledDurationMin: number | null;
  /** The profiled length; null when the route's stops have not been fetched. */
  readonly lengthKm: number | null;
}

/** Route facts from the catalogue, looked up by route name. */
export interface RouteFacts {
  readonly routeName: string;
  readonly scheduledDurationMin: number | null;
  readonly lengthKm: number | null;
}

export type RevenueBasis = 'length_known' | 'flat_fare_unknown_length';

/** One route's modelled day. Whole boardings, whole rupees. */
export interface RouteRidershipDay {
  readonly routeName: string;
  readonly serviceClass: ServiceClass;
  readonly trips: number;
  readonly seatsPerTrip: number;
  /** Seat-trips offered: trips times seats per trip. */
  readonly seatCapacity: number;
  /** Modelled share of seats filled, never above MAX_LOAD_FACTOR. */
  readonly loadFactor: number;
  readonly boardings: number;
  readonly revenue: number;
  /** The route's real length when known (DERIVED); null otherwise. */
  readonly lengthKm: number | null;
  readonly revenueBasis: RevenueBasis;
  readonly provenance: 'modelled';
}

export type EarningsWithheldReason = 'unknown_length' | 'no_service_km';

export interface RouteRevenueFigure extends RouteRidershipDay {
  /** Out-and-back kilometres run; null with an unknown length. */
  readonly serviceKm: number | null;
  /** Rupees per service kilometre, two decimals; null when withheld. */
  readonly earningsPerKm: number | null;
  readonly earningsWithheld: EarningsWithheldReason | null;
  /** DERIVED when a real length was used; null when none was. */
  readonly lengthProvenance: 'derived' | null;
}

export interface DepotRevenueTotals {
  readonly routes: number;
  readonly trips: number;
  readonly boardings: number;
  readonly revenue: number;
  /** Ratio of sums: occupied seats over seats offered; null with no capacity. */
  readonly loadFactor: number | null;
  /** Share of the revenue built on the flat fare (route length unknown); null with no revenue. */
  readonly flatFareRevenueShare: number | null;
  /** Share of the routes built on the flat fare; null with no routes. */
  readonly flatFareRouteShare: number | null;
  /** Revenue over service km of the routes with a known length only. */
  readonly earningsPerKm: number | null;
  /** "Based on N of M routes". */
  readonly earningsCoverage: Coverage;
  readonly provenance: 'modelled';
}

export interface RevenueAnalysis {
  readonly perRoute: readonly RouteRevenueFigure[];
  readonly depot: DepotRevenueTotals;
}

/** The seam to where ridership comes from; modelled today, ticketing data later. */
export interface RevenueRepository {
  ridershipDay(
    buses: readonly DepotBusView[],
    routeFacts: readonly RouteFacts[],
    operatingDate: string,
  ): Promise<readonly RouteRidershipDay[]>;
}

export type EconomicsComponentKey = 'earningsPerKm' | 'costPerKm' | 'loadFactor';

export type EconomicsRankReason =
  | 'ok'
  | 'not_a_depot'
  | 'fleet_too_small'
  | 'missing_component'
  | 'peer_group_too_small'
  | 'thin_route_coverage';

export interface EconomicsInput {
  readonly depot: DepotSummary;
  readonly earningsPerKm: number | null;
  /** From the fuel analysis. */
  readonly costPerKm: number | null;
  readonly loadFactor: number | null;
  /** Routes of known length out of routes run: what the earnings figure rests on. */
  readonly earningsCoverage: Coverage;
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
