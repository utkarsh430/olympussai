'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useTableTier } from '@/components/depot/shell/useTableTier';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { rosterBusHref } from '@/lib/depot/depotNav';
import type { FuelFlaggedBus, FuelResponse } from '@/lib/depot/fuel/api';
import {
  STAND_OUT_WIDTHS,
  standOutColumnKeys,
  standOutRowTitle,
  standOutSecondLine,
  type StandOutKey,
} from '@/lib/depot/fuel/fuelColumns';
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
import type { TableTier } from '@/lib/depot/shell/tableTier';

function registrationCell(depotId: string, bus: FuelFlaggedBus, tier: TableTier) {
  const link = (
    <Link href={rosterBusHref(depotId, bus.registrationNumber)} className="depot-table-link">
      {bus.registrationNumber}
    </Link>
  );
  if (tier !== 'medium') return link;
  // At 1024 CLASS and BASIS fold into a muted second line under the registration.
  return (
    <span className="flex flex-col leading-tight">
      {link}
      <span className="text-[11px] text-depot-muted">{standOutSecondLine(bus)}</span>
    </span>
  );
}

function buildColumns(
  depotId: string,
  tier: TableTier,
  withRoute: boolean,
  thresholdPct: number,
): readonly Column<FuelFlaggedBus>[] {
  const all: Record<StandOutKey, Column<FuelFlaggedBus>> = {
    registration: {
      key: 'registration',
      header: 'Registration',
      sortValue: (b) => b.registrationNumber,
      title: (b) => standOutRowTitle(b, tier),
      render: (b) => registrationCell(depotId, b, tier),
    },
    class: {
      key: 'class',
      header: 'Class',
      sortValue: (b) => b.serviceClass,
      render: (b) => groupLabel(b.serviceClass),
    },
    route: {
      key: 'route',
      header: 'Route',
      sortValue: (b) => b.routeName,
      title: (b) => b.routeName ?? 'No route',
      render: (b) => routeDash(b.routeName),
    },
    bus: {
      key: 'bus',
      ...STAND_OUT_HEADERS.bus,
      align: 'right',
      // A lower km per litre is more fuel per kilometre: sort on the consumption shown.
      sortValue: (b) => -b.kmPerLitre,
      render: (b) => formatLitresPer100Km(b.kmPerLitre),
    },
    median: {
      key: 'median',
      ...STAND_OUT_HEADERS.peers,
      align: 'right',
      sortValue: (b) => -b.peerMedianKmPerLitre,
      render: (b) => formatLitresPer100Km(b.peerMedianKmPerLitre),
    },
    variance: {
      key: 'variance',
      ...STAND_OUT_HEADERS.variance,
      align: 'right',
      sortValue: (b) => b.variancePct,
      render: (b) => formatVariance(b.variancePct, thresholdPct),
    },
    basis: {
      key: 'basis',
      header: 'Basis',
      sortValue: (b) => b.comparison,
      render: (b) => BASIS_LABEL[b.comparison],
    },
  };
  return standOutColumnKeys(tier, withRoute).map((key) => ({
    ...all[key],
    width: STAND_OUT_WIDTHS[key],
  }));
}

/** The buses that use more fuel per kilometre than their peers: consumption, a signed variance and a basis. */
export function FlaggedList({ data }: { readonly data: FuelResponse }) {
  const tier = useTableTier();
  const withRoute = showRouteColumn(data.flagged);
  const threshold = data.rule.thresholdPct;
  const columns = useMemo(
    () => buildColumns(data.depot.id, tier, withRoute, threshold),
    [data.depot.id, tier, withRoute, threshold],
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
      {footer ? (
        <p className="depot-prose mt-2" data-testid="depot-fuel-standout-foot">
          {footer}
        </p>
      ) : null}
    </section>
  );
}
