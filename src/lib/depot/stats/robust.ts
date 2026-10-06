/**
 * Robust statistics for ranking depots.
 *
 * Medians and MAD are used instead of means and standard deviations so that
 * one pathological depot cannot drag its peers' benchmark. Every function is
 * pure and leaves its input untouched.
 */

/** Scales MAD to match a standard deviation for normally distributed data. */
export const MAD_TO_SIGMA = 1.4826;

/** Normal-consistency factor for mean absolute deviation, sqrt(pi / 2). */
export const MEAN_AD_TO_SIGMA = 1.2533;

/** Indexed read that treats an out-of-range index as the bug it would be. */
function nth(sorted: readonly number[], index: number): number {
  const value = sorted[index];
  if (value === undefined) throw new RangeError(`index ${index} outside sample`);
  return value;
}

function sortedCopy(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = sortedCopy(values);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? nth(sorted, mid) : (nth(sorted, mid - 1) + nth(sorted, mid)) / 2;
}

/**
 * The median, or `empty` for an empty sample, for callers that need a number: the yard
 * geometry reads an empty sample as NaN, the depot's yard centre as 0.
 */
export function medianOr(values: readonly number[], empty: number): number {
  return median(values) ?? empty;
}

/** Median absolute deviation from the median. */
export function mad(values: readonly number[]): number | null {
  const centre = median(values);
  if (centre === null) return null;
  return median(values.map((v) => Math.abs(v - centre)));
}

/** Mean distance from the median; null for an empty sample. */
export function meanAbsoluteDeviation(values: readonly number[]): number | null {
  const centre = median(values);
  if (centre === null) return null;
  return values.reduce((sum, v) => sum + Math.abs(v - centre), 0) / values.length;
}

/**
 * Robust z against the sample. Normally (value - median) / (1.4826 * MAD).
 * When more than half the sample shares one value the MAD is 0, and dividing
 * by it would give every depot z = 0, hiding a real outlier (most depots sit
 * at full device health, so one with tamper flags would go unpenalised). In
 * that case the mean absolute deviation around the median takes its place.
 * Only a sample of identical values has no spread at all, and gives 0.
 */
export function robustZ(value: number, sample: readonly number[]): number | null {
  const centre = median(sample);
  const spread = mad(sample);
  if (centre === null || spread === null) return null;
  if (spread > 0) return (value - centre) / (MAD_TO_SIGMA * spread);
  const meanDeviation = meanAbsoluteDeviation(sample);
  if (meanDeviation === null || meanDeviation === 0) return 0;
  return (value - centre) / (MEAN_AD_TO_SIGMA * meanDeviation);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Cut points: the top value of the lower group and of the middle group. */
export function tercileCuts(values: readonly number[]): readonly [number, number] | null {
  if (values.length === 0) return null;
  const sorted = sortedCopy(values);
  // Integer arithmetic so thirds never suffer floating-point rounding.
  const at = (thirds: number): number => nth(sorted, Math.ceil((sorted.length * thirds) / 3) - 1);
  return [at(1), at(2)];
}

export function ratio(n: number, of: number): number | null {
  return of === 0 ? null : n / of;
}
