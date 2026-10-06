import { LATE_AFTER_MIN } from '../routes/delayConfig';
import { HOURS_PER_DAY } from '../sim/hourlyDemandConfig';
import { median } from '../stats/robust';
import type { Coverage } from '../types';
import { hourOf } from './feedMinutes';
import type { LedgerJourney } from './types';

/** Punctuality of one hour of one route's day, from the journeys the feed reported (DERIVED). */
export interface HourReliability {
  readonly hour: number;
  readonly delayMedianMin: number | null;
  /** Share of the journeys carrying a delay that ran more than LATE_AFTER_MIN behind. */
  readonly lateShare: number | null;
  /** Journeys carrying a delay, of the journeys placed in the hour. */
  readonly coverage: Coverage;
}

/** Printed beside every delay figure: the feed never states what its delay field counts. */
export const DELAY_UNIT_NOTE =
  "Delays are the feed's own figure, read as minutes; the feed does not state its unit, so the unit is unconfirmed.";

const SHARE_DECIMALS = 10_000;

/** The hour a journey belongs to: its scheduled start, else its actual start, else none. */
function hourOfJourney(j: LedgerJourney): number | null {
  return hourOf(j.scheduledStart) ?? hourOf(j.actualStart);
}

function hourFigures(hour: number, journeys: readonly LedgerJourney[]): HourReliability {
  const delays = journeys
    .map((j) => j.delayMinutes)
    .filter((d): d is number => d !== null && Number.isFinite(d));
  const late = delays.filter((d) => d > LATE_AFTER_MIN).length;
  return {
    hour,
    delayMedianMin: median(delays),
    lateShare: delays.length === 0 ? null : Math.round((late / delays.length) * SHARE_DECIMALS) / SHARE_DECIMALS,
    coverage: { n: delays.length, of: journeys.length },
  };
}

/**
 * Median delay, late share and coverage per hour for one route, from the day's
 * journey ledger. A journey is placed by its scheduled start (else its actual
 * start); one with neither is not placed. Always 24 hours.
 */
export function reliabilityByHour(
  routeName: string,
  ledger: readonly LedgerJourney[],
): HourReliability[] {
  const byHour = new Map<number, LedgerJourney[]>();
  for (const j of ledger) {
    if (j.routeName !== routeName) continue;
    const hour = hourOfJourney(j);
    if (hour === null) continue;
    byHour.set(hour, [...(byHour.get(hour) ?? []), j]);
  }
  return Array.from({ length: HOURS_PER_DAY }, (_, hour) => hourFigures(hour, byHour.get(hour) ?? []));
}
