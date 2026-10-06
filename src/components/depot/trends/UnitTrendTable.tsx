'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Sparkline } from '@/components/depot/shared/Sparkline';
import { EmptyState } from '@/components/depot/shell/DataStates';
import type { DepotTrendsResponse } from '@/lib/depot/forecast/api';
import {
  capTrendRows,
  defaultTrendSort,
  sortTrendRows,
  trendColumnHeaders,
  trendTableCaption,
  trendTableRows,
  type TrendSort,
  type TrendSortKey,
} from '@/lib/depot/forecast/trendsTableModel';

export interface UnitTrendTableProps {
  readonly data: DepotTrendsResponse;
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  right = false,
}: {
  readonly label: string;
  readonly sortKey: TrendSortKey;
  readonly sort: TrendSort;
  readonly onSort: (key: TrendSortKey) => void;
  readonly right?: boolean;
}) {
  const active = sort.key === sortKey ? sort.direction : null;
  return (
    <th
      scope="col"
      aria-sort={active === null ? 'none' : active === 'asc' ? 'ascending' : 'descending'}
      className={`!whitespace-normal ${right ? 'depot-align-right' : ''}`}
    >
      <button type="button" className="depot-sort-button" onClick={() => onSort(sortKey)}>
        {label}
        <span aria-hidden className="inline-block w-3 text-holo-glow">
          {active === null ? '' : active === 'asc' ? '↑' : '↓'}
        </span>
      </button>
    </th>
  );
}

/**
 * Every unit's MODELLED trend for one metric, from the single batch
 * response: a sparkline with its text equivalent, the week's change and the
 * four weeks' direction. Worst first; each unit links to its own Trends page.
 */
export function UnitTrendTable({ data }: UnitTrendTableProps) {
  const [sort, setSort] = useState<TrendSort>(() => defaultTrendSort(data.metric.higherIsBetter));
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => trendTableRows(data), [data]);
  const sorted = useMemo(() => sortTrendRows(rows, sort), [rows, sort]);
  const { shown, hidden } = capTrendRows(sorted, expanded);
  const headers = trendColumnHeaders(data.trendUnit, data.days);
  const onSort = (key: TrendSortKey): void =>
    setSort((s) => ({ key, direction: s.key === key && s.direction === 'asc' ? 'desc' : 'asc' }));

  if (rows.length === 0) {
    return (
      <EmptyState>
        No unit reports this measure on this snapshot, so there is no trend to list.
      </EmptyState>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div role="region" aria-label="Unit trends" tabIndex={0} className="depot-table-frame">
        <table className="depot-table" data-testid="trends-unit-table">
          <caption className="caption-top border-b border-depot-line bg-depot-surface px-3 py-2 text-left font-sans text-xs text-depot-muted">
            {trendTableCaption(data.metric.label, rows.length, shown.length, sort)}
          </caption>
          <thead>
            <tr>
              <SortHeader label="Unit" sortKey="name" sort={sort} onSort={onSort} />
              <th scope="col" className="!whitespace-normal">
                {headers.spark}
              </th>
              <SortHeader label={headers.week} sortKey="week" sort={sort} onSort={onSort} right />
              <SortHeader
                label={headers.fourWeeks}
                sortKey="fourWeeks"
                sort={sort}
                onSort={onSort}
                right
              />
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id}>
                <td className="max-w-56 truncate">
                  <Link href={row.href} className="depot-link">
                    {row.name}
                  </Link>
                </td>
                <td>
                  <Sparkline values={row.values} label={row.sparkLabel} tagged={false} />
                </td>
                <td className="depot-align-right whitespace-nowrap">{row.weekText}</td>
                <td className="depot-align-right whitespace-nowrap">{row.fourWeeksText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 || expanded ? (
        <div>
          <button
            type="button"
            className="depot-filter-button"
            aria-expanded={expanded}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? 'Show the first rows' : `Show all ${rows.length} units`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
