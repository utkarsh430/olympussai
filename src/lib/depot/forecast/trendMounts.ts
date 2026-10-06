/**
 * The one-line trend placed beside a live figure on the overview and the
 * depot cockpit. The line names its metric and carries its own MODELLED tag,
 * because the figure beside it is live and is often a count while the
 * history behind the trend is a share.
 */
import type { NetworkKpis } from '../types';
import type { MetricKey } from '../sim/types';
import type { TrendResult } from './trend';
import { METRIC_LABEL } from './wording';

/** Primary overview figures that have a history metric; the others get no trend line. */
export const KPI_TREND_METRIC: Readonly<Partial<Record<keyof NetworkKpis, MetricKey>>> = {
  onRoad: 'onRoadShare',
  noSignal: 'darkRate',
};

/** The cockpit's status board shows the on-road share's week. */
export const COCKPIT_TREND_METRIC: MetricKey = 'onRoadShare';

/** "On-road share, MODELLED: up 2.1 percentage points over 7 days"; null when there is no trend. */
export function weekTrendLine(metric: MetricKey, result: TrendResult): string | null {
  if (result.status !== 'ok') return null;
  return `${METRIC_LABEL[metric]}, MODELLED: ${result.summary.week.sentence}`;
}
