import type { Provenance } from '../types';
import type { ServiceClass } from '../sim/types';

/** One modelled duty: a bus-shift that starts at the depot. */
export interface Duty {
  readonly id: string;
  readonly depotId: string;
  readonly routeName: string;
  /** Minutes from midnight of the operating date. */
  readonly startMin: number;
  /** May exceed 1440 when the duty runs past midnight. */
  readonly endMin: number;
  readonly serviceClass: ServiceClass;
  readonly provenance: Provenance;
}

/** The generator's result: the duties, and routes the requirement was too small to cover. */
export interface ModelledDuties {
  readonly duties: readonly Duty[];
  readonly routesWithoutDuty: readonly string[];
}

export interface HungarianResult {
  /** Column chosen for each row, or -1 when the row is unassigned. */
  readonly rowToCol: readonly number[];
  /** Sum of the chosen finite costs. */
  readonly total: number;
}

export interface ParkingPlan {
  readonly slots: readonly ParkingSlot[];
  /** Buses that a bus nearer the lane mouth would trap. Zero for any input that fits. */
  readonly blocked: number;
  /** Registrations that do not fit, sorted. */
  readonly overflow: readonly string[];
}

/**
 * Why a bus is held out of the matching. `not_heard`: its last report is older
 * than the reporting window, moving or standing. `class_mismatch`
 * is no longer produced (class is a cost); kept so the vocabulary
 * only grows.
 */
export type Ineligibility = 'off_road' | 'dark' | 'not_in_yard' | 'not_heard' | 'class_mismatch';

/**
 * The moment a plan is made "as of". A plan for the feed's
 * own operating date is as of the feed clock (`feedMinute`, minutes past
 * midnight), or of no clock when the feed has none. A plan for a later date,
 * and the feed's own date before its first duty starts (`before_first_duty`),
 * is not as of any moment of that day: how the buses stand now cannot rank
 * them for it.
 */
export type PlanNow =
  | { readonly kind: 'feed_time'; readonly feedMinute: number }
  | { readonly kind: 'no_feed_clock' }
  | { readonly kind: 'before_first_duty' }
  | { readonly kind: 'later_day' };

/**
 * Which of the three ways a plan was made. There is one plan
 * per snapshot, depot and date, and it is in exactly one of them:
 *  - `as_of_feed_time`: the feed's own date once its first duty has started
 *    (or a feed with no clock, which cannot be placed before a duty): buses are
 *    ranked by how they stand now, out working first, and fitted to the feed time;
 *  - `before_first_duty`: the feed's own date before its first duty starts. The
 *    day has not begun: every eligible bus can take a duty, the buses standing
 *    in the yard first (they leave first) and the buses still out after them,
 *    with no time fit; the night parking order reads this same plan;
 *  - `later_day`: a date after the feed's (the night parking order's, once the
 *    feed's day has begun). It covers only the buses in the yard.
 */
export type PlanMode = 'as_of_feed_time' | 'before_first_duty' | 'later_day';

/**
 * How a bus with a duty stands now, by its live state: out on the road (in
 * service or not), standing in the depot's yard, or standing where location
 * cannot be judged because the depot has no yard established.
 */
export type BusStandingNow = 'on_road' | 'in_yard' | 'standing';

export interface DutyAssignment {
  readonly dutyId: string;
  readonly registrationNumber: string | null;
  readonly reason: 'assigned' | 'no_eligible_bus';
  /** How the duty's bus stands now; null when the duty has no bus. */
  readonly busStanding: BusStandingNow | null;
}

/** Spare buses by how they stand now: a spare bus may be out on the road. */
export interface SpareByStanding {
  readonly inYard: number;
  /** Standing where the depot has no yard established, so location is not judged. */
  readonly standing: number;
  readonly onRoad: number;
}

export interface AssignmentPlan {
  readonly assignments: readonly DutyAssignment[];
  /** Eligible buses left without a duty, sorted by registration. */
  readonly spareBuses: readonly string[];
  /** The spare buses counted by how they stand now. */
  readonly spareByStanding: SpareByStanding;
  /** Sorted by registration. */
  readonly excluded: readonly {
    readonly registrationNumber: string;
    readonly reason: Ineligibility;
  }[];
  readonly unassignedDuties: number;
}

/** A yard lane: buses nose to tail; the last in is the first out. */
export interface Lane {
  readonly id: string;
  readonly depth: number;
}

export interface ParkingSlot {
  readonly laneId: string;
  /** 0 is the back of the lane; the highest position is its mouth. */
  readonly position: number;
  readonly registrationNumber: string;
  readonly firstDutyStartMin: number | null;
}
