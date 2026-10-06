'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import type { TrackerRow } from '@/lib/depot/cockpit/cockpitModel';
import { rosterBusHref } from '@/lib/depot/depotNav';
import { formatCount, formatFeedTime } from '@/lib/depot/format';
import { GROUP_PREVIEW_ROWS, visibleRows } from '@/lib/depot/listPaging';
import type { OutshedState } from '@/lib/depot/infer/types';

export interface OutshedTrackerProps {
  readonly depotId: string;
  /** Already in display order: overdue, due, upcoming, unknown, departed, ended. */
  readonly rows: readonly TrackerRow[];
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
 * Scheduled departures for the feed date against the feed clock, most urgent first. The coverage line
 * is always shown because a short list can mean few schedules in the feed rather
 * than few departures.
 */
export function OutshedTracker({
  depotId,
  rows,
  coverageSentence,
  hasSchedules,
  noSchedulesSentence,
}: OutshedTrackerProps) {
  const columns = useMemo(() => trackerColumns(depotId), [depotId]);
  const [expanded, setExpanded] = useState(false);
  const tableId = useId();
  const shown = visibleRows(rows, expanded, GROUP_PREVIEW_ROWS);

  return (
    <section aria-labelledby="depot-outshed" data-testid="depot-outshed-tracker" className="min-w-0">
      <SectionLabel id="depot-outshed" label="Outshedding" count={rows.length} note="Most urgent first" />
      <p className="mb-2 font-sans text-xs text-depot-muted" data-testid="depot-outshed-coverage">
        {coverageSentence}
      </p>
      {!hasSchedules ? (
        <StatePanel kind="no-data" sentence={noSchedulesSentence} />
      ) : (
        <div id={tableId} className="min-w-0">
          <DataTable
            columns={columns}
            rows={shown}
            rowKey={(row) => row.key}
            caption="Scheduled departures for the feed date, most urgent first"
            fixedRows
          />
          {rows.length > GROUP_PREVIEW_ROWS ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={tableId}
              onClick={() => setExpanded((open) => !open)}
              className="depot-filter-button mt-2"
            >
              {expanded ? 'Show fewer' : `Show all ${formatCount(rows.length)} departures`}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
