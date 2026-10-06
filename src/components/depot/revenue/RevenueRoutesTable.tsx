'use client';

import { useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { Pager } from '@/components/depot/shell/LongLists';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { formatCount } from '@/lib/depot/format';
import { pageRange } from '@/lib/depot/listPaging';
import {
  REVENUE_WIDTHS,
  lengthBasisNote,
  lengthBasisWord,
  revenueColumnKeys,
  revenueRowDetail,
  revenueTableShape,
  type RevenueKey,
} from '@/lib/depot/revenue/revenueColumns';
import { useTableTier } from './useTableTier';
import {
  NO_ROUTES_RAN,
  REVENUE_PAGE_ROWS,
  revenueTableRows,
  type RevenueTableRow,
} from '@/lib/depot/revenue/revenueTablePageModel';
import type { RouteRevenueFigure } from '@/lib/depot/revenue/types';

function lengthColumn(allDerived: boolean): Column<RevenueTableRow> {
  return {
    key: 'length',
    header: 'Route length',
    unit: 'km',
    align: 'right',
    // Every length from a real profile: the column carries DERIVED once (ruling S51).
    ...(allDerived ? { tag: 'derived' as const } : {}),
    sortValue: (r) => r.lengthKm,
    title: (r) => `${r.lengthRounded} km${r.lengthDerived ? ', from a real route profile' : ''}`,
    render: (r) => formatCount(r.lengthRounded),
  };
}

/** Mixed lengths: where each came from, in plain muted words (M14: no tag in a cell). */
const BASIS_COLUMN: Column<RevenueTableRow> = {
  key: 'basis',
  header: 'Basis',
  sortValue: (r) => lengthBasisWord(r),
  render: (r) => <span className="text-depot-muted">{lengthBasisWord(r)}</span>,
};

/** The fixed columns by key; the length column depends on the rows. */
type FixedKey = Exclude<RevenueKey, 'length' | 'basis'>;
const COLUMNS: Readonly<Record<FixedKey, Column<RevenueTableRow>>> = {
  route: { key: 'route', header: 'Route', sortValue: (r) => r.routeName, render: (r) => r.routeName },
  class: { key: 'class', header: 'Class', sortValue: (r) => r.classLabel, render: (r) => r.classLabel },
  trips: {
    key: 'trips',
    header: 'Trips',
    align: 'right',
    sortValue: (r) => r.trips,
    render: (r) => formatCount(r.trips),
  },
  boardings: {
    key: 'boardings',
    header: 'Boardings',
    align: 'right',
    sortValue: (r) => r.boardings,
    render: (r) => formatCount(r.boardings),
  },
  load: {
    key: 'load',
    header: 'Load factor',
    align: 'right',
    sortValue: (r) => r.loadFactor,
    title: (r) => r.loadFactorText,
    // The value right-aligned, then a 64 px bar, inside the one cell.
    render: (r) => (
      <span className="flex min-w-0 items-center justify-end gap-2">
        <span className="text-right">{r.loadFactorText}</span>
        <span aria-hidden className="depot-bar-track w-16 !min-w-0 shrink-0">
          <span className="depot-bar-fill" style={{ width: `${r.loadBarPct}%` }} />
        </span>
      </span>
    ),
  },
  revenue: {
    key: 'revenue',
    header: 'Revenue',
    unit: '₹',
    align: 'right',
    sortValue: (r) => r.revenue,
    render: (r) => r.revenuePlain,
  },
  earnings: {
    key: 'earnings',
    header: '₹ / km',
    align: 'right',
    sortValue: (r) => r.earningsPerKm,
    title: (r) => r.withheldText ?? r.earningsCell,
    render: (r) => (
      <>
        {r.earningsCell}
        {r.withheldText ? <span className="sr-only">{` ${r.withheldText}`}</span> : null}
      </>
    ),
  },
};

/** Every route's modelled day in one table, the load factor with its bar; paged above 25 rows. */
export function RevenueRoutesTable({ routes }: { readonly routes: readonly RouteRevenueFigure[] }) {
  const [page, setPage] = useState(0);
  const rows = useMemo(() => revenueTableRows(routes), [routes]);
  const range = pageRange(page, rows.length);
  const allDerived = rows.length > 0 && rows.every((r) => r.lengthDerived);
  const tier = useTableTier();
  const shape = useMemo(() => revenueTableShape(rows), [rows]);
  const columns = useMemo(() => {
    // Every key has its column, so a key without one fails the typecheck, not the page.
    const all: Readonly<Record<RevenueKey, Column<RevenueTableRow>>> = {
      ...COLUMNS,
      length: lengthColumn(allDerived),
      basis: BASIS_COLUMN,
    };
    return revenueColumnKeys(tier, shape).map((key) => ({
      ...all[key],
      width: REVENUE_WIDTHS[key],
    }));
  }, [allDerived, tier, shape]);
  const detail = useMemo(
    () => (tier === 'narrow' ? (r: RevenueTableRow) => revenueRowDetail(r, shape) : undefined),
    [tier, shape],
  );
  return (
    <section aria-labelledby="revenue-routes-title" className="min-w-0">
      <SectionLabel
        id="revenue-routes-title"
        label="By route"
        count={rows.length}
        tag="modelled"
        note={lengthBasisNote(rows)}
      />
      {rows.length === 0 ? (
        <StatePanel kind="empty" sentence={NO_ROUTES_RAN} />
      ) : (
        <>
          <DataTable
            renderExpanded={detail}
            expandLabel={(r) => `Boardings and route length for ${r.routeName}`}
            columns={columns}
            rows={rows.slice(range.start, range.end)}
            rowKey={(r) => r.routeName}
            caption="Revenue and ridership by route"
            fixedRows
            freezeFirstColumn
            overflowCue
          />
          {rows.length > REVENUE_PAGE_ROWS ? (
            <Pager page={range.page} total={rows.length} onPage={setPage} />
          ) : null}
        </>
      )}
    </section>
  );
}
