/**
 * The value axis and the number and date formats shared by the trend chart,
 * its table and its tooltip. Pure; no chart library is imported here, so the
 * scale can be tested without anything being laid out.
 */
import type { MetricUnit, MetricValueRange } from './api';
import type { MetricKind } from './config';

export interface AxisScale {
  readonly domain: readonly [number, number];
  readonly ticks: readonly number[];
  readonly step: number;
}

/** Room given either side of a constant series so it draws as a level line mid-plot. */
const FLAT_HALF_SPAN: Readonly<Record<MetricKind, number>> = { rate: 0.05, index: 5, count: 5 };
/** Air above and below the data, as a share of its span. */
const PADDING_SHARE = 0.1;
const TARGET_TICKS = 4;
const NICE_MULTIPLES: readonly number[] = [1, 2, 5, 10];
/** Strips binary noise from tick arithmetic (0.1 * 3 is not 0.3). */
const TICK_DECIMALS = 10;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const clean = (value: number): number => Number(value.toFixed(TICK_DECIMALS));

function niceStep(span: number, kind: MetricKind): number {
  const raw = span / TARGET_TICKS;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const multiple = NICE_MULTIPLES.find((m) => m * magnitude >= raw) ?? 10;
  const step = clean(multiple * magnitude);
  // A count axis ticks whole buses only.
  return kind === 'count' ? Math.max(1, Math.round(step)) : step;
}

/**
 * A value axis that frames the data with a little air, lands on round ticks
 * and never extends past the metric's valid range (no 105% share, no
 * negative bus count). A constant series or no data still gets a real span.
 */
export function valueScale(
  values: readonly number[],
  range: MetricValueRange,
  kind: MetricKind,
): AxisScale {
  const usable = values.filter(Number.isFinite);
  const upper = range.max ?? Number.POSITIVE_INFINITY;
  const low = usable.length > 0 ? Math.min(...usable) : range.min;
  const high = usable.length > 0 ? Math.max(...usable) : range.min;
  const pad = high > low ? (high - low) * PADDING_SHARE : FLAT_HALF_SPAN[kind];
  const from = Math.max(range.min, low - pad);
  const to = Math.min(upper, high + pad);
  const step = niceStep(to - from, kind);
  const domain: [number, number] = [
    Math.max(range.min, clean(Math.floor(from / step) * step)),
    Math.min(upper, clean(Math.ceil(to / step) * step)),
  ];
  const first = Math.ceil(clean(domain[0] / step));
  const last = Math.floor(clean(domain[1] / step));
  const ticks = Array.from({ length: last - first + 1 }, (_, i) => clean((first + i) * step));
  return { domain, ticks, step };
}

/** A value as the table and tooltip show it: rates as percentages. */
export function formatValue(value: number, unit: MetricUnit): string {
  if (unit === 'fraction') return `${(value * 100).toFixed(1)}%`;
  if (unit === 'points') return value.toFixed(1);
  return String(Math.round(value));
}

/** An axis tick: as few decimals as the step allows. */
export function formatTick(value: number, unit: MetricUnit, step: number): string {
  if (unit === 'fraction') return `${(value * 100).toFixed(step * 100 >= 1 ? 0 : 1)}%`;
  if (unit === 'points') return value.toFixed(step >= 1 ? 0 : 1);
  return String(Math.round(value));
}

/** "6 Oct", or "6 Oct 2026" with the year. Read from the string, never a clock or time zone. */
export function formatDate(date: string, withYear = false): string {
  const [year, month, day] = date.split('-');
  const name = MONTHS[Number(month) - 1] ?? month;
  const short = `${Number(day)} ${name}`;
  return withYear ? `${short} ${year}` : short;
}
