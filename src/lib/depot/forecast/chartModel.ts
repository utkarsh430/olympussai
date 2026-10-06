/**
 * Everything the trend chart draws and says, decided here: which point is
 * modelled history, which is the live value and which is forecast; the rows
 * the plot draws; the legend, tooltip and table wording; the text
 * equivalent. The component only renders this, so all of it is tested
 * without a chart being laid out.
 */
import type { DepotForecastResponse, MetricValueRange } from './api';
import { BAND_QUANTILE, SEASON_DAYS } from './config';
import { formatDate, formatValue, valueScale, type AxisScale } from './chartScale';

export type TrendChartInput = Pick<
  DepotForecastResponse,
  'metric' | 'horizonDays' | 'history' | 'trend' | 'forecast' | 'sentences'
>;

export type PointKind = 'history' | 'live' | 'forecast';

export interface ChartPoint {
  readonly date: string;
  readonly value: number;
  /** Forecast band, clipped to the valid range; null for history and the live value. */
  readonly low: number | null;
  readonly high: number | null;
  readonly kind: PointKind;
  /** Tooltip words: what this point is, with its range when it is a forecast. */
  readonly description: string;
}

/** One x position as the plot draws it; a series is null where it has no point. */
export interface PlotRow {
  readonly date: string;
  readonly history: number | null;
  readonly live: number | null;
  readonly forecast: number | null;
  readonly band: readonly [number, number] | null;
}

export type LegendMark = 'line' | 'dot' | 'dashed' | 'area';

export interface LegendEntry {
  readonly key: 'history' | 'live' | 'forecast' | 'band';
  readonly label: string;
  readonly mark: LegendMark;
}

export interface TableRow {
  readonly date: string;
  readonly value: string;
  readonly low: string;
  readonly high: string;
  readonly kind: string;
}

export interface TrendChartModel {
  readonly title: string;
  readonly legend: readonly LegendEntry[];
  readonly points: readonly ChartPoint[];
  readonly rows: readonly PlotRow[];
  readonly table: readonly TableRow[];
  readonly yScale: AxisScale;
  /** Dates to tick on the x axis; always includes the live date. */
  readonly xTicks: readonly string[];
  /** The live point, where the "now" marker stands. */
  readonly now: ChartPoint | null;
  /** Text equivalent of the plot. */
  readonly summary: string;
  /** Sentences printed under the chart, in reading order. */
  readonly notes: readonly string[];
}

export const KIND_WORDS: Readonly<Record<PointKind, string>> = {
  history: 'MODELLED history',
  live: 'LIVE value',
  forecast: 'MODELLED forecast',
};

const MAX_X_TICKS = 6;
/** Ends the text equivalent, so a screen-reader user knows every value is one press away. */
const TABLE_NOTE = 'Values are available as a table.';
const BAND_SHARE = Math.round(BAND_QUANTILE * 100);

const LEGEND: Readonly<Record<LegendEntry['key'], LegendEntry>> = {
  history: { key: 'history', label: 'History, MODELLED', mark: 'line' },
  live: { key: 'live', label: 'Live value, LIVE', mark: 'dot' },
  forecast: { key: 'forecast', label: 'Forecast, MODELLED', mark: 'dashed' },
  band: {
    key: 'band',
    label: `Forecast range (${BAND_SHARE}% of past errors at each day ahead), MODELLED`,
    mark: 'area',
  },
};

const clip = (value: number, range: MetricValueRange): number =>
  Math.min(range.max ?? Number.POSITIVE_INFINITY, Math.max(range.min, value));

function chartPoints(input: TrendChartInput): ChartPoint[] {
  const { range, unit } = input.metric;
  const { series } = input.history;
  const past = series.map((p, i): ChartPoint => {
    const kind: PointKind = i === series.length - 1 ? 'live' : 'history';
    const value = clip(p.value, range);
    return { date: p.date, value, low: null, high: null, kind, description: KIND_WORDS[kind] };
  });
  const result = input.forecast.result;
  if (result.status !== 'ok') return past;
  const ahead = result.forecast.points.map((p): ChartPoint => {
    const low = clip(p.low, range);
    const high = clip(p.high, range);
    const words = `${formatValue(low, unit)} to ${formatValue(high, unit)}`;
    const description = `${KIND_WORDS.forecast}, range ${words}`;
    return { date: p.date, value: clip(p.value, range), low, high, kind: 'forecast', description };
  });
  return [...past, ...ahead];
}

