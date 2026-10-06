import type { DepotBusRow } from '@/models/depotLive';
import type { BusOpState } from '../types';
import { isScheduledForFeedDate } from './outshed';
import { DARK_AFTER_MIN, MOVING_SPEED_KMPH, REPORTING_WINDOW_MIN } from './thresholds';

const MS_PER_MINUTE = 60_000;

/**
 * Minutes between a bus's last GPS fix and the feed's own clock.
 *
 * Null when either time is missing or unparsable. Device clocks run slightly
 * ahead of the feed, so a small negative age is clamped to 0 rather than
 * reported as a fix from the future.
 */
export function gpsAgeMinutes(row: Readonly<DepotBusRow>, feedNow: string | null): number | null {
  if (row.gpsTimestamp === null || feedNow === null) return null;
  const fix = Date.parse(row.gpsTimestamp);
  const now = Date.parse(feedNow);
  if (Number.isNaN(fix) || Number.isNaN(now)) return null;
  return Math.max(0, (now - fix) / MS_PER_MINUTE);
}

/** Heard within the reporting window. An unknown age is not a recent report. */
export function isRecentlyHeard(ageMin: number | null): boolean {
  return ageMin !== null && ageMin <= REPORTING_WINDOW_MIN;
}

/**
 * Infers one bus's operational state; the first matching rule wins.
 * Maintenance outranks everything, then silence, then movement.
 *
 *  1. feed says under maintenance                      -> off_road
 *  2. no signal, no fix time, or fix older than 6 h    -> dark
 *  3. last fix at or below the moving speed            -> standing
 *  4. moving, carrying a route, scheduled for the feed
 *     date, and heard within the reporting window      -> in_service
 *  5. any other moving bus                             -> on_road
 *
 * "In service" is a claim about now, so it needs evidence from now: a schedule
 * for the feed date (not yesterday's left on the row) and a report inside the
 * reporting window. A state is what the bus last reported; whether that report
 * is recent enough to describe the present is `notHeardMinutes`.
 */
export function classifyBusState(row: Readonly<DepotBusRow>, feedNow: string | null): BusOpState {
  if (row.vehicleStatus === 'under_maintenance') return 'off_road';

  const age = gpsAgeMinutes(row, feedNow);
  if (
    row.vehicleStatus === 'no_signal' ||
    row.gpsTimestamp === null ||
    (age !== null && age > DARK_AFTER_MIN)
  ) {
    return 'dark';
  }

  const moving = row.speedKmph !== null && row.speedKmph > MOVING_SPEED_KMPH;
  if (!moving) return 'standing';
  const inService =
    Boolean(row.routeName) && isScheduledForFeedDate(row, feedNow) && isRecentlyHeard(age);
  return inService ? 'in_service' : 'on_road';
}

/**
 * Whole minutes since the last report when the bus has been quiet for longer
 * than the reporting window but is not yet dark (and is not off road): a screen
 * then says "Not heard for N min" instead of presenting the state as current.
 * Null when the bus was heard recently, when its state already says it is
 * silent or off road, or when no age can be computed.
 */
export function notHeardMinutes(
  row: Readonly<DepotBusRow>,
  state: BusOpState,
  feedNow: string | null,
): number | null {
  if (state === 'dark' || state === 'off_road') return null;
  const age = gpsAgeMinutes(row, feedNow);
  return age === null || isRecentlyHeard(age) ? null : Math.round(age);
}
