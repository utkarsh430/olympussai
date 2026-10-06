'use client';

import { useMemo, useState } from 'react';
import { formatCount } from '@/lib/depot/format';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { buildRouteRows, type RevenueRow } from '@/lib/depot/revenue/revenuePageModel';
import type { RouteRevenueFigure } from '@/lib/depot/revenue/types';
import { sortRows, type SortDirection, type SortValue } from '@/lib/depot/tableSort';

/** Rows shown before "Show all N"; sorting always runs over every route first. */
const ROW_CAP = 25;

interface Column {
  readonly key: string;
  readonly header: string;
  readonly right?: boolean;
  readonly sortValue: (row: RevenueRow) => SortValue;
  readonly render: (row: RevenueRow) => React.ReactNode;
}

const COLUMNS: readonly Column[] = [
  { key: 'route', header: 'Route', sortValue: (r) => r.routeName, render: (r) => r.routeName },
  { key: 'class', header: 'Class', sortValue: (r) => r.classLabel, render: (r) => r.classLabel },
  { key: 'trips', header: 'Trips', right: true, sortValue: (r) => r.trips, render: (r) => formatCount(r.trips) },
  {
    key: 'boardings',
    header: 'Boardings',
    right: true,
    sortValue: (r) => r.boardings,
    render: (r) => formatCount(r.boardings),
  },
  {
    key: 'load',
    header: 'Load factor',
    right: true,
    sortValue: (r) => r.loadFactor,
    render: (r) => r.loadFactorText,
  },
  { key: 'revenue', header: 'Revenue', right: true, sortValue: (r) => r.revenue, render: (r) => r.revenueText },
  {
    key: 'earnings',
    header: 'Earnings per km',
    right: true,
    sortValue: (r) => r.earningsPerKm,
    render: (r) =>
      r.withheldText === null ? (
        r.earningsText
      ) : (
        <span title={r.withheldText} className="text-depot-muted">
          {r.earningsText}
          <span className="sr-only">{`. ${r.withheldText}`}</span>
        </span>
      ),
  },
  { key: 'length', header: 'Route length', right: true, sortValue: () => null, render: (r) => r.lengthText },
];

interface Sort {
  readonly key: string;
  readonly direction: SortDirection;
}

/** Every route's modelled day. Sortable, capped, scrolling sideways only inside its own frame. */
export function RevenueRoutesTable({ routes }: { readonly routes: readonly RouteRevenueFigure[] }) {
  const [sort, setSort] = useState<Sort | null>(null);
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => buildRouteRows(routes), [routes]);
  const sorted = useMemo(() => {
    const column = sort ? COLUMNS.find((c) => c.key === sort.key) : undefined;
    return sort && column ? sortRows(rows, column.sortValue, sort.direction) : rows;
  }, [rows, sort]);
  const visible = showAll ? sorted : sorted.slice(0, ROW_CAP);
  const toggle = (key: string): void =>
    setSort((s) => ({ key, direction: s?.key === key && s.direction === 'asc' ? 'desc' : 'asc' }));

  return (
    <section aria-labelledby="revenue-routes-title" className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="revenue-routes-title" className="depot-label">
          By route (modelled)
        </h2>
        <ProvenanceBadge provenance="modelled" />
        <span className="text-[11px] text-depot-muted" role="status">
          {`Showing ${formatCount(visible.length)} of ${formatCount(sorted.length)} routes`}
        </span>
      </div>
      <div role="region" aria-label="Revenue by route, modelled" tabIndex={0} className="depot-table-frame">
        <table className="depot-table">
          <caption className="sr-only">Modelled revenue and ridership by route</caption>
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const active = sort?.key === c.key ? sort.direction : null;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active === null ? 'none' : active === 'asc' ? 'ascending' : 'descending'}
                    className={c.right ? 'depot-align-right' : ''}
                  >
                    <button type="button" className="depot-sort-button" onClick={() => toggle(c.key)}>
                      {c.header}
                      <span aria-hidden className="inline-block w-3 text-holo-glow">
                        {active === null ? '' : active === 'asc' ? '↑' : '↓'}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="depot-prose !py-6">
                  No route has a bus running in the feed now.
                </td>
              </tr>
            ) : null}
            {visible.map((row) => (
              <tr key={row.routeName}>
                {COLUMNS.map((c) => (
                  <td key={c.key} className={`whitespace-nowrap ${c.right ? 'depot-align-right' : ''}`}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > ROW_CAP ? (
        <button
          type="button"
          aria-pressed={showAll}
          onClick={() => setShowAll((value) => !value)}
          className="mt-2 rounded-[3px] border border-depot-line px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-depot-muted hover:text-depot-ink"
        >
          {showAll ? `Show top ${ROW_CAP}` : `Show all ${formatCount(sorted.length)}`}
        </button>
      ) : null}
    </section>
  );
}
