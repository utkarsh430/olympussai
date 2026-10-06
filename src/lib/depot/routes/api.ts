import type { DepotFeedEnvelope } from '../api';
import type { RouteMove, UnchangedReason } from '../optimise/allocateTypes';
import type { TripBasis } from '../sim/tripFrequency';
import type { TripModelParams } from '../sim/tripFrequencyConfig';
import type { Coverage, Figure } from '../types';
import type { DeadKm } from './deadKm';
import type { RouteRow } from './routeTableTypes';

/**
 * Payloads of `GET /api/upsrtc/depot/routes` and `GET /api/upsrtc/depot/allocation`.
 *
 * Provenance: the route table and stop lists are live or derived; dead
 * kilometres per trip are derived (depot position and located terminals);
 * trips per day are modelled, so anything multiplied by them is modelled.
 */

/** Where a page sends a route's name to profile it (one upstream call, then cached for the day). */
export const ROUTE_PROFILE_ENDPOINT = '/api/upsrtc/depot/route/{routeName}';

/** `yard`: centre of the inferred yard. `median`: median position of the depot's buses. */
export type DepotPositionKind = 'yard' | 'median';

/** Empty kilometres per trip between a route and one depot. Always derived. */
export interface RouteDeadKm extends DeadKm {
  readonly depotId: string;
  readonly depotPosition: DepotPositionKind;
  readonly provenance: 'derived';
}

export interface RouteListItem extends RouteRow {
  /** True when the route's profile (real stop list) is already cached for the operating day. */
  readonly profiled: boolean;
  /** First and last stop names from the profile; null until profiled. */
  readonly firstStop: string | null;
  readonly lastStop: string | null;
  readonly lengthKm: number | null;
  readonly scheduledDurationMin: number | null;
  /** Modelled whole trips per day; `provenance` is always `modelled`. */
  readonly tripsPerDay: Figure;
  readonly tripsBasis: TripBasis;
  /** From the primary depot; null without a primary depot, its position or a profile. */
  readonly deadKm: RouteDeadKm | null;
}

export interface RoutesCoverage {
  /** Routes with a cached profile, out of routes listed. */
  readonly profiled: Coverage;
  /** Routes whose trip count is anchored on a scheduled duration, out of routes listed. */
  readonly tripsOnDuration: Coverage;
}

/** GET /api/upsrtc/depot/routes */
export interface DepotRoutesResponse extends DepotFeedEnvelope {
  readonly operatingDate: string;
  /** The depot filter applied (routes with that depot among their operators), or null. */
  readonly depotId: string | null;
  /** Buses descending, then route name. */
  readonly routes: readonly RouteListItem[];
  readonly coverage: RoutesCoverage;
  readonly tripModel: TripModelParams;
  readonly profileEndpoint: string;
}

/** Why a route takes no part in the allocation, in order of precedence. */
export type AllocationExclusion =
  /** Two depots field the same number of buses, or none has a home depot. */
  | 'no_primary_depot'
  /** Most of its buses carry no home depot in the feed (the unassigned bucket). */
  | 'unassigned_bucket'
  /** Its majority operator is a hired, electric or enforcement unit, not a depot. */
  | 'operator_not_depot'
  /** More buses than the trip model accepts on one route name: a feed error, not planned. */
  | 'bus_count_over_cap'
  /** No profile cached today; opening the route loads one. */
  | 'not_profiled'
  /** Fewer than two located stops: no terminals to measure from. */
  | 'too_few_located_stops'
  /** Its depot has neither an inferred yard nor a positioned bus. */
  | 'no_depot_position';

export interface AllocationExcludedRoute {
  readonly routeName: string;
  readonly primaryDepotId: string | null;
  readonly buses: number;
  /** The primary depot's name, from the feed; null without a primary depot. */
  readonly depotName: string | null;
  readonly reason: AllocationExclusion;
}

export interface AllocationMoveItem extends RouteMove {
  readonly fromDepotName: string;
  readonly toDepotName: string;
  /** Modelled. */
  readonly tripsPerDay: number;
  /** Derived, per trip, one decimal. */
  readonly fromDeadKmPerTrip: number;
  readonly toDeadKmPerTrip: number;
}

export interface AllocationUnchangedItem {
  readonly routeName: string;
  readonly depotId: string;
  readonly depotName: string;
  readonly reason: UnchangedReason;
  /** Modelled. */
  readonly tripsPerDay: number;
  /** Derived, per trip, from its current depot. */
  readonly deadKmPerTrip: number;
}

/** How each operating depot's position was found. */
export interface DepotPositionCounts {
  readonly yard: number;
  readonly median: number;
  readonly none: number;
  readonly provenance: 'derived';
}

export interface AllocationCoverage {
  /** Routes with a cached profile, out of every route in the live table. */
  readonly profiled: Coverage;
  /** Routes the plan covered, out of every route in the live table. */
  readonly planned: Coverage;
}

export interface AllocationParams {
  readonly minSavingKmPerDay: number;
  readonly maxMoves: number;
  readonly detourFactor: number;
  readonly tripModel: TripModelParams;
}

/** GET /api/upsrtc/depot/allocation. A recommendation only: nothing is reassigned. */
export interface DepotAllocationResponse extends DepotFeedEnvelope {
  readonly operatingDate: string;
  /** The depot filter applied to the lists; totals are always network-wide. */
  readonly depotId: string | null;
  readonly recommendationOnly: true;
  readonly coverage: AllocationCoverage;
  readonly depotPositions: DepotPositionCounts;
  /** Network totals over planned routes; modelled, coverage = planned. */
  readonly beforeKmPerDay: Figure;
  readonly afterKmPerDay: Figure;
  readonly savedKmPerDay: Figure;
  /** Sorted by route name. */
  readonly moves: readonly AllocationMoveItem[];
  readonly unchanged: readonly AllocationUnchangedItem[];
  /** In route-table order: buses descending, then route name. */
  readonly excluded: readonly AllocationExcludedRoute[];
  readonly provenance: {
    readonly deadKmPerTrip: 'derived';
    readonly tripsPerDay: 'modelled';
    readonly kmPerDay: 'modelled';
    readonly capacity: 'modelled';
  };
  readonly params: AllocationParams;
  readonly profileEndpoint: string;
}
