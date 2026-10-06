import type { DepotBusView, DepotFeedEnvelope } from '@/lib/depot/api';
import { NORMAL_TAMPER_CODE } from '@/lib/depot/exceptions/config';
import type { BusLocation } from '@/lib/depot/infer/types';
import { BUS_STATE_LABEL } from '@/lib/depot/labels';
import type { BusOpState } from '@/lib/depot/types';
import { lastHeardAgo, lastHeardCell } from './rosterCells';

/** Display order: most useful to least. */
export const BUS_STATE_ORDER: readonly BusOpState[] = [
  'in_service',
  'on_road',
  'standing',
  'dark',
  'off_road',
];

/** The short word for a state where room is tight; the full label goes in `title`. */
export const ROSTER_STATE_WORD: Readonly<Record<BusOpState, string>> = {
  ...BUS_STATE_LABEL,
  on_road: 'On road',
};

export interface RosterFilters {
  /** Buses in any of these states; empty means every state. */
  readonly states: readonly BusOpState[];
  readonly location: BusLocation | 'any';
  readonly hasRouteOnly: boolean;
  /** Matches registration or route name, case-insensitively. */
  readonly search: string;
  /** A device or reporting flag the bus must carry; 'any' means no flag filter. */
  readonly flag: RosterFlag;
}

/** Flags the cockpit's attention lines can target. */
export type RosterFlag = 'any' | 'power_off' | 'not_heard' | 'tamper';

export const ROSTER_FLAGS: readonly Exclude<RosterFlag, 'any'>[] = ['power_off', 'not_heard', 'tamper'];

/** The words of an active flag filter. */
export const ROSTER_FLAG_LABEL: Readonly<Record<Exclude<RosterFlag, 'any'>, string>> = {
  power_off: 'Main power off',
  not_heard: 'Not heard for a while',
  tamper: 'Tamper code',
};

export const DEFAULT_ROSTER_FILTERS: RosterFilters = {
  states: [],
  location: 'any',
  hasRouteOnly: false,
  search: '',
  flag: 'any',
};

export interface RosterRow {
  readonly bus: DepotBusView;
  /** LAST HEARD's words: "2 min ago", or "not heard 3 h 12 min" past the recency rule. */
  readonly lastHeard: string;
  /** True when `lastHeard` says "not heard": drawn in the warning tone. */
  readonly notHeard: boolean;
  readonly flags: readonly string[];
  readonly delay: string | null;
}

const ON_TIME_WITHIN_MIN = 1;

/**
 * How long since the bus was heard from, for the yard, maintenance and next-stop sentences
 * that share it: "just now", "47 min ago", "1 h 27 min ago", "13 d 20 h ago". Every
 * duration goes through `formatDurationMinutes` (never raw minutes above an hour), the
 * same words as the roster's LAST HEARD cell.
 */
export function lastHeardText(gpsAgeMin: number | null): string {
  return lastHeardAgo(gpsAgeMin);
}

/**
 * Device flags. The tamper code is shown raw: the feed does not say what a code
 * means, so none is claimed. The feed's normal code is left out, as the
 * exception report does.
 */
export function deviceFlags(bus: DepotBusView): readonly string[] {
  const flags: string[] = [];
  if (bus.mainPowerOn === false) flags.push('Main power off');
  if (bus.tamperCode && bus.tamperCode !== NORMAL_TAMPER_CODE) {
    flags.push(`Tamper code ${bus.tamperCode}`);
  }
  return flags;
}

/** Minutes late or early; null when the bus has no delay figure. */
export function delayText(delayMinutes: number | null): string | null {
  if (delayMinutes === null || !Number.isFinite(delayMinutes)) return null;
  const minutes = Math.round(delayMinutes);
  if (Math.abs(minutes) <= ON_TIME_WITHIN_MIN) return 'on time';
  return minutes > 0 ? `${minutes} min late` : `${-minutes} min early`;
}

/** "not heard 3 h 12 min" for a bus unheard past the recency rule; else null. */
export function notHeardText(bus: Pick<DepotBusView, 'gpsAgeMin' | 'notHeardMin'>): string | null {
  const cell = lastHeardCell(bus);
  return cell.warning ? cell.text : null;
}

/** A tamper code other than the feed's normal one. */
export function hasTamperCode(bus: Pick<DepotBusView, 'tamperCode'>): boolean {
  return bus.tamperCode !== null && bus.tamperCode !== '' && bus.tamperCode !== NORMAL_TAMPER_CODE;
}

function carriesFlag(bus: DepotBusView, flag: RosterFlag): boolean {
  switch (flag) {
    case 'any':
      return true;
    case 'power_off':
      return bus.mainPowerOn === false;
    case 'not_heard':
      return notHeardText(bus) !== null;
    case 'tamper':
      return hasTamperCode(bus);
  }
}

export function hasRoute(bus: DepotBusView): boolean {
  return bus.routeName !== null && bus.routeName !== '';
}

/** Counts per state, always computed on the unfiltered list. */
export function countByState(buses: readonly DepotBusView[]): Readonly<Record<BusOpState, number>> {
  const counts: Record<BusOpState, number> = {
    in_service: 0,
    on_road: 0,
    standing: 0,
    dark: 0,
    off_road: 0,
  };
  for (const bus of buses) counts[bus.state] += 1;
  return counts;
}

/** Display rows in default order: state, then registration. Never mutates `buses`. */
export function buildRosterRows(buses: readonly DepotBusView[]): readonly RosterRow[] {
  return [...buses]
    .sort(
      (a, b) =>
        BUS_STATE_ORDER.indexOf(a.state) - BUS_STATE_ORDER.indexOf(b.state) ||
        a.registrationNumber.localeCompare(b.registrationNumber),
    )
    .map((bus) => ({
      bus,
      lastHeard: lastHeardCell(bus).text,
      notHeard: lastHeardCell(bus).warning,
      flags: deviceFlags(bus),
      delay: delayText(bus.delayMinutes),
    }));
}

export function filterRosterRows(
  rows: readonly RosterRow[],
  filters: RosterFilters,
): readonly RosterRow[] {
  const needle = filters.search.trim().toLowerCase();
  return rows.filter(({ bus }) => {
    if (filters.states.length > 0 && !filters.states.includes(bus.state)) return false;
    if (filters.location !== 'any' && bus.location !== filters.location) return false;
    if (filters.hasRouteOnly && !hasRoute(bus)) return false;
    if (!carriesFlag(bus, filters.flag)) return false;
    if (needle === '') return true;
    return (
      bus.registrationNumber.toLowerCase().includes(needle) ||
      (bus.routeName ?? '').toLowerCase().includes(needle)
    );
  });
}

/**
 * The empty roster's sentence, naming the copy of the feed it read: "live" only when the
 * answer is a fresh live read, so a sample or old data is never called the live feed.
 */
export function emptyRosterSentence(
  envelope: Pick<DepotFeedEnvelope, 'source' | 'stale'>,
  requestFailed: boolean,
): string {
  if (envelope.source === 'fixture') {
    return 'The saved sample of the feed lists no buses homed at this depot.';
  }
  if (envelope.source === 'cache' || envelope.stale || requestFailed) {
    return 'The last good copy of the feed lists no buses homed at this depot.';
  }
  return 'The feed lists no buses homed at this depot.';
}
