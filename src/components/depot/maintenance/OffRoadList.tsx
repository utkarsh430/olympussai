'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { EmptyState } from '@/components/depot/shell/DataStates';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { rosterBusHref } from '@/lib/depot/depotNav';
import type { OffRoadBus } from '@/lib/depot/maintenance/api';
import {
  offRoadEmptyText,
  offRoadHeadline,
  silenceText,
  statusWordLabel,
} from '@/lib/depot/maintenance/text';

const NO_FLAGS = 'none';

function buildColumns(depotId: string): readonly Column<OffRoadBus>[] {
  return [
    {
      key: 'registration',
      header: 'Registration',
      sortValue: (bus) => bus.registrationNumber,
      render: (bus) => (
        <Link
          href={rosterBusHref(depotId, bus.registrationNumber)}
          className="text-holo-glow underline-offset-2 hover:underline"
        >
          {bus.registrationNumber}
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Feed status',
      sortValue: (bus) => statusWordLabel(bus.vehicleStatus),
      render: (bus) => statusWordLabel(bus.vehicleStatus),
    },
    {
      key: 'trip',
      header: 'Feed trip status',
      sortValue: (bus) => bus.tripStatus,
      render: (bus) => bus.tripStatus ?? 'unknown',
    },
    {
      key: 'heard',
      header: 'Last heard',
      sortValue: (bus) => bus.gpsAgeMin,
      render: (bus) => silenceText(bus.gpsAgeMin),
    },
    {
      key: 'flags',
      header: 'Device flags',
      render: (bus) => (bus.flags.length === 0 ? NO_FLAGS : bus.flags.join(', ')),
    },
  ];
}

export interface OffRoadListProps {
  readonly depotId: string;
  readonly buses: readonly OffRoadBus[];
}

/** The page's one hero: every bus the feed reports under maintenance right now. */
export function OffRoadList({ depotId, buses }: OffRoadListProps) {
  const columns = useMemo(() => buildColumns(depotId), [depotId]);
  return (
    <section aria-labelledby="depot-offroad-heading" className="animate-rise">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="depot-offroad-heading" className="depot-section-label !mb-0">
          Off the road now
        </h2>
        <ProvenanceBadge provenance="live" />
      </div>
      {buses.length === 0 ? (
        <EmptyState>{offRoadEmptyText()}</EmptyState>
      ) : (
        <>
          <p
            aria-hidden
            className="mb-1 font-display text-[32px] font-semibold leading-none tabular-nums text-depot-ink"
          >
            {buses.length}
          </p>
          <p className="depot-prose mb-3" role="status">
            {offRoadHeadline(buses.length)}
          </p>
          <DataTable
            columns={columns}
            rows={buses}
            rowKey={(bus) => bus.registrationNumber}
            caption="Buses off the road now, with the feed's status words"
          />
        </>
      )}
    </section>
  );
}
