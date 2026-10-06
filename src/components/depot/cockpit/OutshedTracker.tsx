'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/depot/shell/DataStates';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import type { TrackerRow } from '@/lib/depot/cockpit/cockpitModel';
import { rosterBusHref } from '@/lib/depot/depotNav';
import { formatFeedTime } from '@/lib/depot/format';
import type { OutshedState } from '@/lib/depot/infer/types';
import type { Coverage } from '@/lib/depot/types';

export interface OutshedTrackerProps {
  readonly depotId: string;
  /** Already in display order: overdue, due, upcoming, unknown, departed, ended. */
  readonly rows: readonly TrackerRow[];
  readonly coverage: Coverage;
  readonly coverageSentence: string;
  /** False when no bus carries a schedule for the feed date. */
  readonly hasSchedules: boolean;
  readonly noSchedulesSentence: string;
}

/** The word carries the state; the colour only reinforces the two that need action. */
const STATE_TONE: Readonly<Record<OutshedState, string>> = {
  overdue: 'text-alert-crimson',
  due: 'text-alert-amber',
  upcoming: 'text-depot-ink',
  unknown: 'text-depot-muted',
  departed: 'text-depot-muted',
  ended: 'text-depot-faint',
};

function trackerColumns(depotId: string): readonly Column<TrackerRow>[] {
  return [
    {
      key: 'scheduled',
      header: 'Scheduled',
      sortValue: (row) => row.scheduledStart,
      render: (row) => formatFeedTime(row.scheduledStart),
    },
    {
      key: 'bus',
      header: 'Bus',
      sortValue: (row) => row.registrationNumber,
      render: (row) => (
        <Link
          href={rosterBusHref(depotId, row.registrationNumber)}
          className="depot-link whitespace-nowrap"
        >
          {row.registrationNumber}
        </Link>
      ),
    },
    {
      key: 'route',
      header: 'Route',
      render: (row) => (
        <span className="whitespace-nowrap">
          {row.routeName ?? '—'}
          {row.journeyCode ? (
            <span className="ml-2 text-depot-muted">{row.journeyCode}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'state',
      header: 'State',
      render: (row) => (
        <span className={`whitespace-nowrap ${STATE_TONE[row.state]}`}>{row.label}</span>
      ),
    },
    {
      key: 'minutes',
      header: 'Minutes',
      align: 'right',
      // Not sortable: the minutes mean different things in different states.
      render: (row) => <span className="whitespace-nowrap">{row.minutesText}</span>,
    },
  ];
}

/**
 * Today's departures against the feed clock, most urgent first. The coverage line
 * is always shown because a short list can mean few schedules in the feed rather
 * than few departures.
 */
export function OutshedTracker({
  depotId,
  rows,
  coverage,
  coverageSentence,
  hasSchedules,
  noSchedulesSentence,
}: OutshedTrackerProps) {
  const columns = useMemo(() => trackerColumns(depotId), [depotId]);

  return (
    <section
      aria-labelledby="depot-outshed-heading"
      data-testid="depot-outshed-tracker"
      className="animate-rise"
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="depot-outshed-heading" className="depot-section-label !mb-0">
          Outshedding
        </h2>
        <ProvenanceBadge provenance="derived" coverage={coverage} />
        <p className="font-sans text-xs text-depot-muted" data-testid="depot-outshed-coverage">
          {coverageSentence}
        </p>
      </div>
      {!hasSchedules ? (
        <EmptyState>{noSchedulesSentence}</EmptyState>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.key}
          caption="Today's scheduled departures, most urgent first"
        />
      )}
    </section>
  );
}
