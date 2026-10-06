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

export interface TimetableRepository {
  dutiesFor(depotId: string, operatingDate: string): Promise<readonly Duty[]>;
}

export type Ineligibility = 'off_road' | 'dark' | 'not_in_yard' | 'class_mismatch';

export interface DutyAssignment {
  readonly dutyId: string;
  readonly registrationNumber: string | null;
  readonly reason: 'assigned' | 'no_eligible_bus';
}

export interface AssignmentPlan {
  readonly assignments: readonly DutyAssignment[];
  /** Eligible buses left without a duty, sorted by registration. */
  readonly spareBuses: readonly string[];
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
