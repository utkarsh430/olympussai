import type { DepotFeedEnvelope } from '../api';
import type { ServiceClass } from '../sim/types';
import type { BusStandingNow, SpareByStanding } from './types';

/**
 * What a duty is doing on the board. `assigned` means the matching proposed a
 * bus (standing, or already out on the road: see `busStanding`); the other two
 * are duties left without one because no eligible bus of any class was left.
 * `bus_not_in_yard` is used when at least one bus, of any class, is held out
 * because it stands away from the yard; `no_bus` is every other shortfall.
 */
export type DutyState = 'assigned' | 'no_bus' | 'bus_not_in_yard';

/** The buses the matching could not use, by reason. */
export interface DutyBlockers {
  /**
   * Standing away from the established yard. Zero when the response says
   * `eligibilityIgnoredLocation` (no yard: location decides nothing).
   */
  readonly notInYard: number;
  /**
   * Not heard within the reporting window, moving or standing (ruling S55).
   * Always sent; zero when the feed has no clock (`recencyNotJudged`).
   */
  readonly notHeard?: number;
  readonly offRoad: number;
  readonly dark: number;
}

/** One modelled duty with the bus the matching proposed for it, if any. */
export interface BoardDuty {
  readonly id: string;
  readonly routeName: string;
  /** Minutes from midnight of the operating date. */
  readonly startMin: number;
  /** May exceed 1440 when the duty runs past midnight. */
  readonly endMin: number;
  readonly serviceClass: ServiceClass;
  readonly registrationNumber: string | null;
  /**
   * How the duty's bus stands now (ruling S47): `on_road` (in service or on
   * the road, already out working), `in_yard`, or `standing` where the depot
   * has no yard to judge by. Null when the duty has no bus. Always sent; a
   * duty with a bus is `assigned` whatever this says.
   */
  readonly busStanding?: BusStandingNow | null;
  readonly state: DutyState;
  /** For an unassigned duty: the buses of every class held out of the matching. Null when assigned. */
  readonly blockers: DutyBlockers | null;
}

/** Counts that reconcile: duties = assigned + unassigned. */
export interface DutyBoardCounts {
  readonly duties: number;
  readonly assigned: number;
  readonly unassigned: number;
  /** Eligible buses with no duty. */
  readonly spare: number;
  /** The spare buses by where they stand now; they sum to `spare` (ruling S55). Always sent. */
  readonly spareByStanding?: SpareByStanding;
  /** Buses held out of the matching, by reason, whatever their class. */
  readonly excluded: DutyBlockers;
}

/** GET /api/upsrtc/depot/[depotId]/duties */
export interface DutyBoardResponse extends DepotFeedEnvelope {
  readonly depotId: string;
  readonly depotName: string;
  /** The date the duties are modelled for, read from the feed clock. */
  readonly operatingDate: string;
  /** The modelled number of buses the depot needs at peak; sets the number of duties. */
  readonly peakRequirement: number;
  /** Distinct route names the depot's buses are seen running. */
  readonly routeCount: number;
  /** Ordered by start, then id. */
  readonly duties: readonly BoardDuty[];
  /** Registrations of eligible buses left without a duty, sorted. */
  readonly spareBuses: readonly string[];
  /** Routes the requirement was too small to give a duty to, alphabetical. */
  readonly routesWithoutDuty: readonly string[];
  readonly counts: DutyBoardCounts;
  /**
   * True when the depot has no yard established, so location could not decide
   * eligibility: every standing bus heard recently was eligible. Always sent.
   */
  readonly eligibilityIgnoredLocation?: boolean;
  /**
   * True when the feed has no clock, so no bus's last report could be aged and
   * recency did not decide eligibility (ruling S55). Always sent.
   */
  readonly recencyNotJudged?: boolean;
  /** Feed rows left out because their registration repeated an earlier row's. Always sent. */
  readonly duplicateRowsDropped?: number;
}
