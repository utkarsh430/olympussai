import { depotHref } from '@/lib/depot/depotNav';
import type { BusLocation } from '@/lib/depot/infer/types';
import {
  BUS_STATE_ORDER,
  DEFAULT_ROSTER_FILTERS,
  ROSTER_FLAGS,
  type RosterFilters,
  type RosterFlag,
} from './rosterModel';

/**
 * The roster's filters as a URL query, so the cockpit's attention lines can open a
 * filtered roster and a filtered view can be shared. Every value is checked against
 * the known values: an unknown one is dropped, never trusted.
 */

export const ROSTER_QUERY = {
  state: 'state',
  location: 'location',
  route: 'route',
  search: 'q',
  flag: 'flag',
  bus: 'bus',
} as const;

export const ROSTER_LOCATIONS: readonly BusLocation[] = ['in_yard', 'at_other_yard', 'away', 'unknown'];
export const MAX_SEARCH_LENGTH = 64;

type Get = (key: string) => string | null;

function isLocation(value: string | null): value is BusLocation {
  return value !== null && (ROSTER_LOCATIONS as readonly string[]).includes(value);
}

function isFlag(value: string | null): value is Exclude<RosterFlag, 'any'> {
  return value !== null && (ROSTER_FLAGS as readonly string[]).includes(value);
}

export function parseRosterQuery(get: Get): RosterFilters {
  const named = new Set((get(ROSTER_QUERY.state) ?? '').split(','));
  const location = get(ROSTER_QUERY.location);
  const flag = get(ROSTER_QUERY.flag);
  return {
    states: BUS_STATE_ORDER.filter((state) => named.has(state)),
    location: isLocation(location) ? location : 'any',
    hasRouteOnly: get(ROSTER_QUERY.route) === '1',
    search: (get(ROSTER_QUERY.search) ?? '').slice(0, MAX_SEARCH_LENGTH),
    flag: isFlag(flag) ? flag : 'any',
  };
}

/** "?state=dark&bus=UP1", or "" when every filter is at its default and no bus is open. */
export function rosterQueryString(filters: RosterFilters, bus: string | null): string {
  const query = new URLSearchParams();
  if (filters.states.length > 0) query.set(ROSTER_QUERY.state, filters.states.join(','));
  if (filters.location !== 'any') query.set(ROSTER_QUERY.location, filters.location);
  if (filters.hasRouteOnly) query.set(ROSTER_QUERY.route, '1');
  if (filters.search !== '') query.set(ROSTER_QUERY.search, filters.search);
  if (filters.flag !== 'any') query.set(ROSTER_QUERY.flag, filters.flag);
  if (bus !== null) query.set(ROSTER_QUERY.bus, bus);
  const text = query.toString().replace(/%2C/g, ',');
  return text === '' ? '' : `?${text}`;
}

/** The depot's roster with some filters set. */
export function rosterFilterHref(depotId: string, filters: Partial<RosterFilters>): string {
  const query = rosterQueryString({ ...DEFAULT_ROSTER_FILTERS, ...filters }, null);
  return `${depotHref(depotId)}/roster${query}`;
}
