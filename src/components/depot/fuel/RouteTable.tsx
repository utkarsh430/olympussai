'use client';

import { useMemo } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { formatCount } from '@/lib/depot/format';
import type { FuelOtherRoutes } from '@/lib/depot/fuel/api';
import { routeCell, routeRows, type RouteRow } from '@/lib/depot/fuel/fuelPageModel';
import type { FuelGroupRow } from '@/lib/depot/fuel/types';

const COLUMNS: readonly Column<RouteRow>[] = [
  { key: 'route', header: 'Route', sortValue: (r) => r.label, render: (r) => r.label },
  {
    key: 'buses',
    header: 'Buses',
    align: 'right',
    sortValue: (r) => r.busCount,
    render: (r) => formatCount(r.busCount),
  },
  {
    key: 'distance',
    header: 'Distance',
    align: 'right',
    sortValue: (r) => r.distanceKm,
    render: (r) => routeCell(r, 'distance'),
  },
  {
    key: 'litres',
    header: 'Litres',
    align: 'right',
    sortValue: (r) => r.fuelLitres,
    render: (r) => routeCell(r, 'litres'),
  },
  {
    key: 'cost',
    header: 'Cost',
    align: 'right',
    sortValue: (r) => r.cost,
    render: (r) => routeCell(r, 'cost'),
  },
  {
    key: 'kmpl',
    header: 'Km per litre',
    align: 'right',
    sortValue: (r) => r.kmPerLitre,
    render: (r) => routeCell(r, 'kmpl'),
  },
  {
    key: 'cpk',
    header: 'Cost per km',
    align: 'right',
    sortValue: (r) => r.costPerKm,
    render: (r) => routeCell(r, 'cpk'),
  },
];

export interface RouteTableProps {
  readonly rows: readonly FuelGroupRow[];
  readonly total: number;
  readonly other: FuelOtherRoutes | null;
}

/** Routes with their figures; capped by the server, with the true count beside it. */
export function RouteTable({ rows, total, other }: RouteTableProps) {
  const shaped = useMemo(() => routeRows(rows, other), [rows, other]);
  const note =
    total > rows.length
      ? `Highest cost first: ${formatCount(rows.length)} of ${formatCount(total)} routes, the rest summed in one row`
      : 'Highest cost first';
  return (
    <section aria-labelledby="depot-fuel-routes-heading" className="min-w-0">
      <SectionLabel id="depot-fuel-routes-heading" label="By route" count={total} note={note} />
      {rows.length === 0 ? (
        <StatePanel kind="empty" sentence="No route has fuel figures for this date." />
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={shaped}
          rowKey={(r) => r.rowKey}
          caption="Fuel and cost by route"
          fixedRows
          freezeFirstColumn
          overflowCue
        />
      )}
    </section>
  );
}
