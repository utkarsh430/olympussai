import type { DepotBusView } from '../api';
import type { CrewRepository } from '../crew/types';
import type { NeedInputs } from '../service/types';
import type { DepotSummary, Provenance } from '../types';

/*
 * The seams the scheduler reads through. Each has one adapter today and is
 * replaced by a real feed with a new adapter in the composition root; the
 * engine never changes.
 */

export interface RouteNeedDay {
  readonly routeName: string;
  /** 24 entries of boardings. */
  readonly boardingsByHour: readonly number[];
  readonly need: NeedInputs;
  /** 24 entries: buses needed on the road, across every depot running the route. */
  readonly neededByHour: readonly number[];
  readonly provenance: Provenance;
}

/** Passenger demand by hour; today the hourly demand model, later ticketing. */
export interface RouteNeedPort {
  needByHour(routeName: string, operatingDate: string): Promise<RouteNeedDay>;
}

export interface RouteTiming {
  readonly journeyMinutes: number;
  readonly layoverMinutes: number;
  readonly cycleMinutes: number;
  readonly provenance: Provenance;
}

/** A route's running time; today the cached profile, the feed's schedule or the trip model, later a timetable master. */
export interface RouteTimingPort {
  timingFor(routeName: string, operatingDate: string): Promise<RouteTiming>;
}

export interface DeadRunning {
  readonly outKm: number;
  readonly inKm: number;
  readonly provenance: Provenance;
}

/** Empty running from the depot to a route's terminals; today the inferred yard and the cached profile. */
export interface DeadRunningPort {
  deadKmFor(depotId: string, routeName: string): Promise<DeadRunning | null>;
}

export interface BusHold {
  readonly registrationNumber: string;
  readonly reason: 'job_card_open' | 'service_overdue';
  readonly provenance: Provenance;
}

/** Buses the workshop holds back today; later the maintenance work-order feed. */
export interface MaintenanceHoldPort {
  holdsFor(
    depot: DepotSummary,
    buses: readonly DepotBusView[],
    operatingDate: string,
  ): Promise<readonly BusHold[]>;
}

export interface SchedulePorts {
  readonly need: RouteNeedPort;
  readonly timing: RouteTimingPort;
  readonly deadRunning: DeadRunningPort;
  readonly crew: CrewRepository;
  readonly holds: MaintenanceHoldPort;
}
