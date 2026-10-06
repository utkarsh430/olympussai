import type { DepotBusView } from '@/lib/depot/api';
import { NORMAL_TAMPER_CODE } from '@/lib/depot/exceptions/config';
import type { BusLocation } from '@/lib/depot/infer/types';
import { formatFeedDateTime, formatFeedTime } from '@/lib/depot/format';
import type { BusOpState } from '@/lib/depot/types';

/** Display order: most useful to least. */
export const BUS_STATE_ORDER: readonly BusOpState[] = [
  'in_service',
  'on_road',
  'standing',
  'dark',
  'off_road',
];

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
  readonly lastHeard: string;
  readonly flags: readonly string[];
  readonly delay: string | null;
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;
const HOURS_SHOWN_BELOW_MIN = 120;
const DAYS_SHOWN_FROM_MIN = 2 * MINUTES_PER_DAY;
const ON_TIME_WITHIN_MIN = 1;
const UNKNOWN = 'unknown';

/** How long since the bus was heard from, as a short phrase. */
export function lastHeardText(gpsAgeMin: number | null): string {
  if (gpsAgeMin === null || !Number.isFinite(gpsAgeMin)) return UNKNOWN;
  if (gpsAgeMin < 1) return 'just now';
  if (gpsAgeMin < HOURS_SHOWN_BELOW_MIN) return `${Math.floor(gpsAgeMin)} min ago`;
  if (gpsAgeMin < DAYS_SHOWN_FROM_MIN) return `${Math.floor(gpsAgeMin / MINUTES_PER_HOUR)} h ago`;
  return `${Math.floor(gpsAgeMin / MINUTES_PER_DAY)} days ago`;
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

const DASH = '—';

/**
 * A scheduled time: the time alone on the feed date, the day and time otherwise
 * (a schedule from yesterday must not read as today's). Never an ISO string.
 */
export function scheduleText(iso: string | null, feedNow: string | null): string {
  if (iso === null) return DASH;
  const sameDay = feedNow !== null && iso.slice(0, 10) === feedNow.slice(0, 10);
  return sameDay ? formatFeedTime(iso) : formatFeedDateTime(iso);
}

/** The quiet word beside a state whose report is too old to describe the present. */
export function notHeardText(bus: Pick<DepotBusView, 'notHeardMin'>): string | null {
  const minutes = bus.notHeardMin;
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return null;
  return `not heard ${lastHeardText(minutes).replace(' ago', '')}`;
}

function hasTamperCode(bus: DepotBusView): boolean {
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
      lastHeard: lastHeardText(bus.gpsAgeMin),
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
