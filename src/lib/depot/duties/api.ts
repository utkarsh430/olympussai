import type { DepotFeedEnvelope } from '../api';
import type { ServiceClass } from '../sim/types';

/**
 * What a duty is doing on the board. `assigned` means the matching proposed a
 * bus; the other two are duties left without one. `bus_not_in_yard` is used when
 * at least one bus of the duty's class is held out of the matching because it is
 * not in the yard; `no_bus` is every other shortfall.
 */
export type DutyState = 'assigned' | 'no_bus' | 'bus_not_in_yard';

/** The buses the matching could not use, by reason. */
export interface DutyBlockers {
  /**
   * Not in the yard. When the response says `eligibilityIgnoredLocation`, there
   * is no yard: this then counts buses that are not standing on a recent report.
   */
  readonly notInYard: number;
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
  readonly state: DutyState;
  /** For an unassigned duty: the buses of its own class held out of the matching. Null when assigned. */
  readonly blockers: DutyBlockers | null;
}

/** Counts that reconcile: duties = assigned + unassigned. */
export interface DutyBoardCounts {
  readonly duties: number;
  readonly assigned: number;
  readonly unassigned: number;
  /** Eligible buses with no duty. */
  readonly spare: number;
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
  /** Feed rows left out because their registration repeated an earlier row's. Always sent. */
  readonly duplicateRowsDropped?: number;
}
