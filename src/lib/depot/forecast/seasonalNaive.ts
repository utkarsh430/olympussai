/**
 * Seasonal-naive: tomorrow looks like the same weekday last week. It is the
 * baseline every smarter method must beat, and the method used whenever the
 * history is too short to judge anything smarter.
 */
import { SEASON_DAYS } from './config';

/**
 * Forecasts `horizon` days after `values` by repeating the last full season:
 * day h ahead takes the value from the latest same-position day already seen.
 * Requires at least one full season of history.
 */
export function seasonalNaiveForecast(
  values: readonly number[],
  horizon: number,
  season: number = SEASON_DAYS,
): number[] {
  if (values.length < season) {
    throw new RangeError(`Seasonal-naive needs ${season} values, got ${values.length}`);
  }
  const lastSeasonStart = values.length - season;
  return Array.from(
    { length: horizon },
    (_, i) => values[lastSeasonStart + (i % season)] as number,
  );
}

