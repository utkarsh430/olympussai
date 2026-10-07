import { formatCount, formatPercent } from '../format';
import { DASH, delayFigure, hourLabel } from './serviceWording';
import type { HourReliability } from './types';

/*
 * The punctuality table as data: one row per hour that carried any delay figure, and the
 * column widths that keep the table inside its frame down to a 390px phone.
 */

export interface PunctualityRow {
  readonly key: string;
  readonly hour: string;
  readonly delay: string;
  readonly late: string;
  readonly coverage: string;
}

export type PunctualityColumnKey = 'hour' | 'delay' | 'late' | 'coverage';

export const PUNCTUALITY_COLUMN_KEYS: readonly PunctualityColumnKey[] = ['hour', 'delay', 'late', 'coverage'];

/** Widths in px: each fits its header and its longest cell, and all four fit a 390px frame. */
export const PUNCTUALITY_COLUMN_WIDTHS: Readonly<Record<PunctualityColumnKey, number>> = {
  hour: 72,
  delay: 80,
  late: 104,
  coverage: 96,
};

/** Hours with any delay figure, in hour order; the rest have nothing to show. */
export function punctualityRows(hours: readonly HourReliability[]): readonly PunctualityRow[] {
  return hours
    .filter((h) => h.coverage.n > 0)
    .map((h) => ({
      key: String(h.hour),
      hour: hourLabel(h.hour),
      delay: delayFigure(h.delayMedianMin),
      late: h.lateShare === null ? DASH : formatPercent(h.lateShare),
      coverage: `${formatCount(h.coverage.n)} of ${formatCount(h.coverage.of)}`,
    }));
}
