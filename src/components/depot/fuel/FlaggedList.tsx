'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { rosterBusHref } from '@/lib/depot/depotNav';
import type { FuelFlaggedBus, FuelResponse } from '@/lib/depot/fuel/api';
import {
  flaggedHeadline,
  formatKmPerLitre,
  groupLabel,
  noComparisonNote,
  noDistanceNote,
  notRunNote,
  shortfallNote,
  peersDifferNote,
  routeLabel,
  ruleSentence,
} from '@/lib/depot/fuel/fuelPageModel';

function buildColumns(depotId: string): readonly Column<FuelFlaggedBus>[] {
  return [
    {
      key: 'registration',
      header: 'Registration',
      sortValue: (b) => b.registrationNumber,
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
    {
      key: 'route',
      header: 'Route',
      sortValue: (b) => b.routeName,
      render: (b) => routeLabel(b.routeName),
    },
    {
      key: 'kmpl',
      header: 'Km per litre',
      align: 'right',
      sortValue: (b) => b.kmPerLitre,
      render: (b) => formatKmPerLitre(b.kmPerLitre),
    },
    {
      key: 'median',
      header: 'Peers median',
      align: 'right',
      sortValue: (b) => b.peerMedianKmPerLitre,
      render: (b) => formatKmPerLitre(b.peerMedianKmPerLitre),
    },
    {
      key: 'variance',
      header: 'Variance',
      sortValue: (b) => b.variancePct,
      render: (b) => b.statement,
    },
  ];
}

/** The buses whose use per kilometre stands out from their peers, and the rule behind the list. */
export function FlaggedList({ data }: { readonly data: FuelResponse }) {
  const columns = useMemo(() => buildColumns(data.depot.id), [data.depot.id]);
  const unlisted = {
    peersDiffer: data.peersDifferCount,
    noComparison: data.noComparisonCount,
    thresholdPct: data.rule.thresholdPct,
  };
  // With nothing listed the headline already carries these two sentences.
  const listed = data.flaggedTotal > 0;
  const notes = [
    listed ? peersDifferNote(unlisted.peersDiffer, unlisted.thresholdPct) : null,
    listed ? noComparisonNote(unlisted.noComparison) : null,
    noDistanceNote(data.noDistanceCount),
    notRunNote(data.notRunCount),
    shortfallNote(data.day.dutiesWithoutBus),
  ].filter((n): n is string => n !== null);
  return (
    <section aria-labelledby="depot-fuel-flagged-heading" className="animate-rise">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="depot-fuel-flagged-heading" className="depot-section-label !mb-0">
          Buses that stand out
        </h2>
        <ProvenanceBadge provenance="modelled" />
      </div>
      <p className="depot-prose mb-1" role="status">
        {flaggedHeadline(data.flaggedTotal, data.flagged.length, unlisted)}
      </p>
      <p className="depot-prose mb-3">{ruleSentence(data.rule.thresholdPct, data.rule.minPeers)}</p>
      {notes.map((note) => (
        <p key={note} className="depot-prose mb-3">
          {note}
        </p>
      ))}
      {data.flagged.length === 0 ? null : (
        <DataTable
          columns={columns}
          rows={data.flagged}
          rowKey={(b) => b.registrationNumber}
          caption="Buses whose modelled fuel use per kilometre stands out from their peers"
        />
      )}
    </section>
  );
}
