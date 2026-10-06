'use client';

import { useMemo } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { EmptyState } from '@/components/depot/shell/DataStates';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
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
  return (
    <section aria-labelledby="depot-fuel-routes-heading" className="animate-rise">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="depot-fuel-routes-heading" className="depot-section-label !mb-0">
          By route
        </h2>
        <ProvenanceBadge provenance="modelled" />
      </div>
      {rows.length === 0 ? (
        <EmptyState>No route has modelled fuel for this date.</EmptyState>
      ) : (
        <>
          {total > rows.length ? (
            <p className="depot-prose mb-2">
              Showing the {formatCount(rows.length)} routes with the highest cost of {formatCount(total)}; the
              rest are summed in one row, so the table adds up to the depot total.
            </p>
          ) : null}
          <DataTable
            columns={COLUMNS}
            rows={shaped}
            rowKey={(r) => r.rowKey}
            caption="Modelled fuel and cost by route"
          />
        </>
      )}
    </section>
  );
}
