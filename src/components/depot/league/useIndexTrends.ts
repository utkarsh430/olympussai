'use client';

import { useMemo } from 'react';
import { trendTableRows, type TrendTableRow } from '@/lib/depot/forecast/trendsTableModel';
import { useDepotTrends } from '@/hooks/useDepotTrends';

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
