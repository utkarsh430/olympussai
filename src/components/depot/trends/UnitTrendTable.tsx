'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Sparkline } from '@/components/depot/shared/Sparkline';
import { DataTable, useTableSort, type Column } from '@/components/depot/shell/DataTable';
import { Pager } from '@/components/depot/shell/LongLists';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import type { DepotTrendsResponse } from '@/lib/depot/forecast/api';
import {
  defaultTrendSort,
  sortTrendRows,
  trendColumnHeaders,
  trendTableCaption,
  trendTableRows,
  TREND_ROW_CAP,
  type TrendSortKey,
  type TrendTableRow,
} from '@/lib/depot/forecast/trendsTableModel';
import { pageRange } from '@/lib/depot/listPaging';

export interface UnitTrendTableProps {
  readonly data: DepotTrendsResponse;
}

function columnsFor(data: DepotTrendsResponse): readonly Column<TrendTableRow>[] {
  const headers = trendColumnHeaders(data.trendUnit, data.days);
  // Missing changes sort last in either direction, as the model's own sort does.
  return [
    {
      key: 'name',
      header: 'Unit',
      sortValue: (row) => row.name.toLowerCase(),
      render: (row) => (
        <Link href={row.href} className="depot-link">
          {row.name}
        </Link>
      ),
      title: (row) => row.name,
    },
    {
      key: 'spark',
      header: headers.spark,
      render: (row) => <Sparkline values={row.values} label={row.sparkLabel} tagged={false} />,
    },
    {
      key: 'week',
      header: headers.week,
      unit: headers.unit,
      align: 'right',
      sortValue: (row) => row.week,
      render: (row) => row.weekSigned,
    },
    {
      key: 'weekWord',
      header: headers.weekWord,
      render: (row) => row.weekWord,
    },
    {
      key: 'fourWeeks',
      header: headers.fourWeeks,
      unit: headers.unit,
      align: 'right',
      sortValue: (row) => row.fourWeeks,
      render: (row) => row.fourWeeksSigned,
    },
    {
      key: 'fourWeeksWord',
      header: headers.fourWeeksWord,
      render: (row) => row.fourWeeksWord,
      title: (row) =>
        row.fourWeeksWord === 'TOO SHORT' ? 'Too little history for a change over 4 weeks' : undefined,
    },
  ];
}

/**
 * Every unit's trend for one metric from the single batch response: a sparkline with
 * its text equivalent, the week's change with its direction word and the four weeks'
 * change with its word. Sortable by either change, worst first, paged at 25; each
 * unit links to its own Trends page.
 */
export function UnitTrendTable({ data }: UnitTrendTableProps) {
  const rows = useMemo(() => trendTableRows(data), [data]);
  const columns = useMemo(() => columnsFor(data), [data]);
  const initial = defaultTrendSort(data.metric.higherIsBetter);
  const tableSort = useTableSort(columns, initial);
  const [page, setPage] = useState(0);
  const sort = tableSort.sort ?? initial;
  const sorted = useMemo(
    () => sortTrendRows(rows, { key: sort.key as TrendSortKey, direction: sort.direction }),
    [rows, sort.key, sort.direction],
  );
  const range = pageRange(page, sorted.length, TREND_ROW_CAP);
  const shown = sorted.slice(range.start, range.end);

  if (rows.length === 0) {
    return (
      <StatePanel
        kind="no-data"
        sentence="No unit reports this measure on this snapshot, so there is no trend to list."
        rows={3}
      />
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="trends-unit-table">
      <DataTable
        columns={columns}
        rows={shown}
        rowKey={(row) => row.id}
        caption={trendTableCaption(data.metric.label, rows.length, shown.length, {
          key: sort.key as TrendSortKey,
          direction: sort.direction,
        })}
        tableSort={{
          ...tableSort,
          setSort: (next) => {
            setPage(0);
            tableSort.setSort(next);
          },
        }}
        fixedRows
        freezeFirstColumn
        overflowCue
      />
      {sorted.length > TREND_ROW_CAP ? (
        <Pager page={range.page} total={sorted.length} pageSize={TREND_ROW_CAP} onPage={setPage} />
      ) : null}
    </div>
  );
}
