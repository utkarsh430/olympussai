'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { rosterBusHref } from '@/lib/depot/depotNav';
import type { FuelFlaggedBus, FuelResponse } from '@/lib/depot/fuel/api';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { groupLabel } from '@/lib/depot/fuel/fuelPageModel';
import {
  BASIS_LABEL,
  STAND_OUT_HEADERS,
  formatLitresPer100Km,
  formatVariance,
  nothingStandsOut,
  routeDash,
  showRouteColumn,
  standOutFooter,
  standOutNote,
} from '@/lib/depot/fuel/fuelStandOut';

function buildColumns(
  depotId: string,
  withRoute: boolean,
  thresholdPct: number,
): readonly Column<FuelFlaggedBus>[] {
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
    {
      key: 'class',
      header: 'Class',
      sortValue: (b) => b.serviceClass,
      render: (b) => groupLabel(b.serviceClass),
    },
    ...(withRoute ? [route] : []),
    {
      key: 'bus',
      ...STAND_OUT_HEADERS.bus,
      align: 'right',
      // A lower km per litre is more fuel per kilometre: sort on the consumption shown.
      sortValue: (b) => -b.kmPerLitre,
      render: (b) => formatLitresPer100Km(b.kmPerLitre),
    },
    {
      key: 'median',
      ...STAND_OUT_HEADERS.peers,
      align: 'right',
      sortValue: (b) => -b.peerMedianKmPerLitre,
      render: (b) => formatLitresPer100Km(b.peerMedianKmPerLitre),
    },
    {
      key: 'variance',
      ...STAND_OUT_HEADERS.variance,
      align: 'right',
      sortValue: (b) => b.variancePct,
      render: (b) => formatVariance(b.variancePct, thresholdPct),
    },
    {
      key: 'basis',
      header: 'Basis',
      sortValue: (b) => b.comparison,
      render: (b) => BASIS_LABEL[b.comparison],
    },
  ];
}

/** The buses that use more fuel per kilometre than their peers: consumption, a signed variance and a basis. */
export function FlaggedList({ data }: { readonly data: FuelResponse }) {
  const withRoute = showRouteColumn(data.flagged);
  const threshold = data.rule.thresholdPct;
  const columns = useMemo(
    () => buildColumns(data.depot.id, withRoute, threshold),
    [data.depot.id, withRoute, threshold],
  );
  const footer = standOutFooter(data);
  return (
    <section aria-labelledby="depot-fuel-flagged-heading" className="min-w-0">
      <SectionLabel
        id="depot-fuel-flagged-heading"
        label="Buses that stand out"
        count={data.flaggedTotal}
        note={standOutNote(threshold)}
        tag="modelled"
      />
      {data.flagged.length === 0 ? (
        <StatePanel kind="empty" compact tone="ok" sentence={nothingStandsOut(threshold)} />
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
