import { formatMinute } from '../duties/dutyBoardModel';
import { formatCount } from '../format';
import type { ParkingLane, ParkingLaneSlot, ParkingState } from './parkingApi';

/** Shown with the order wherever it appears; the order is a proposal and nothing is dispatched. */
export const PLAN_NOTICE =
  'A suggested order for tonight, based on modelled duties and a modelled yard layout. It will be replaced when the timetable and a surveyed yard are supplied. Nothing is instructed or dispatched.';

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export interface CapacityInput {
  readonly bays: number;
  readonly inYard: number;
  readonly visiting: number;
}

/**
 * Buses in the yard against the modelled bays. Visiting buses take a bay too,
 * so they are counted here and stated separately by `visitingSentence`.
 */
export function capacitySentence({ bays, inYard, visiting }: CapacityInput): string {
  const used = inYard + visiting;
  const free = bays - used;
  const head = `${formatCount(used)} of ${formatCount(bays)} modelled ${plural(bays, 'bay', 'bays')} in use`;
  if (free > 0) return `${head}; ${formatCount(free)} free.`;
  if (free === 0) return `${head}; none free.`;
  return `${head}; ${formatCount(-free)} over.`;
}

export function visitingSentence(visiting: number): string {
  if (visiting === 0) return 'No buses from other depots are standing in the yard.';
  if (visiting === 1) {
    return '1 bus from another depot is standing in the yard; it takes a bay but is not ordered.';
  }
  return `${formatCount(visiting)} buses from other depots are standing in the yard; they take bays but are not ordered.`;
}

/** With no yard established there is no in-yard count, so only the fleet is set against the bays. */
export function fleetOnlyCapacitySentence(fleet: number, bays: number): string {
  return `No yard is established, so only the fleet can be set against capacity: ${formatCount(fleet)} ${plural(fleet, 'bus', 'buses')} in the fleet, ${formatCount(bays)} modelled ${plural(bays, 'bay', 'bays')}.`;
}

export function laneHeading(lane: ParkingLane): string {
  const used = lane.slots.length;
  return `Lane ${lane.id}: ${formatCount(used)} of ${formatCount(lane.depth)} ${plural(lane.depth, 'place', 'places')} used`;
}

export function dutyText(firstDutyStartMin: number | null): string {
  return firstDutyStartMin === null
    ? 'no duty'
    : `first duty ${formatMinute(firstDutyStartMin)}`;
}

/** Position 1 is nearest the exit; the list reads from the exit inwards. */
export function slotText(slot: ParkingLaneSlot): string {
  return `${slot.position}. ${slot.registrationNumber}, ${dutyText(slot.firstDutyStartMin)}`;
}

export function overflowSentence(count: number): string {
  return count === 1
    ? '1 bus does not fit in the modelled lanes and is not ordered.'
    : `${formatCount(count)} buses do not fit in the modelled lanes and are not ordered.`;
}

export function overflowReasonText(reason: 'no_lane_space'): string {
  return reason === 'no_lane_space' ? 'No free place in any modelled lane' : '';
}

export interface BlockedLine {
  readonly warning: boolean;
  readonly text: string;
}

export function blockedSentence(blocked: number): BlockedLine {
  if (blocked <= 0) {
    return {
      warning: false,
      text: 'No bus is blocked in: each bus can leave without another being moved.',
    };
  }
  return {
    warning: true,
    text: `Warning: ${formatCount(blocked)} ${plural(blocked, 'bus would', 'buses would')} be blocked in by a bus that leaves later.`,
  };
}

const EMPTY_SENTENCE: Readonly<Record<ParkingState, string>> = {
  planned: '',
  no_yard:
    'No yard is established for this depot, so no parking order is shown; it would have to be invented.',
  no_buses: 'This depot has no buses in the feed, so there is nothing to park.',
  not_plannable:
    'The parking order could not be worked out from the rows in the feed, so none is shown.',
};

export function emptyOrderSentence(state: ParkingState): string {
  return EMPTY_SENTENCE[state];
}
