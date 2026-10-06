'use client';

import { useMemo } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { useTableTier } from '@/components/depot/revenue/useTableTier';
import { formatCount } from '@/lib/depot/format';
import {
  ROUTE_WIDTHS,
  routeColumnKeys,
  routeRateHeaders,
  type RouteKey,
} from '@/lib/depot/fuel/fuelColumns';
import type { FuelOtherRoutes } from '@/lib/depot/fuel/api';
import { routeCell, routeRows, type RouteRow } from '@/lib/depot/fuel/fuelPageModel';
import type { FuelGroupRow } from '@/lib/depot/fuel/types';
import type { TableTier } from '@/lib/depot/revenue/tableTier';

/** Every column by its key, so a key without a column fails the typecheck. */
const ALL_COLUMNS: Readonly<Record<RouteKey, Column<RouteRow>>> = {
  route: { key: 'route', header: 'Route', sortValue: (r) => r.label, render: (r) => r.label },
  buses: {
    key: 'buses',
    header: 'Buses',
    align: 'right',
    sortValue: (r) => r.busCount,
    render: (r) => formatCount(r.busCount),
  },
  distance: {
    key: 'distance',
    header: 'Distance',
    unit: 'km',
    align: 'right',
    sortValue: (r) => r.distanceKm,
    render: (r) => routeCell(r, 'distance'),
  },
  cost: {
    key: 'cost',
    header: 'Fuel cost',
    unit: '₹',
    align: 'right',
    sortValue: (r) => r.cost,
    render: (r) => routeCell(r, 'cost'),
  },
  kmpl: {
    key: 'kmpl',
    header: 'Km per litre',
    align: 'right',
    sortValue: (r) => r.kmPerLitre,
    render: (r) => routeCell(r, 'kmpl'),
  },
  cpk: {
    key: 'cpk',
    header: 'Fuel cost',
    unit: '₹/km',
    align: 'right',
    sortValue: (r) => r.costPerKm,
    render: (r) => routeCell(r, 'cpk'),
  },
};

/** The tier's column set, with its widths and (at 800) the short rate headers. */
function columnsFor(tier: TableTier): readonly Column<RouteRow>[] {
  const rates = routeRateHeaders(tier);
  return routeColumnKeys(tier).map((key: RouteKey) => {
    const column = ALL_COLUMNS[key];
    const header = key === 'kmpl' || key === 'cpk' ? { unit: undefined, ...rates[key] } : {};
    return { ...column, ...header, width: ROUTE_WIDTHS[key] };
  });
}

export interface RouteTableProps {
  readonly rows: readonly FuelGroupRow[];
  readonly total: number;
  readonly other: FuelOtherRoutes | null;
}

/** Routes with their figures; capped by the server, with the true count beside it. */
export function RouteTable({ rows, total, other }: RouteTableProps) {
  const shaped = useMemo(() => routeRows(rows, other), [rows, other]);
  const tier = useTableTier();
  const columns = useMemo(() => columnsFor(tier), [tier]);
  const note =
    total > rows.length
      ? `Highest fuel cost first: ${formatCount(rows.length)} of ${formatCount(total)} routes, the rest summed in one row`
      : 'Highest fuel cost first';
  return (
    <section aria-labelledby="depot-fuel-routes-heading" className="min-w-0">
      <SectionLabel
        id="depot-fuel-routes-heading"
        label="By route"
        count={total}
        note={note}
        tag="modelled"
      />
      {rows.length === 0 ? (
        <StatePanel kind="empty" sentence="No route has fuel figures in the modelled day." />
      ) : (
        <DataTable
          columns={columns}
          rows={shaped}
          rowKey={(r) => r.rowKey}
          caption="Fuel and fuel cost by route"
          fixedRows
          freezeFirstColumn
          overflowCue
        />
      )}
    </section>
  );
}
