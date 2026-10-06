/**
 * Pure logic for the two Trends pages: which metrics can be chosen, how the
 * choice travels in the URL, and the sentences the page prints around the
 * chart. Every metric, label and unit is read from the forecast module so a
 * new history metric appears here without a second list to update.
 */
import { depotHref } from '../depotNav';
import type { ForecastSentences } from './api';
import type { MetricKey } from '../sim/types';
import { formatDate } from './chartScale';
import { FOUR_WEEK_DAYS, type TrendResult } from './trend';
import { METRIC_LABEL, metricInfo } from './wording';

export const TREND_METRIC_PARAM = 'metric';
export const DEFAULT_TREND_METRIC: MetricKey = 'onRoadShare';
export const NETWORK_TRENDS_PATH = '/project/depots/trends';

/** Every metric the history offers, in the forecast module's order. */
export const TREND_METRICS: readonly MetricKey[] = Object.keys(METRIC_LABEL) as MetricKey[];

const KNOWN: ReadonlySet<string> = new Set(TREND_METRICS);

/** Said once per page: what the history is today and what it will become. */
export const MODELLED_HISTORY_NOTE =
  'Every history on this page is MODELLED: it is generated until a database of real history ' +
  'exists, and the same charts will then show measured history. Only the last point of each ' +
  'line, the live value, comes from the feed today.';

/**
 * The closing disclosure's paragraphs about the chart: what the history is, then the
 * method, the typical error and the horizon with the band's meaning, in the words the
 * response carries. A forecast is never drawn without these, and they stand here, not
 * under the chart, where one caption line says the error and the trends.
 */
export function chartDisclosureParagraphs(
  sentences: Pick<ForecastSentences, 'method' | 'error' | 'horizon'> | null,
): readonly string[] {
  const forecast = sentences === null ? [] : [sentences.method, sentences.error, sentences.horizon];
  return [MODELLED_HISTORY_NOTE, ...forecast.filter((s): s is string => s !== null)];
}

/** Said under the "no forecast" state: what changes it. */
export const NO_FORECAST_REMEDY =
  'A forecast appears once the history is long enough and has no gap.';

export interface MetricOption {
  readonly key: MetricKey;
  readonly label: string;
  readonly unitLabel: string;
}

export function metricOptions(): readonly MetricOption[] {
  return TREND_METRICS.map((key) => {
    const info = metricInfo(key);
    return { key, label: info.label, unitLabel: info.unitLabel };
  });
}

/**
 * The metric named in the URL. Anything else (missing, repeated, misspelt,
 * an inherited property name) falls back to the default without an error,
 * so an old or hand-edited link still opens a working page.
 */
export function parseTrendMetric(raw: string | readonly string[] | null | undefined): MetricKey {
  if (typeof raw !== 'string' || !KNOWN.has(raw)) return DEFAULT_TREND_METRIC;
  return raw as MetricKey;
}

export function depotTrendsPath(depotId: string): string {
  return `${depotHref(depotId)}/trends`;
}

/** A linkable view: the page path with the metric always named. */
export function trendsHref(path: string, metric: MetricKey): string {
  const params = new URLSearchParams({ [TREND_METRIC_PARAM]: metric });
  return `${path}?${params.toString()}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A YYYY-MM-DD that names a real calendar day, so a printed date is never "NaN". */
function isRealDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The trend of a series too short or broken to have one: why, in words. */
export function noTrendSentence(result: Exclude<TrendResult, { status: 'ok' }>): string {
  if (result.status === 'invalid_input') {
    return 'No trend: the history for this measure could not be read.';
  }
  if (result.missingDate !== null) {
    const gap = isRealDate(result.missingDate)
      ? `the history is missing ${formatDate(result.missingDate, true)}`
      : 'the history has a gap';
    return (
      `No trend yet: ${gap}, ` +
      `so only the ${result.historyDays} days since count, and a trend needs ${result.required}.`
    );
  }
  return (
    `No trend yet: it needs ${result.required} days of history and this series ` +
    `has ${result.historyDays}.`
  );
}

/** The week's and the four weeks' trend sentences, each tagged, or why there are none. */
export function trendLines(result: TrendResult): readonly string[] {
  if (result.status !== 'ok') return [noTrendSentence(result)];
  const { week, fourWeeks, historyDays } = result.summary;
  const weekLine = `Trend: ${week.sentence}`;
  if (fourWeeks === null) {
    return [
      weekLine,
      `No trend over 4 weeks yet: it needs ${FOUR_WEEK_DAYS + 1} days of history and ` +
        `this series has ${historyDays}.`,
    ];
  }
  return [weekLine, `Trend: ${fourWeeks.sentence}`];
}

const TREND_TAG = /^(MODELLED trend|Trend): /;

function withoutTrendTag(line: string): string {
  return line.replace(TREND_TAG, '');
}

/**
 * The trend lines a page prints under the shared chart, which already prints
 * the headline one (`chartLine`); each sentence then appears exactly once.
 */
export function trendLinesBesideChart(
  result: TrendResult,
  chartLine: string | null,
): readonly string[] {
  // The chart prints its own tag on its headline sentence: compare without any tag.
  const bare = chartLine === null ? null : withoutTrendTag(chartLine);
  return trendLines(result).filter((line) => withoutTrendTag(line) !== bare);
}
