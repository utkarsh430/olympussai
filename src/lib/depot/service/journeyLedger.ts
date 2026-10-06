import type { DepotBusRow } from '@/models/depotLive';
import { compareText } from '../stats/order';
import type { Coverage } from '../types';
import type { LedgerJourney, ScheduledRouteHour } from './types';

/*
 * The journey ledger: every journey the feed itself reports on a bus row
 * (about a fifth of buses carry one), held per operating date, and the
 * scheduled supply per hour it gives. Pure. Times are the feed's own digits
 * (Indian wall-clock time behind a misleading `Z`), read off the string and
 * never converted; a time on another date than the operating date is not a
 * time of this day, so it reads as absent.
 */

const ISO_CLOCK = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;
const BARE_CLOCK = /^(\d{2}):(\d{2})(?::\d{2})?$/;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const BUS_HOUR_DECIMALS = 100;

function digits(hours: string, minutes: string): string | null {
  return Number(hours) < HOURS_PER_DAY && Number(minutes) < MINUTES_PER_HOUR
    ? `${hours}:${minutes}`
    : null;
}

/**
 * `HH:MM` of a feed time on the operating date: an ISO-shaped feed time of
 * that date, or bare `HH:MM` / `HH:MM:SS` digits. Null when absent, malformed
 * or on another date.
 */
export function feedDigitsOn(value: string | null, operatingDate: string): string | null {
  if (value === null) return null;
  const iso = ISO_CLOCK.exec(value);
  if (iso !== null) return iso[1] === operatingDate ? digits(iso[2]!, iso[3]!) : null;
  const bare = BARE_CLOCK.exec(value);
  return bare === null ? null : digits(bare[1]!, bare[2]!);
}

/** Minutes after midnight of `HH:MM` digits. */
export function minutesOfDigits(value: string): number {
  return Number(value.slice(0, 2)) * MINUTES_PER_HOUR + Number(value.slice(3, 5));
}

const finiteOrNull = (value: number | null): number | null =>
  value !== null && Number.isFinite(value) ? value : null;

/** Whether a row's journey is scheduled on another date than the operating date. */
const ofAnotherDate = (row: DepotBusRow, operatingDate: string): boolean =>
  row.scheduledStart !== null &&
  ISO_CLOCK.test(row.scheduledStart) &&
  !row.scheduledStart.startsWith(operatingDate);

/**
 * Every journey of the operating date the rows report with a route name, as
 * seen at `feedNow`, in journey id order. The feed reuses a journey id on
 * every day it runs and a row can still carry an earlier day's journey, so a
 * journey whose scheduled start lies on another date is left out: it belongs
 * to that date. A journey id on two rows keeps the smaller registration.
 */
export function ledgerJourneysOf(
  rows: readonly DepotBusRow[],
  operatingDate: string,
  feedNow: string,
): LedgerJourney[] {
  const byId = new Map<string, LedgerJourney>();
  for (const row of rows) {
    const { journeyId, routeName } = row;
    if (journeyId === null || journeyId === '' || ofAnotherDate(row, operatingDate)) continue;
    if (routeName === null || routeName.trim() === '') continue;
    const held = byId.get(journeyId);
    if (held && compareText(held.registrationNumber, row.registrationNumber) <= 0) continue;
    byId.set(journeyId, {
      operatingDate,
      journeyId,
      routeName,
      registrationNumber: row.registrationNumber,
      scheduledStart: feedDigitsOn(row.scheduledStart, operatingDate),
      scheduledEnd: feedDigitsOn(row.scheduledEnd, operatingDate),
      actualStart: feedDigitsOn(row.actualStart, operatingDate),
      delayMinutes: finiteOrNull(row.delayMinutes),
      lastSeen: feedNow,
    });
  }
  return [...byId.values()].sort((a, b) => compareText(a.journeyId, b.journeyId));
}

const isNewer = (seen: LedgerJourney, held: LedgerJourney): boolean =>
  Date.parse(seen.lastSeen) > Date.parse(held.lastSeen);

/**
 * The ledger after a new sighting: per journey id, the sighting with the
 * newest `lastSeen` (the held one on a tie). A journey new to the ledger is
 * not added once it holds `maxJourneys`. Returns a new map.
 */
export function mergeJourneys(
  previous: ReadonlyMap<string, LedgerJourney>,
  seen: readonly LedgerJourney[],
  maxJourneys: number = Number.POSITIVE_INFINITY,
): Map<string, LedgerJourney> {
  const merged = new Map(previous);
  for (const journey of seen) {
    const held = merged.get(journey.journeyId);
    if (held === undefined && merged.size >= maxJourneys) continue;
    if (held === undefined || isNewer(journey, held)) merged.set(journey.journeyId, journey);
  }
  return merged;
}

/** A journey's span in minutes of the day; without a usable end, to the end of its start hour. */
function spanOf(start: string, end: string | null): { from: number; to: number } {
  const from = minutesOfDigits(start);
  const to = end === null ? Number.NaN : minutesOfDigits(end);
  if (Number.isFinite(to) && to >= from) return { from, to };
  return { from, to: (Math.floor(from / MINUTES_PER_HOUR) + 1) * MINUTES_PER_HOUR };
}

/**
 * Scheduled supply per hour (0 to 23) for one route and date from the feed's
 * own journeys: trips starting in the hour, and bus-hours, the minutes of
 * each journey overlapping the hour divided by 60. A journey with no usable
 * end (absent, on another date, or before its start) counts its start hour
 * only. A journey with no start is not placed. `coverage` is the buses with a
 * journey of the distinct buses seen on the route that date, stated as given.
 */
export function scheduledHoursFromLedger(
  routeName: string,
  operatingDate: string,
  journeys: readonly LedgerJourney[],
  coverage: Coverage,
): ScheduledRouteHour[] {
  const starting = new Array<number>(HOURS_PER_DAY).fill(0);
  const minutes = new Array<number>(HOURS_PER_DAY).fill(0);
  const own = new Map<string, LedgerJourney>();
  for (const j of journeys) {
    if (j.routeName === routeName && j.operatingDate === operatingDate) own.set(j.journeyId, j);
  }
  for (const j of own.values()) {
    if (j.scheduledStart === null) continue;
    const { from, to } = spanOf(j.scheduledStart, j.scheduledEnd);
    const startHour = Math.floor(from / MINUTES_PER_HOUR);
    starting[startHour] = (starting[startHour] ?? 0) + 1;
    for (let hour = startHour; hour < HOURS_PER_DAY && hour * MINUTES_PER_HOUR < to; hour += 1) {
      const overlap =
        Math.min(to, (hour + 1) * MINUTES_PER_HOUR) - Math.max(from, hour * MINUTES_PER_HOUR);
      minutes[hour] = (minutes[hour] ?? 0) + Math.max(0, overlap);
    }
  }
  return starting.map((tripsStarting, hour) => ({
    routeName,
    operatingDate,
    hour,
    tripsStarting,
    busHours:
      Math.round(((minutes[hour] ?? 0) / MINUTES_PER_HOUR) * BUS_HOUR_DECIMALS) / BUS_HOUR_DECIMALS,
    coverage,
    fromFeedRowsOnly: true,
  }));
}
