import { formatCount } from '../format';
import { formatKm } from './allocationWording';
import type { AllocationMoveItem, RouteListItem } from './api';
import type { RouteProfileResult } from './types';

/**
 * Everything the route drawer says, built from one route's profile (the
 * route-details feed, DERIVED), its row in the route table and, when the plan
 * moves it, its recommended move. Kept pure so every sentence is tested.
 */

export type DrawerRoute = Pick<RouteListItem, 'routeName' | 'buses' | 'operators'> & {
  readonly deadKm: { readonly depotId: string; readonly perTripKm: number } | null;
};

export type DrawerMove = Pick<
  AllocationMoveItem,
  'toDepotName' | 'fromDeadKmPerTrip' | 'toDeadKmPerTrip'
>;

export interface DrawerStop {
  readonly sequence: number;
  readonly name: string;
  readonly time: string;
}

export type DrawerView =
  | {
      readonly status: 'ok';
      readonly stops: readonly DrawerStop[];
      readonly firstStop: string | null;
      readonly lastStop: string | null;
      readonly durationLine: string;
      readonly unlocatedLine: string;
      readonly operatorsLine: string;
      readonly busesLine: string;
      readonly deadKmLines: readonly string[];
    }
  | { readonly status: 'unavailable'; readonly sentence: string };

type Unavailable = Extract<RouteProfileResult, { status: 'unavailable' }>['reason'];

const UNAVAILABLE: Readonly<Record<Unavailable, string>> = {
  no_bus_on_route:
    'Its profile is unavailable: no bus is assigned to this route today, and stops are read through a bus running it.',
  no_schedule:
    'Its profile is unavailable: the route-details feed returned no schedule for the bus running it.',
  upstream_error:
    'Its profile is unavailable: the route-details feed did not answer. Try again later.',
};

const plural = (n: number, one: string, many: string): string =>
  `${formatCount(n)} ${n === 1 ? one : many}`;

/** The time of a stop the profile gives no schedule for. */
export const NO_TIME = 'No time';

const timeOf = (scheduled: string | null): string =>
  scheduled?.match(/^(\d{2}:\d{2})/)?.[1] ?? NO_TIME;

function durationLine(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) {
    return 'The schedule gives no trip duration.';
  }
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  const parts = [...(hours > 0 ? [`${hours} h`] : []), ...(rest > 0 || hours === 0 ? [`${rest} min`] : [])];
  return `Scheduled trip duration: ${parts.join(' ')}.`;
}

function unlocatedLine(unlocated: number, total: number): string {
  if (unlocated === 0) return 'Every stop has a usable position.';
  const verb = unlocated === 1 ? 'has' : 'have';
  const pronoun = unlocated === 1 ? 'it is' : 'they are';
  return `${formatCount(unlocated)} of ${plural(total, 'stop', 'stops')} ${verb} no usable position, so ${pronoun} left out of distances.`;
}

function operatorsLine(operators: DrawerRoute['operators']): string {
  if (operators.length === 0) return 'No depot is recorded for its buses.';
  const named = operators.map((o) => `${o.depotName} (${plural(o.buses, 'bus', 'buses')})`);
  const list =
    named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  return `Operated by ${list}.`;
}

function deadKmLines(route: DrawerRoute, move: DrawerMove | null): string[] {
  const current = route.operators.find((o) => o.depotId === route.deadKm?.depotId);
  const now =
    route.deadKm === null || current === undefined
      ? 'No dead-kilometre figure for its depot yet: it appears once the route table next refreshes, if the depot and both terminals are located.'
      : `From ${current.depotName}, its depot now: ${formatKm(route.deadKm.perTripKm)} km a trip.`;
  if (move === null) return [now];
  return [now, `From ${move.toDepotName}, the recommended depot: ${formatKm(move.toDeadKmPerTrip)} km a trip.`];
}

export function drawerView(
  result: RouteProfileResult,
  route: DrawerRoute,
  move: DrawerMove | null,
): DrawerView {
  if (result.status !== 'ok') return { status: 'unavailable', sentence: UNAVAILABLE[result.reason] };
  const { profile } = result;
  const stops = [...profile.stops]
    .sort((a, b) => a.sequence - b.sequence)
    .map((s) => ({ sequence: s.sequence, name: s.name, time: timeOf(s.scheduled) }));
  return {
    status: 'ok',
    stops,
    firstStop: profile.origin?.name ?? null,
    lastStop: profile.destination?.name ?? null,
    durationLine: durationLine(profile.scheduledDurationMin),
    unlocatedLine: unlocatedLine(profile.unlocatedStops, profile.stops.length),
    operatorsLine: operatorsLine(route.operators),
    busesLine: `${plural(route.buses, 'bus', 'buses')} on this route now.`,
    deadKmLines: deadKmLines(route, move),
  };
}

const LIMITED = 'Too many route lookups just now.';

/** The 429 sentence; only a whole number of seconds from `Retry-After` is ever printed. */
export function rateLimitSentence(retryAfter: string | null): string {
  const seconds = retryAfter !== null && /^\d{1,5}$/.test(retryAfter.trim()) ? Number(retryAfter) : null;
  if (seconds === null) return `${LIMITED} Try again shortly.`;
  return `${LIMITED} Try again in ${plural(seconds, 'second', 'seconds')}.`;
}
