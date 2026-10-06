import { UNASSIGNED_DEPOT_ID } from '../types';
import { formatKm, toTenths } from './allocationWording';
import type { RouteListItem } from './api';
import type { RouteDelay } from './routeTableTypes';

/** The words in each route-table cell; the component only lays them out. */

const DASH = '—';
const MINUS = '−';

export interface OperatorView {
  readonly depotId: string;
  readonly depotName: string;
  readonly buses: number;
  /** The bucket of buses with no home depot is not a depot, so it gets no link. */
  readonly linked: boolean;
  /** Named only when another depot also runs the route. */
  readonly majority: boolean;
}

export interface OperatorsView {
  readonly operators: readonly OperatorView[];
  readonly note: string | null;
}

export function operatorsView(route: RouteListItem): OperatorsView {
  const shared = route.operators.length > 1;
  return {
    operators: route.operators.map((o) => ({
      depotId: o.depotId,
      depotName: o.depotName,
      buses: o.buses,
      linked: o.depotId !== UNASSIGNED_DEPOT_ID,
      majority: shared && o.depotId === route.primaryDepotId,
    })),
    note: shared && route.primaryDepotId === null ? 'equal split, no majority' : null,
  };
}

export interface DelayWords {
  readonly median: string;
  readonly late: string;
  readonly basis: string;
}

export function delayWords(delay: RouteDelay): DelayWords {
  const tenths = delay.medianMin === null ? null : toTenths(delay.medianMin);
  const median =
    tenths === null
      ? DASH
      : `${tenths > 0 ? '+' : tenths < 0 ? MINUS : ''}${(Math.abs(tenths) / 10).toFixed(1)} min`;
  const { n, of } = delay.coverage;
  return {
    median,
    late: delay.lateShare === null ? DASH : `${Math.round(delay.lateShare * 100)}%`,
    basis: `based on ${n} of ${of} ${of === 1 ? 'bus' : 'buses'}`,
  };
}

export interface DeadKmWords {
  /** Kilometres a trip, one decimal; a dash when there is no figure. */
  readonly value: string;
  readonly note: string | null;
}

export function deadKmWords(route: RouteListItem): DeadKmWords {
  const dk = route.deadKm;
  if (dk === null) {
    const note = !route.profiled
      ? 'no known profile'
      : route.primaryDepotId === null
        ? 'no single operating depot'
        : 'cannot be measured from its depot';
    return { value: DASH, note };
  }
  const notes = [
    ...(dk.approximated ? ['nearest located stop stood in for a terminal'] : []),
    ...(dk.depotPosition === 'median' ? ['depot position approximate'] : []),
  ];
  return { value: formatKm(dk.perTripKm), note: notes.length === 0 ? null : notes.join('; ') };
}

/** The median delay for a table cell whose header carries the unit ("+4.5", not "+4.5 min"). */
export function medianCell(delay: Parameters<typeof delayWords>[0]): string {
  return delayWords(delay).median.replace(/ min$/, '');
}
