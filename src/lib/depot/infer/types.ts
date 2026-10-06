import type { Coverage } from '../types';

/**
 * A depot yard learned from where the depot's buses park. Inferred, never
 * surveyed: screens that use it say so and show `parked` / `inCluster`.
 */
export interface Yard {
  readonly lat: number;
  readonly lng: number;
  readonly radiusM: number;
  /** Parked buses considered. */
  readonly parked: number;
  /** Of those, how many fell inside the winning cluster. */
  readonly inCluster: number;
}

export type BusLocation = 'in_yard' | 'at_other_yard' | 'away' | 'unknown';

export interface LocatedBus {
  readonly location: BusLocation;
  /** The depot whose yard the bus is in, when `at_other_yard`. */
  readonly otherDepotId: string | null;
  /** One decimal; null without a home yard or a position. */
  readonly distanceFromYardKm: number | null;
}

/**
 * Where a scheduled departure stands against the feed clock:
 *  - `upcoming`  not yet due
 *  - `due`       inside the grace period after its scheduled start
 *  - `departed`  evidence the bus left (a credible actual time, or it is out)
 *  - `overdue`   past grace and still in the yard
 *  - `ended`     its scheduled window is over
 *  - `unknown`   the bus is dark or cannot be located, so nothing can be said
 */
export type OutshedState = 'upcoming' | 'due' | 'departed' | 'overdue' | 'ended' | 'unknown';

export interface OutshedRow {
  readonly registrationNumber: string;
  readonly routeName: string | null;
  readonly journeyCode: string | null;
  readonly scheduledStart: string;
  readonly scheduledEnd: string | null;
  readonly state: OutshedState;
  /** Departed with a credible actual time: actual minus scheduled. */
  readonly minutesLate: number | null;
  readonly minutesOverdue: number | null;
  readonly evidence: 'actual_time' | 'left_yard' | 'none';
}

export interface OutshedSummary {
  readonly rows: readonly OutshedRow[];
  readonly counts: Readonly<Record<OutshedState, number>>;
  /** Buses carrying a schedule for the feed date, out of the fleet considered. */
  readonly coverage: Coverage;
}
