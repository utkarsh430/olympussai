'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { ShowAllButton } from '@/components/depot/shell/LongLists';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import type { TrackerRow } from '@/lib/depot/cockpit/cockpitModel';
import { endedSummary } from '@/lib/depot/cockpit/outshedTracker';
import { rosterBusHref } from '@/lib/depot/depotNav';
import { formatFeedTime } from '@/lib/depot/format';
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


/** Five short columns read best together: the table is capped instead of spread across 1,160 px. */
const TABLE_MAX_W = 'max-w-[760px]';

/**
 * Scheduled departures for the feed date against the feed clock, most urgent first. The
 * section leads with its status (the table, or the one line when every window has
 * ended, with the table behind "Show all"); the coverage sentence is the label's note
 * whenever schedules exist, because a short list can mean few schedules in the feed
 * rather than few departures. With none, the label's "· 0" and one muted line.
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
  const ended = endedSummary(rows);
  const limit = ended === null ? GROUP_PREVIEW_ROWS : 0;
  const shown = visibleRows(rows, expanded, limit);

  return (
    <section aria-labelledby="depot-outshed" data-testid="depot-outshed-tracker" className="min-w-0">
      <SectionLabel
        id="depot-outshed"
        label="Outshedding"
        count={rows.length}
        note={hasSchedules ? coverageSentence : undefined}
      />
      {!hasSchedules ? (
        <StatePanel kind="no-data" compact sentence={noSchedulesSentence} />
      ) : (
        <>
          {ended !== null ? (
            <p className="depot-prose mb-2" data-testid="depot-outshed-ended">
              {ended}
            </p>
          ) : null}
          <div id={tableId} className={`min-w-0 ${TABLE_MAX_W}`}>
            {shown.length > 0 ? (
              <DataTable
                columns={columns}
                rows={shown}
                rowKey={(row) => row.key}
                caption="Scheduled departures for the feed date, most urgent first"
                fixedRows
              />
            ) : null}
          </div>
          {rows.length > limit ? (
            <div className="mt-2">
              <ShowAllButton
                total={rows.length}
                expanded={expanded}
                onToggle={() => setExpanded((open) => !open)}
                controls={tableId}
              />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
