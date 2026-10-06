'use client';

import { useTableTier } from '@/components/depot/revenue/useTableTier';
import { economicsColumnKeys } from '@/lib/depot/revenue/economicsLayout';

import { useEffect, useMemo, useState } from 'react';
import { DataTable, useTableSort } from '@/components/depot/shell/DataTable';
import { Pager } from '@/components/depot/shell/LongLists';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { groupCounts, groupLabel } from '@/components/depot/shell/tableGroups';
import { PAGE_ROWS, pageRange } from '@/lib/depot/listPaging';
import {
  economicsGroupKey,
  emptyRowText,
  type EconomicsFilters,
  type EconomicsRow,
} from '@/lib/depot/revenue/economicsPageModel';
import { sortRows } from '@/lib/depot/tableSort';
import { economicsColumns } from './EconomicsCells';

/*
 * The economics table on the shared DataTable: grouped by peer group ("SMALL
 * FLEETS · 35", counted over every page), 25 rows a page with the shared pager
 * under it (hidden at 25 rows or fewer), the page scrolling rather than the frame.
 */

export interface EconomicsGridProps {
  readonly rows: readonly EconomicsRow[];
  /** Every row before filtering, and the filters, so an empty table can say why. */
  readonly allRows: readonly EconomicsRow[];
  readonly filters: EconomicsFilters;
  readonly selectedId: string | null;
  readonly onSelect: (row: EconomicsRow) => void;
}

export function EconomicsGrid({
  rows,
  allRows,
  filters,
  selectedId,
  onSelect,
}: EconomicsGridProps) {
  const tier = useTableTier();
  const columns = useMemo(() => {
    const keys: readonly string[] = economicsColumnKeys(tier);
    return economicsColumns(selectedId, onSelect).filter((c) => keys.includes(c.key));
  }, [selectedId, onSelect, tier]);
  const tableSort = useTableSort(columns);
  const [page, setPage] = useState(0);
  // A new filter or order starts again at the first page.
  useEffect(() => setPage(0), [filters, tableSort.sort]);

  const sorted = useMemo(() => {
    const column = tableSort.sort ? columns.find((c) => c.key === tableSort.sort?.key) : undefined;
    return tableSort.sort && column?.sortValue
      ? sortRows(rows, column.sortValue, tableSort.sort.direction)
      : rows;
  }, [rows, columns, tableSort.sort]);
  const counts = useMemo(() => groupCounts(sorted, economicsGroupKey), [sorted]);
  const group = useMemo(
    () => ({
      key: economicsGroupKey,
      label: (key: string, shown: number) => groupLabel(key, counts.get(key) ?? shown),
    }),
    [counts],
  );

  if (sorted.length === 0) {
    return <StatePanel kind="empty" sentence={emptyRowText(allRows, filters)} />;
  }
  const range = pageRange(page, sorted.length);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <DataTable
        columns={columns}
        rows={sorted.slice(range.start, range.end)}
        rowKey={(r) => r.depotId}
        caption="Depot Economics Index ranking within peer groups"
        tableSort={tableSort}
        group={group}
        fixedRows
        overflowCue
      />
      {sorted.length > PAGE_ROWS ? (
        <Pager page={range.page} total={sorted.length} onPage={setPage} />
      ) : null}
    </div>
  );
}
