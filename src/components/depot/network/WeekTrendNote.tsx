'use client';

import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { useDepotForecast } from '@/hooks/useDepotForecast';
import { weekTrendNote } from '@/lib/depot/network/overviewWords';
import type { HistoryScope, MetricKey } from '@/lib/depot/sim/types';

const NETWORK: HistoryScope = { kind: 'network' };

function useWeekSentence(metric: MetricKey): string | null {
  const state = useDepotForecast({ metric, scope: NETWORK });
  const result = state.data?.trend.result;
  return result && result.status === 'ok' ? result.summary.week.sentence : null;
}

/**
 * The band's right-hand note: the week's MODELLED trend of the on-road share and the
 * dark rate, in one sans sentence with ONE tag. The shares are not the counts in the
 * band, so the sentence names them. While loading, on error or with no trend it prints
 * nothing: a missing trend must not look like a broken figure.
 */
export function WeekTrendNote() {
  const note = weekTrendNote(useWeekSentence('onRoadShare'), useWeekSentence('darkRate'));
  if (note === null) return null;
  return (
    <p
      className="depot-caption -mt-4 mb-6 flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right"
      data-testid="depot-kpi-trends"
    >
      <ProvenanceBadge provenance="modelled" />
      <span className="min-w-0">{note}</span>
    </p>
  );
}
