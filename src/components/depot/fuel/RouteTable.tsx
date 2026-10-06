'use client';

import { useMemo } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { EmptyState } from '@/components/depot/shell/DataStates';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { formatCount } from '@/lib/depot/format';
import { formatRupees } from '@/lib/depot/fuel/format';
import {
  formatCostPerKm,
  formatKm,
  formatKmPerLitre,
  formatLitres,
  routeRows,
  type RouteRow,
} from '@/lib/depot/fuel/fuelPageModel';
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
    render: (r) => formatKm(r.distanceKm),
  },
  {
    key: 'litres',
    header: 'Litres',
    align: 'right',
    sortValue: (r) => r.fuelLitres,
    render: (r) => formatLitres(r.fuelLitres),
  },
  {
    key: 'cost',
    header: 'Cost',
    align: 'right',
    sortValue: (r) => r.cost,
    render: (r) => formatRupees(r.cost),
  },
  {
    key: 'kmpl',
    header: 'Km per litre',
    align: 'right',
    sortValue: (r) => r.kmPerLitre,
    render: (r) => formatKmPerLitre(r.kmPerLitre),
  },
  {
    key: 'cpk',
    header: 'Cost per km',
    align: 'right',
    sortValue: (r) => r.costPerKm,
    render: (r) => formatCostPerKm(r.costPerKm),
  },
];

export interface RouteTableProps {
  readonly rows: readonly FuelGroupRow[];
  readonly total: number;
}

/** Routes with their figures; capped by the server, with the true count beside it. */
export function RouteTable({ rows, total }: RouteTableProps) {
  const shaped = useMemo(() => routeRows(rows), [rows]);
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
              Showing {formatCount(rows.length)} of {formatCount(total)} routes.
            </p>
          ) : null}
          <DataTable
            columns={COLUMNS}
            rows={shaped}
            rowKey={(r) => r.label}
            caption="Modelled fuel and cost by route"
          />
        </>
      )}
    </section>
  );
}
