'use client';

import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import {
  COCKPIT_TREND_METRIC,
  KPI_TREND_METRIC,
  weekTrendLine,
} from '@/lib/depot/forecast/trendMounts';
import type { HistoryScope, MetricKey } from '@/lib/depot/sim/types';
import type { NetworkKpis } from '@/lib/depot/types';
import { useDepotForecast } from '@/hooks/useDepotForecast';

const NETWORK: HistoryScope = { kind: 'network' };

/**
 * The week's MODELLED trend of one metric, as one quiet line that names its
 * metric and carries the tag in words. It never replaces or restyles the
 * live figure it sits beside. While loading, on error or with no trend it
 * prints nothing: a missing trend must not look like a broken figure.
 */
function WeekTrendLine({
  metric,
  scope,
}: {
  readonly metric: MetricKey | null;
  readonly scope: HistoryScope;
}) {
  const state = useDepotForecast(metric === null ? null : { metric, scope });
  const line =
    metric !== null && state.data ? weekTrendLine(metric, state.data.trend.result) : null;
  if (line === null) return null;
  return (
    <dd className="mt-1.5 text-[11px] leading-snug text-depot-muted" data-testid="trend-week-line">
      {line}
    </dd>
  );
}

/** Beside an overview figure: one request per figure that has a history metric, none otherwise. */
export function KpiWeekTrend({ figure }: { readonly figure: keyof NetworkKpis }) {
  return <WeekTrendLine metric={KPI_TREND_METRIC[figure] ?? null} scope={NETWORK} />;
}

/** Beside the cockpit's on-road figure: one request for this depot. */
export function CockpitWeekTrend() {
  const { depotId } = useDepotDetailContext();
  return <WeekTrendLine metric={COCKPIT_TREND_METRIC} scope={{ kind: 'depot', depotId }} />;
}
