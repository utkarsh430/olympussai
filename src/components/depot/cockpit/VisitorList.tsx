'use client';

import Link from 'next/link';
import { EmptyState } from '@/components/depot/shell/DataStates';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import type { VisitorRow } from '@/lib/depot/cockpit/cockpitModel';
import { rosterBusHref } from '@/lib/depot/depotNav';

export interface VisitorListProps {
  /** Sorted by home depot, then registration. */
  readonly visitors: readonly VisitorRow[];
  /** Without an established yard no bus can be placed in it, so the list is omitted. */
  readonly yardEstablished: boolean;
}

/**
 * A visitor is listed in its own depot's roster, not this one, so its link goes
 * there; a visitor with no home depot in the feed has nowhere to link to.
 */
const COLUMNS: readonly Column<VisitorRow>[] = [
  {
    key: 'bus',
    header: 'Bus',
    sortValue: (row) => row.registrationNumber,
    render: (row) =>
      row.homeDepotId ? (
        <Link
          href={rosterBusHref(row.homeDepotId, row.registrationNumber)}
          className="depot-link whitespace-nowrap"
        >
          {row.registrationNumber}
        </Link>
      ) : (
        <span className="whitespace-nowrap">{row.registrationNumber}</span>
      ),
  },
  {
    key: 'home',
    header: 'Home depot',
    sortValue: (row) => row.homeDepotLabel,
    render: (row) => <span className="whitespace-nowrap">{row.homeDepotLabel}</span>,
  },
  {
    key: 'state',
    header: 'State',
    sortValue: (row) => row.stateLabel,
    render: (row) => <span className="whitespace-nowrap">{row.stateLabel}</span>,
  },
];

/** Buses of other depots standing in this depot's yard on this snapshot. */
export function VisitorList({ visitors, yardEstablished }: VisitorListProps) {
  return (
    <section
      aria-labelledby="depot-visitors-heading"
      data-testid="depot-visitors"
      className="animate-rise"
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="depot-visitors-heading" className="depot-section-label !mb-0">
          Visitors in the yard
        </h2>
        <ProvenanceBadge provenance="derived" />
      </div>
      {!yardEstablished ? (
        <p className="depot-prose" data-testid="depot-visitors-no-yard">
          Visitors are not listed: no yard is established for this depot, so no bus can be placed in
          it.
        </p>
      ) : visitors.length === 0 ? (
        <EmptyState>
          No bus from another depot is standing in this yard on this snapshot.
        </EmptyState>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={visitors}
          rowKey={(row) => row.registrationNumber}
          caption="Buses of other depots standing in this yard"
        />
      )}
    </section>
  );
}
