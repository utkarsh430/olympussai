import type { DepotBusRow } from '@/models/depotLive';
import type { BusOpState } from '../types';
import { DARK_AFTER_MIN, MOVING_SPEED_KMPH } from './thresholds';

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

/**
 * Infers one bus's operational state; the first matching rule wins.
 * Maintenance outranks everything, then silence, then movement.
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
  return row.routeName ? 'in_service' : 'on_road';
}