/** The live row also starts the dashed forecast and a zero-width band, so both join the line. */
function plotRow(point: ChartPoint, hasForecast: boolean): PlotRow {
  const { date, value, low, high } = point;
  if (point.kind === 'history')
    return { date, history: value, live: null, forecast: null, band: null };
  if (point.kind === 'live') {
    const joined = hasForecast ? value : null;
    const band: PlotRow['band'] = hasForecast ? [value, value] : null;
    return { date, history: value, live: value, forecast: joined, band };
  }
  return { date, history: null, live: null, forecast: value, band: [low ?? value, high ?? value] };
}

function tableRow(point: ChartPoint, input: TrendChartInput): TableRow {
  const { unit } = input.metric;
  return {
    date: formatDate(point.date, true),
    value: formatValue(point.value, unit),
    low: point.low === null ? '' : formatValue(point.low, unit),
    high: point.high === null ? '' : formatValue(point.high, unit),
    kind: KIND_WORDS[point.kind],
  };
}

/** About six ticks, a whole number of weeks apart once the span is long, counted from now. */
function xTicks(points: readonly ChartPoint[], nowIndex: number): string[] {
  const raw = Math.max(1, Math.ceil(points.length / MAX_X_TICKS));
  const every = raw > SEASON_DAYS ? Math.ceil(raw / SEASON_DAYS) * SEASON_DAYS : raw;
  return points.filter((_, i) => (i - nowIndex) % every === 0).map((p) => p.date);
}

/** Where the text equivalent says MODELLED: on every generated part, or once, on the history. */
export type ModelledWordPlacement = 'every-part' | 'once';

/**
 * The chart's text equivalent, built once with the word where it belongs: the shared chart
 * says MODELLED on the history and on the forecast; the Trends pages say it once (R2-m18).
 */
export function trendSummary(
  input: TrendChartInput,
  points: readonly ChartPoint[],
  placement: ModelledWordPlacement,
): string {
  const { label, unit } = input.metric;
  const forecastWord = placement === 'every-part' ? 'MODELLED forecast' : 'forecast';
  const history = points.filter((p) => p.kind === 'history');
  const live = points.find((p) => p.kind === 'live');
  const last = points.at(-1);
  const parts: string[] = [];
  const first = history[0];
  const end = history.at(-1);
  if (first && end) {
    parts.push(`MODELLED history from ${formatDate(first.date)} to ${formatDate(end.date)}`);
  }
  if (live) parts.push(`LIVE value ${formatValue(live.value, unit)} on ${formatDate(live.date)}`);
  if (last?.kind === 'forecast' && last.low !== null && last.high !== null) {
    const band = `${formatValue(last.low, unit)} to ${formatValue(last.high, unit)}`;
    const ends = `ends at ${formatValue(last.value, unit)}, range ${band}`;
    parts.push(`${forecastWord} to ${formatDate(last.date)} ${ends}`);
  }
  const unavailable = input.sentences.unavailable;
  const why = unavailable ? ` ${unavailable}` : '';
  return `${label}, ${parts.join('; ')}.${why} ${TABLE_NOTE}`;
}

export function buildTrendChartModel(input: TrendChartInput): TrendChartModel {
  const points = chartPoints(input);
  const hasForecast = points.some((p) => p.kind === 'forecast');
  const nowIndex = points.findIndex((p) => p.kind === 'live');
  const extents = points.flatMap((p) => [p.value, p.low ?? p.value, p.high ?? p.value]);
  const { trend, method, error, horizon, unavailable } = input.sentences;
  const legendKeys: LegendEntry['key'][] = hasForecast
    ? ['history', 'live', 'forecast', 'band']
    : ['history', 'live'];
  return {
    title: input.sentences.title,
    legend: legendKeys.map((key) => LEGEND[key]),
    points,
    rows: points.map((p) => plotRow(p, hasForecast)),
    table: points.map((p) => tableRow(p, input)),
    yScale: valueScale(extents, input.metric.range, input.metric.kind),
    xTicks: xTicks(points, Math.max(0, nowIndex)),
    now: points[nowIndex] ?? null,
    summary: trendSummary(input, points, 'every-part'),
    notes: [trend, method, error, horizon, unavailable].filter((s): s is string => s !== null),
  };
}
