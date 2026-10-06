'use client';

import { useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { Pager } from '@/components/depot/shell/LongLists';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { formatCount } from '@/lib/depot/format';
import { pageRange } from '@/lib/depot/listPaging';
import { coverageSentence } from '@/lib/depot/revenue/revenuePageModel';
import {
  NO_ROUTES_RAN,
  revenueTableRows,
  type RevenueTableRow,
} from '@/lib/depot/revenue/revenueTablePageModel';
import type { Coverage } from '@/lib/depot/types';
import type { RouteRevenueFigure } from '@/lib/depot/revenue/types';

const COLUMNS: readonly Column<RevenueTableRow>[] = [
  { key: 'route', header: 'Route', sortValue: (r) => r.routeName, render: (r) => r.routeName },
  { key: 'class', header: 'Class', sortValue: (r) => r.classLabel, render: (r) => r.classLabel },
  {
    key: 'trips',
    header: 'Trips',
    align: 'right',
    sortValue: (r) => r.trips,
    render: (r) => formatCount(r.trips),
  },
  {
    key: 'boardings',
    header: 'Boardings',
    align: 'right',
    sortValue: (r) => r.boardings,
    render: (r) => formatCount(r.boardings),
  },
  {
    key: 'load',
    header: 'Load factor',
    align: 'right',
    sortValue: (r) => r.loadFactor,
    render: (r) => r.loadFactorText,
  },
  {
    key: 'revenue',
    header: 'Revenue',
    align: 'right',
    sortValue: (r) => r.revenue,
    title: (r) => r.revenueText,
    render: (r) => (
      <span className="flex min-w-0 items-center justify-end gap-2">
        <span aria-hidden className="depot-bar-track w-20 !min-w-0 shrink-0">
          <span className="depot-bar-fill" style={{ width: `${r.barPct}%` }} />
        </span>
        <span className="w-24 text-right">{r.revenueText}</span>
      </span>
    ),
  },
  {
    key: 'earnings',
    header: 'Earnings per km',
    align: 'right',
    sortValue: (r) => r.earningsPerKm,
    title: (r) => r.withheldText ?? r.earningsCell,
    render: (r) => r.earningsCell,
  },
  {
    key: 'length',
    header: 'Route length (km)',
    align: 'right',
    sortValue: (r) => r.lengthKm,
    title: (r) => `${r.lengthRounded} km${r.lengthDerived ? ', from a real route profile' : ''}`,
    render: (r) => (
      <span className="inline-flex items-center justify-end gap-2">
        {r.lengthDerived ? <ProvenanceBadge provenance="derived" /> : null}
        <span>{formatCount(r.lengthRounded)}</span>
      </span>
    ),
  },
];

/** Every route's day in one table with an inline revenue bar; paged at 25. */
export function RevenueRoutesTable({
  routes,
  coverage,
}: {
  readonly routes: readonly RouteRevenueFigure[];
  readonly coverage: Coverage;
}) {
  const [page, setPage] = useState(0);
  const rows = useMemo(() => revenueTableRows(routes), [routes]);
  const range = pageRange(page, rows.length);
  return (
    <section aria-labelledby="revenue-routes-title" className="min-w-0">
      <SectionLabel
        id="revenue-routes-title"
        label="By route"
        count={rows.length}
        note={coverageSentence(coverage)}
      />
      {rows.length === 0 ? (
        <StatePanel kind="empty" sentence={NO_ROUTES_RAN} />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={rows.slice(range.start, range.end)}
            rowKey={(r) => r.routeName}
            caption="Revenue and ridership by route"
            fixedRows
            freezeFirstColumn
            overflowCue
          />
          <Pager page={range.page} total={rows.length} onPage={setPage} />
        </>
      )}
    </section>
  );
}
