import { formatMinute } from '../duties/dutyBoardModel';
import type { DepotDetailResponse } from '../api';
import { formatCount, formatPlainDate } from '../format';
import type { ParkingLane, ParkingOverflowReason, ParkingState } from './parkingApi';

/** Shown with the order wherever it appears; the order is a proposal and nothing is dispatched. */
export const PLAN_NOTICE =
  'A suggested order, based on modelled duties and a modelled yard layout. It will be replaced when the timetable and a surveyed yard are supplied. Nothing is instructed or dispatched.';

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** The plan is for the day after the feed date, so it names the date and never a time of day. */
export function planDateSentence(operatingDate: string): string {
  return `For departures on ${formatPlainDate(operatingDate)}.`;
}

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

/**
 * What the capacity panel shows. The counts come from the depot detail the yard
 * page already holds; only `bays` (modelled) comes from the parking endpoint, so
 * a failed parking request leaves the live counts standing and `bays` null.
 */
export interface CapacityView {
  /** Own buses the feed places in the yard; null when no yard is established. */
  readonly inYard: number | null;
  readonly visiting: number;
  readonly fleet: number;
  /** Modelled bays; null until the parking endpoint has answered. */
  readonly bays: number | null;
}

export function capacityViewOf(detail: DepotDetailResponse, bays: number | null): CapacityView {
  return {
    inYard: detail.yard.value === null ? null : detail.locationMix.in_yard,
    visiting: detail.visitors.length,
    fleet: detail.depot.fleet,
    bays,
  };
}

/** The live counts on their own, when the modelled bay count is missing. */
export function baysMissingSentence(view: CapacityView, pending: boolean): string {
  const why = pending
    ? 'The modelled bay count is loading.'
    : 'The modelled bay count is unavailable, so use is not set against capacity.';
  const counts =
    view.inYard === null
      ? `No yard is established; ${formatCount(view.fleet)} ${plural(view.fleet, 'bus', 'buses')} in the fleet.`
      : `${formatCount(view.inYard)} ${plural(view.inYard, 'bus', 'buses')} in the yard, ${formatCount(view.visiting)} visiting.`;
  return `${counts} ${why}`;
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

export function overflowSentence(count: number): string {
  return count === 1
    ? '1 bus does not fit in the modelled lanes and is not ordered.'
    : `${formatCount(count)} buses do not fit in the modelled lanes and are not ordered.`;
}

export function overflowReasonText(reason: ParkingOverflowReason): string {
  return reason === 'places_taken_by_visitors'
    ? 'Places taken by visiting buses'
    : 'No free place in any modelled lane';
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
  no_buses: 'No bus of this depot is in its yard to order.',
  not_plannable:
    'The parking order could not be worked out from the rows in the feed, so none is shown.',
};

export function emptyOrderSentence(state: ParkingState): string {
  return EMPTY_SENTENCE[state];
}

/** Empty when every in-yard row was ordered; otherwise says how many rows were left out and why. */
export function droppedRowsSentence(dropped: number): string {
  if (dropped <= 0) return '';
  return dropped === 1
    ? '1 in-yard row with a blank or repeated registration is left out of the order.'
    : `${formatCount(dropped)} in-yard rows with a blank or repeated registration are left out of the order.`;
}
