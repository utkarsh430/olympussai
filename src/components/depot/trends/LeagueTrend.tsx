'use client';

import { useMemo } from 'react';
import { Sparkline } from '@/components/depot/shared/Sparkline';
import {
  trendTableRows,
  unitSparkLabel,
  type TrendTableRow,
} from '@/lib/depot/forecast/trendsTableModel';
import { METRIC_LABEL } from '@/lib/depot/forecast/wording';
import { useDepotTrends } from '@/hooks/useDepotTrends';

export const INDEX_TREND_HEADER = 'Index trend, MODELLED';
export const INDEX_TREND_TITLE =
  'Efficiency index over the last 30 days: a MODELLED history ending on the live value, and ' +
  'its direction over 4 weeks. Sorts by the change over 4 weeks.';

export type IndexTrends = ReadonlyMap<string, TrendTableRow>;

const NO_TRENDS: IndexTrends = new Map();

/** Every depot's index sparkline in one batch request, keyed by depot id. */
export function useIndexTrends(): IndexTrends {
  const { data } = useDepotTrends({ metric: 'index' });
  return useMemo(
    () => (data ? new Map(trendTableRows(data).map((row) => [row.id, row])) : NO_TRENDS),
    [data],
  );
}

/**
 * The sparkline and its visible text equivalent (the four weeks' direction).
 * Untagged: the column header carries MODELLED. A depot missing from the
 * response, or a response not yet arrived, draws the placeholder dash.
 */
export function IndexTrendCell({
  name,
  row,
}: {
  readonly name: string;
  readonly row?: TrendTableRow;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <Sparkline
        values={row?.values ?? []}
        label={row?.sparkLabel ?? unitSparkLabel(METRIC_LABEL.index, name, null)}
        tagged={false}
      />
      {row ? <span className="text-[11px] text-depot-muted">{row.fourWeeksText}</span> : null}
    </span>
  );
}
