import { formatCount } from './format';
import { isValidDepotId } from './ids';
import { DEPOT_KIND_LABEL } from './labels';
import { DEPOTS_ROOT, isNavItemActive, type DepotNavItem } from './nav';
import type { DepotSummary } from './types';

/**
 * Navigation model for one depot's scope: its URL, its sub-navigation (cockpit,
 * roster, yard) and the scope switcher's options. Kept pure so the switcher's
 * keyboard arithmetic and filtering are tested without a browser.
 */

/** Query parameter the roster page reads to pre-select a bus. */
export const ROSTER_BUS_PARAM = 'bus';

export const NETWORK_SCOPE_KEY = 'network';

const SCOPE_PREFIX = 'UPSRTC / ';
const DEPOT_SCOPE_PATH = /^\/project\/depots\/d\/([^/?#]+)/;

export function depotHref(depotId: string): string {
  return `${DEPOTS_ROOT}/d/${encodeURIComponent(depotId)}`;
}

/** The roster page with one bus pre-selected. */
export function rosterBusHref(depotId: string, registration: string): string {
  return `${depotHref(depotId)}/roster?${ROSTER_BUS_PARAM}=${encodeURIComponent(registration)}`;
}

export function depotNav(depotId: string): readonly DepotNavItem[] {
  const root = depotHref(depotId);
  return [
    { href: root, label: 'Cockpit', exact: true },
    { href: `${root}/roster`, label: 'Roster' },
    { href: `${root}/yard`, label: 'Yard' },
  ];
}

/** Like `isNavItemActive`, but tolerates a query string or hash on the path. */
export function isDepotNavItemActive(path: string, item: DepotNavItem): boolean {
  const end = path.search(/[?#]/);
  return isNavItemActive(end === -1 ? path : path.slice(0, end), item);
}

/** The depot a depot-scope path belongs to; null outside the scope or for a malformed id. */
export function depotIdFromPath(pathname: string): string | null {
  const raw = DEPOT_SCOPE_PATH.exec(pathname)?.[1];
  if (raw === undefined) return null;
  let segment: string;
  try {
    segment = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return isValidDepotId(segment) ? segment : null;
}

export type ScopeDepot = Pick<DepotSummary, 'id' | 'name' | 'kind' | 'fleet'>;

export interface ScopeOption {
  /** NETWORK_SCOPE_KEY for the network, otherwise the depot id. */
  readonly key: string;
  readonly label: string;
  /** Matched by the filter as well as the label; empty for the network. */
  readonly id: string;
  readonly detail: string;
  readonly href: string;
}

const NETWORK_OPTION: ScopeOption = {
  key: NETWORK_SCOPE_KEY,
  label: 'Network',
  id: '',
  detail: 'All depots',
  href: DEPOTS_ROOT,
};

/** "Network" first, then every depot by name (id breaks a tie), with kind and fleet. */
export function scopeOptions(depots: readonly ScopeDepot[]): readonly ScopeOption[] {
  const sorted = [...depots].sort(
    (a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en'),
  );
  return [
    NETWORK_OPTION,
    ...sorted.map((depot) => ({
      key: depot.id,
      label: depot.name,
      id: depot.id,
      detail: `${DEPOT_KIND_LABEL[depot.kind]} · ${formatCount(depot.fleet)} ${
        depot.fleet === 1 ? 'bus' : 'buses'
      }`,
      href: depotHref(depot.id),
    })),
  ];
}

/** Case-insensitive match on name or id; a blank filter keeps every option. Order is kept. */
export function filterScopeOptions(
  options: readonly ScopeOption[],
  query: string,
): readonly ScopeOption[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return options;
  return options.filter(
    (option) => option.label.toLowerCase().includes(needle) || option.id.includes(needle),
  );
}

export type ActiveMove = 'next' | 'previous' | 'first' | 'last';

/**
 * The listbox's active option after a key press. Up and Down wrap around at
 * both ends; -1 means none is active (an empty list, or nothing chosen yet).
 * A stale index from a longer list is treated as none.
 */
export function moveActiveIndex(current: number, move: ActiveMove, count: number): number {
  if (count <= 0) return -1;
  const last = count - 1;
  const from = current >= 0 && current <= last ? current : -1;
  switch (move) {
    case 'first':
      return 0;
    case 'last':
      return last;
    case 'next':
      return from === last ? 0 : from + 1;
    case 'previous':
      return from <= 0 ? last : from - 1;
  }
}

/** The crumb: the network, a depot by name, or its id while the list is unavailable. */
export function scopeLabel(depotId: string | null, depots: readonly ScopeDepot[] | null): string {
  if (depotId === null) return `${SCOPE_PREFIX}Network`;
  const depot = depots?.find((d) => d.id === depotId);
  return `${SCOPE_PREFIX}${depot ? depot.name : `Depot ${depotId}`}`;
}
