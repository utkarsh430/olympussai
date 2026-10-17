import type { Selection } from './types';

/*
 * The time bands of the operating day the page offers, the same hour ranges as the
 * service module's bands (`service/networkHours`) so an address written for the old page
 * (`?band=morning_peak`) still lands on the same hours; plus a custom range.
 */

export type TimeBandKey = 'early' | 'morning_peak' | 'midday' | 'evening_peak' | 'late' | 'custom';

export interface TimeBand {
  readonly key: Exclude<TimeBandKey, 'custom'>;
  readonly label: string;
  readonly fromHour: number;
  readonly toHour: number;
}

export const TIME_BANDS: readonly TimeBand[] = [
  { key: 'early', label: 'Early Morning', fromHour: 4, toHour: 5 },
  { key: 'morning_peak', label: 'Morning Peak', fromHour: 6, toHour: 9 },
  { key: 'midday', label: 'Midday', fromHour: 10, toHour: 15 },
  { key: 'evening_peak', label: 'Evening Peak', fromHour: 16, toHour: 19 },
  { key: 'late', label: 'Late Night', fromHour: 20, toHour: 23 },
];

const KEYS: ReadonlySet<string> = new Set(TIME_BANDS.map((b) => b.key));

export function isTimeBandKey(value: unknown): value is Exclude<TimeBandKey, 'custom'> {
  return typeof value === 'string' && KEYS.has(value);
}

export function timeBand(key: Exclude<TimeBandKey, 'custom'>): TimeBand {
  return TIME_BANDS.find((b) => b.key === key) as TimeBand;
}

/** The band whose hours the selection covers exactly, else "custom". */
export function bandOfSelection(selection: Pick<Selection, 'fromHour' | 'toHour'>): TimeBandKey {
  const match = TIME_BANDS.find((b) => b.fromHour === selection.fromHour && b.toHour === selection.toHour);
  return match?.key ?? 'custom';
}

/** The default band: the morning peak, where the demonstration's largest problems sit. */
export const DEFAULT_BAND: Exclude<TimeBandKey, 'custom'> = 'morning_peak';
