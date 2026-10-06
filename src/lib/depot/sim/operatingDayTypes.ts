import type { DepotBusView } from '../api';
import type { Duty, PlanNow } from '../duties/types';
import type { DepotSummary } from '../types';
import type { ServiceClass } from './types';

/*
 * The one modelled operating day of a depot (ruling S41). Crew, fuel and
 * revenue all read this record, so their counts reconcile: duties = trips =
 * buses that ran (less any duties without a bus), and the distance the buses
 * covered is the service distance of the routes.
 */

/** DERIVED when the length is the route's real profiled one, MODELLED when it is a class figure. */
export type RouteLengthProvenance = 'derived' | 'modelled';

export interface RouteLength {
  /** One way, in kilometres. */
  readonly lengthKm: number;
  readonly lengthProvenance: RouteLengthProvenance;
}

/** One route's part of the day. */
export interface DayRoute extends RouteLength {
  readonly routeName: string;
  /** The class the route's name states, ordinary when it states none: its duties' class. */
  readonly serviceClass: ServiceClass;
  /** Out and back in whole tenths of a kilometre, so sums never drift. */
  readonly roundTripTenths: number;
  readonly duties: number;
  /** Duties that had a bus: one duty is one trip out and back. */
  readonly trips: number;
  /** Trips times the round trip, in kilometres to one decimal. */
  readonly serviceKm: number;
  /** Seats of the buses that ran the route, summed over its trips. */
  readonly seatsOffered: number;
}

/** One duty that ran, with the bus that ran it. */
export interface DayRun {
  readonly dutyId: string;
  readonly routeName: string;
  readonly registrationNumber: string;
  readonly dutyClass: ServiceClass;
  readonly busClass: ServiceClass;
  readonly classMatched: boolean;
  readonly seats: number;
  /** The duty's route out and back, to one decimal. */
  readonly distanceKm: number;
}

/**
 * A bus that did not run, and why: `unavailable`, off the road or dark;
 * `held_out`, held out of the matching though available (not heard recently,
 * or standing away from the yard: the plan's `excluded`); `no_duty`, eligible
 * with no duty left for it. `held_out` is added; the other two keep their meaning.
 */
export interface DayIdleBus {
  readonly registrationNumber: string;
  readonly reason: 'unavailable' | 'held_out' | 'no_duty';
}

export interface OperatingDay {
  readonly depotId: string;
  readonly operatingDate: string;
  /** Exactly the duty plan's duties for the depot and date, in its order. */
  readonly duties: readonly Duty[];
  readonly routesWithoutDuty: readonly string[];
  /** Routes with at least one duty, by name. */
  readonly routes: readonly DayRoute[];
  /** Exactly the duty plan's assignments with a bus, in duty order. */
  readonly runs: readonly DayRun[];
  /** Sorted by registration. A bus that did not run has no distance. */
  readonly notRun: readonly DayIdleBus[];
  readonly fleet: number;
  /** Buses neither off the road nor dark by their live state; held-out buses included. */
  readonly availableBuses: number;
  /** Duties left without a bus because fewer buses were available than duties. */
  readonly dutiesWithoutBus: number;
  readonly provenance: 'modelled';
}

export interface OperatingDayInput {
  readonly depot: DepotSummary;
  readonly buses: readonly DepotBusView[];
  /** The depot's modelled peak requirement: the number of duties. */
  readonly peakRequirement: number;
  /** Real one-way lengths of the routes whose profile is cached, by route name. */
  readonly realLengthKm: ReadonlyMap<string, number | null>;
  readonly operatingDate: string;
  /** False when the depot has no yard established; defaults to true, as the matcher's does. */
  readonly yardEstablished?: boolean;
  /** Minutes past midnight on the feed clock, for the matcher's time-fit tier; none by default. */
  readonly feedMinute?: number | null;
  /** As of when the plan is made; overrides `feedMinute` (ruling S55). */
  readonly now?: PlanNow;
}

/** The few counts every modelled page states about the day it is built on. */
export interface ModelledDaySummary {
  readonly duties: number;
  /** Routes with at least one duty. */
  readonly routes: number;
  readonly busesRan: number;
  readonly buses: number;
  readonly dutiesWithoutBus: number;
}
