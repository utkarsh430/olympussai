'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { rosterBusHref } from '@/lib/depot/depotNav';
import { formatFeedDateTime } from '@/lib/depot/format';
import type { OffRoadBus } from '@/lib/depot/maintenance/api';
import { lastHeardIso, sharedOffRoad } from '@/lib/depot/maintenance/pageModel';
import { offRoadEmptyText, offRoadHeadline, silenceText } from '@/lib/depot/maintenance/text';

const NONE = '—';
const TABLE_CAP = 25;

function buildColumns(
  depotId: string,
  feedNow: string | null,
  showTripStatus: boolean,
  showFlags: boolean,
): readonly Column<OffRoadBus>[] {
  const columns: Column<OffRoadBus>[] = [
    {
      key: 'registration',
      header: 'Registration',
      sortValue: (bus) => bus.registrationNumber,
      render: (bus) => (
        <Link
          href={rosterBusHref(depotId, bus.registrationNumber)}
          className="depot-table-link text-holo-glow underline-offset-2 hover:underline focus-visible:underline"
        >
          {bus.registrationNumber}
        </Link>
      ),
    },
    {
      key: 'heard',
      header: 'Last heard',
      sortValue: (bus) => bus.gpsAgeMin,
      render: (bus) => (
        <span title={formatFeedDateTime(lastHeardIso(feedNow, bus.gpsAgeMin))}>
          {silenceText(bus.gpsAgeMin)}
        </span>
      ),
    },
  ];
  if (showTripStatus) {
    columns.push({
      key: 'trip',
      header: 'Feed trip status',
      sortValue: (bus) => bus.tripStatus,
      render: (bus) => bus.tripStatus ?? NONE,
      title: (bus) => bus.tripStatus ?? 'The feed gives no trip status',
    });
  }
  if (showFlags) {
    columns.push({
      key: 'flags',
      header: 'Device flags',
      render: (bus) => (bus.flags.length === 0 ? NONE : bus.flags.join(', ')),
    });
  }
  return columns;
}

export interface OffRoadListProps {
  readonly depotId: string;
  readonly buses: readonly OffRoadBus[];
  /** The feed's clock, for the full time of each "last heard". */
  readonly feedNow: string | null;
}

/** Every bus the feed reports under maintenance right now, longest silent first. */
export function OffRoadList({ depotId, buses, feedNow }: OffRoadListProps) {
  const shared = useMemo(() => sharedOffRoad(buses), [buses]);
  const columns = useMemo(
    () => buildColumns(depotId, feedNow, shared.showTripStatus, shared.showFlags),
    [depotId, feedNow, shared.showTripStatus, shared.showFlags],
  );
  return (
    <section aria-labelledby="depot-offroad-heading" className="min-w-0 animate-rise">
      <SectionLabel
        id="depot-offroad-heading"
        label="Off the road now"
        count={buses.length}
        note={buses.length === 0 ? undefined : (shared.statement ?? undefined)}
      />
      <p className="sr-only" role="status">
        {offRoadHeadline(buses.length)}
      </p>
      {buses.length === 0 ? (
        <StatePanel kind="empty" sentence={offRoadEmptyText()} />
      ) : (
        <DataTable
          columns={columns}
          rows={buses}
          rowKey={(bus) => bus.registrationNumber}
          caption="Buses off the road now, longest silent first"
          fixedRows
          freezeFirstColumn
          overflowCue
          maxRows={TABLE_CAP}
        />
      )}
    </section>
  );
}
