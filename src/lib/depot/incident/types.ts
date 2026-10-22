import type { Figure, LatLng } from '../types';

export type IncidentSignal = 'towing' | 'emergency_flag' | 'stopped_on_route' | 'not_heard_on_route' | 'power_off';
export type IncidentConfidence = 'high' | 'medium' | 'low';
export type IncidentOrigin = 'detected' | 'declared';
export type ExclusionReason =
  | 'in_yard'
  | 'at_other_yard'
  | 'at_stop'
  | 'at_terminal'
  | 'near_yard'
  | 'trip_ended'
  | 'trip_not_started'
  | 'no_journey_today'
  | 'off_road'
  | 'no_position'
  | 'moving';

export interface Incident {
  readonly id: string;
  readonly origin: IncidentOrigin;
  readonly registrationNumber: string;
  readonly depotId: string;
  readonly routeName: string | null;
  readonly journeyId: string | null;
  readonly position: LatLng | null;
  /** Minutes still since the holder first saw the bus still here; null when not observed across samples. */
  readonly stoppedMinutes: number | null;
  readonly signals: readonly IncidentSignal[];
  readonly confidence: IncidentConfidence;
  readonly nearestStop: { readonly name: string; readonly distanceM: number; readonly sequence: number } | null;
  readonly profileState: 'profiled' | 'not_loaded';
  readonly scheduledEnd: string | null;
  readonly lastHeardMin: number | null;
}

export interface DetectionSummary {
  readonly considered: number;
  readonly excluded: Readonly<Partial<Record<ExclusionReason, number>>>;
  readonly routesNotProfiled: number;
}

export type ReplacementKind = 'own_yard_spare' | 'other_depot_spare' | 'following_bus' | 'block_ending_bus' | 'next_scheduled';
export type CrewNote = 'original_crew_continues' | 'own_crew_aboard' | 'ferry_driver_needed' | 'no_ferry_driver';
export type ExcludedReason = 'not_enough_seats' | 'no_ferry_driver' | 'ahead_on_route' | 'beyond_range' | 'direction_unknown';

export interface ReplacementCandidate {
  readonly id: string;
  readonly kind: ReplacementKind;
  readonly registrationNumber: string | null;
  readonly depotId: string;
  readonly depotName: string;
  readonly arrivalMinutes: number | null;
  readonly passengersMovingMinutes: number | null;
  readonly deadKm: number;
  readonly knockOnMinutes: number;
  readonly seatsFree: number;
  readonly crew: CrewNote;
  readonly direction: 'behind' | 'unknown' | null;
  readonly excludedReason: ExcludedReason | null;
}

export interface RemainingTrip {
  readonly stops: number | null;
  readonly km: number | null;
  readonly minutes: number | null;
  readonly destination: string | null;
}

export interface RestOfBlock {
  readonly blockId: string;
  readonly remainingPieces: number;
  readonly endMin: number;
  readonly coveredBy: 'replacement_continues' | 'reassigned' | 'uncovered';
}

export interface DayKnockOn {
  readonly blocksWithoutBusDelta: number;
  readonly uncoveredBusHoursDelta: number;
}

export interface ReplacementPlan {
  readonly incident: Incident;
  readonly passengersAboard: Figure<number>;
  readonly remainingTrip: RemainingTrip | null;
  readonly candidates: readonly ReplacementCandidate[];
  readonly recommended: ReplacementCandidate | null;
  readonly baseline: ReplacementCandidate;
  readonly restOfBlock: RestOfBlock | null;
  readonly dayKnockOn: DayKnockOn | null;
  readonly clamped: readonly string[];
  readonly planKey: string;
}

/** What the replacement engine is given; every list is gathered by the view through ports. */
export interface SpareBus {
  readonly registrationNumber: string;
  readonly position: LatLng;
  readonly seats: number;
}
export interface OtherDepotSpares {
  readonly depotId: string;
  readonly depotName: string;
  readonly position: LatLng;
  readonly spares: number;
  readonly seats: number;
  readonly ferryDriverSlotsFree: number;
}
export interface RouteBus {
  readonly registrationNumber: string;
  readonly position: LatLng;
  readonly seats: number;
  readonly aboard: number;
  /** The bus's nearest-stop sequence on the profile; null when not profiled. */
  readonly sequence: number | null;
}
export interface BlockEndingBus {
  readonly registrationNumber: string;
  readonly position: LatLng;
  readonly seats: number;
  readonly endMin: number;
}
export interface ReplacementInput {
  readonly incident: Incident;
  readonly depotName: string;
  readonly feedMinute: number | null;
  readonly remainingTrip: RemainingTrip | null;
  readonly passengersAboard: Figure<number>;
  readonly ownSpares: readonly SpareBus[];
  readonly ownFerryDriverSlotsFree: number;
  readonly otherDepots: readonly OtherDepotSpares[];
  readonly busesOnRoute: readonly RouteBus[];
  readonly blockEndingBuses: readonly BlockEndingBus[];
  readonly cycleMinutes: number | null;
  readonly busesOnRouteNow: number;
  readonly nextBusSeatsFree: number;
  readonly restOfBlock: Omit<RestOfBlock, 'coveredBy'> | null;
  readonly dayKnockOn: DayKnockOn | null;
  readonly roadTime: (from: LatLng, to: LatLng) => { readonly km: number; readonly minutes: number };
}
