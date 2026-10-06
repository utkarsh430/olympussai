import { HOURS_PER_DAY } from '../sim/hourlyDemandConfig';
import type { OperatingDay } from '../sim/operatingDayTypes';
import { MINUTES_PER_HOUR } from '../units';
import type { ModelledRouteHour } from './types';

const TENTHS = 10;

/** Minutes of [start, end) that fall inside the hour. */
function overlap(startMin: number, endMin: number, hour: number): number {
  const from = hour * MINUTES_PER_HOUR;
  const to = from + MINUTES_PER_HOUR;
  return Math.max(0, Math.min(endMin, to) - Math.max(startMin, from));
}

/**
 * A route's MODELLED deployment per hour, for the hours this server did not
 * observe: the bus-hours of the modelled duties on the route that had a bus,
 * summed over every depot's operating day for the date (minutes each duty
 * overlaps the hour, over 60, one decimal). A duty past midnight counts only
 * up to 24:00 of the date. Always 24 hours.
 */
export function modelledRouteHours(
  days: readonly OperatingDay[],
  routeName: string,
  operatingDate: string,
): ModelledRouteHour[] {
  const ran = days
    .filter((day) => day.operatingDate === operatingDate)
    .flatMap((day) => {
      const withBus = new Set(day.runs.map((r) => r.dutyId));
      return day.duties.filter((d) => d.routeName === routeName && withBus.has(d.id));
    });
  return Array.from({ length: HOURS_PER_DAY }, (_, hour) => {
    const minutes = ran.reduce((sum, d) => sum + overlap(d.startMin, d.endMin, hour), 0);
    return {
      routeName,
      operatingDate,
      hour,
      deployed: Math.round((minutes / MINUTES_PER_HOUR) * TENTHS) / TENTHS,
    };
  });
}
