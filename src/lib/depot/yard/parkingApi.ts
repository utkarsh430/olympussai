import type { DepotFeedEnvelope } from '../api';
import type { Figure } from '../types';

/**
 * Why the response carries no order. `planned` has lanes; the others are typed
 * empty states so a bad row or a missing yard never becomes a server error.
 */
export type ParkingState = 'planned' | 'no_yard' | 'no_buses' | 'not_plannable';

export interface ParkingCapacity {
  /** Parking bays of the depot master (no survey in the feed). */
  readonly bays: Figure<number>;
  /** Own buses the feed places in the yard now; null when no yard is established. */
  readonly inYard: Figure<number | null>;
  /** Buses of other depots standing in this yard. */
  readonly visiting: Figure<number>;
  /** The depot's fleet, for the capacity line when no yard is established. */
  readonly fleet: Figure<number>;
}

/** One place in a lane; position 1 is nearest the exit, so that bus leaves first. */
export interface ParkingLaneSlot {
  readonly position: number;
  readonly registrationNumber: string;
  /** Minutes from midnight of the operating date; null when no duty tomorrow. */
  readonly firstDutyStartMin: number | null;
}

export interface ParkingLane {
  readonly id: string;
  readonly depth: number;
  /** Ordered from the exit inwards. */
  readonly slots: readonly ParkingLaneSlot[];
}

export interface ParkingOverflowBus {
  readonly registrationNumber: string;
  readonly firstDutyStartMin: number | null;
  readonly reason: 'no_lane_space';
}

export interface ParkingOrder {
  readonly provenance: 'modelled';
  readonly lanes: readonly ParkingLane[];
  readonly overflow: readonly ParkingOverflowBus[];
  /** Buses the order would still box in. Zero for any order the planner can produce. */
  readonly blocked: number;
  readonly parkedCount: number;
}

/** GET /api/upsrtc/depot/[depotId]/parking */
export interface ParkingResponse extends DepotFeedEnvelope {
  readonly depot: { readonly id: string; readonly name: string };
  /** YYYY-MM-DD the order is for: the day after the feed date. */
  readonly operatingDate: string;
  readonly state: ParkingState;
  readonly capacity: ParkingCapacity;
  /**
   * Own in-yard rows left out of the order because the registration is blank or
   * repeated. The order's buses plus its overflow equal the in-yard count minus this.
   */
  readonly droppedRows: number;
  /** Null unless `state` is `planned`. */
  readonly order: ParkingOrder | null;
}
