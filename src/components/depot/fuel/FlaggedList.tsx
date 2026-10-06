'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { rosterBusHref } from '@/lib/depot/depotNav';
import type { FuelFlaggedBus, FuelResponse } from '@/lib/depot/fuel/api';
import { formatKmPerLitre, groupLabel } from '@/lib/depot/fuel/fuelPageModel';
import {
  BASIS_LABEL,
  NOTHING_STANDS_OUT,
  formatVariance,
  routeDash,
  showRouteColumn,
  standOutFooter,
  standOutNote,
} from '@/lib/depot/fuel/fuelPageTables';

function buildColumns(depotId: string, withRoute: boolean): readonly Column<FuelFlaggedBus>[] {
  const route: Column<FuelFlaggedBus> = {
    key: 'route',
    header: 'Route',
    sortValue: (b) => b.routeName,
    title: (b) => b.routeName ?? 'No route',
    render: (b) => routeDash(b.routeName),
  };
  return [
    {
      key: 'registration',
      header: 'Registration',
      sortValue: (b) => b.registrationNumber,
      title: (b) => b.registrationNumber,
      render: (b) => (
        <Link
          href={rosterBusHref(depotId, b.registrationNumber)}
          className="text-holo-glow underline-offset-2 hover:underline"
        >
          {b.registrationNumber}
        </Link>
      ),
    },
    { key: 'class', header: 'Class', sortValue: (b) => b.serviceClass, render: (b) => groupLabel(b.serviceClass) },
    ...(withRoute ? [route] : []),
    {
      key: 'kmpl',
      header: 'Km per litre',
      align: 'right',
      sortValue: (b) => b.kmPerLitre,
      render: (b) => formatKmPerLitre(b.kmPerLitre),
    },
    {
      key: 'median',
      header: "Peers' median",
      align: 'right',
      sortValue: (b) => b.peerMedianKmPerLitre,
      render: (b) => formatKmPerLitre(b.peerMedianKmPerLitre),
    },
    {
      key: 'variance',
      header: 'Variance',
      align: 'right',
      sortValue: (b) => b.variancePct,
      render: (b) => formatVariance(b.variancePct),
    },
    { key: 'basis', header: 'Basis', sortValue: (b) => b.comparison, render: (b) => BASIS_LABEL[b.comparison] },
  ];
}

/** The buses whose use per kilometre stands out from their peers: a numeric variance and a short basis. */
export function FlaggedList({ data }: { readonly data: FuelResponse }) {
  const withRoute = showRouteColumn(data.flagged);
  const columns = useMemo(() => buildColumns(data.depot.id, withRoute), [data.depot.id, withRoute]);
  const footer = standOutFooter(data);
  return (
    <section aria-labelledby="depot-fuel-flagged-heading" className="min-w-0">
      <SectionLabel
        id="depot-fuel-flagged-heading"
        label="Buses that stand out"
        count={data.flaggedTotal}
        note={standOutNote(data.rule.thresholdPct, data.rule.minPeers)}
      />
      {data.flagged.length === 0 ? (
        <p className="depot-prose" role="status">
          {NOTHING_STANDS_OUT}
        </p>
      ) : (
        <DataTable
          columns={columns}
          rows={data.flagged}
          rowKey={(b) => b.registrationNumber}
          caption="Buses whose fuel use per kilometre stands out from their peers"
          fixedRows
          freezeFirstColumn
          overflowCue
        />
      )}
      {footer ? <p className="depot-prose mt-2">{footer}</p> : null}
    </section>
  );
}
