/**
 * Geometry and wording for the sparkline: a decorative summary drawn as plain
 * SVG so a table can hold 143 of them. Pure; the label is the text
 * equivalent built from the trend summary's own sentence.
 */
import type { TrendResult } from './trend';

export interface SparkPoint {
  readonly x: number;
  readonly y: number;
}

export type SparklineGeometry =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'line';
      /** SVG path through every point, the live value last. */
      readonly path: string;
      readonly live: SparkPoint;
      /** Every value equal: drawn as a level line at mid-height. */
      readonly flat: boolean;
      /** Distance kept from each edge so the live marker is never cut off. */
      readonly inset: number;
    };

/** Room for the live marker (radius 4 plus its 1px ring) inside the box. */
export const SPARK_INSET = 5;
const COORD_DECIMALS = 2;

const round = (value: number): number => Number(value.toFixed(COORD_DECIMALS));

/**
 * Fits the values into a width x height box. Fewer than two points, or any
 * value that is not a finite number, is not a trend: the caller draws its
 * placeholder rather than a misleading mark.
 */
export function sparklineGeometry(
  values: readonly number[],
  width: number,
  height: number,
): SparklineGeometry {
  if (values.length < 2 || !values.every(Number.isFinite)) return { kind: 'empty' };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const flat = max === min;
  const innerWidth = width - 2 * SPARK_INSET;
  const innerHeight = height - 2 * SPARK_INSET;
  const points = values.map((value, i): SparkPoint => ({
    x: round(SPARK_INSET + (i / (values.length - 1)) * innerWidth),
    y: round(flat ? height / 2 : SPARK_INSET + ((max - value) / (max - min)) * innerHeight),
  }));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
  const live = points[points.length - 1] ?? { x: width - SPARK_INSET, y: height / 2 };
  return { kind: 'line', path, live, flat, inset: SPARK_INSET };
}

/** "On-road share, MODELLED trend: up 2.1 percentage points over 30 days, ending on the live value". */
export function sparklineLabel(metricLabel: string, trend: TrendResult): string {
  if (trend.status !== 'ok') return `${metricLabel}: no trend yet`;
  return `${metricLabel}, MODELLED trend: ${trend.summary.sentence}, ending on the live value`;
}
