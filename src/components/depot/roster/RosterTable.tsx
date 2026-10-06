'use client';

import { useMemo } from 'react';
import { BusStateMark } from '@/components/depot/shell/BusStateMark';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { formatFeedDateTime } from '@/lib/depot/format';
import { busLocationText } from '@/lib/depot/infer/locationText';
import { BUS_STATE_LABEL } from '@/lib/depot/labels';
import {
  BUS_STATE_ORDER,
  notHeardText,
  scheduleText,
  type RosterRow,
} from '@/lib/depot/roster/rosterModel';

export interface RosterTableProps {
  readonly rows: readonly RosterRow[];
  readonly feedNow: string | null;
  readonly selectedRegistration: string | null;
  readonly onOpen: (registration: string, opener: HTMLElement) => void;
}

const DASH = '—';

function stateTitle(row: RosterRow): string {
  const quiet = notHeardText(row.bus);
  return quiet ? `${BUS_STATE_LABEL[row.bus.state]}; ${quiet}` : BUS_STATE_LABEL[row.bus.state];
}

function buildColumns(
  feedNow: string | null,
  selected: string | null,
  onOpen: RosterTableProps['onOpen'],
): readonly Column<RosterRow>[] {
  return [
    {
      key: 'registration',
      header: 'Registration',
      sortValue: (row) => row.bus.registrationNumber,
      title: (row) => row.bus.registrationNumber,
      render: (row) => (
        <button
          type="button"
          aria-pressed={row.bus.registrationNumber === selected}
          className="whitespace-nowrap text-left text-holo-glow underline-offset-2 hover:underline"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(row.bus.registrationNumber, event.currentTarget);
          }}
        >
          {row.bus.registrationNumber}
        </button>
      ),
    },
    {
      key: 'state',
      header: 'State',
      sortValue: (row) => BUS_STATE_ORDER.indexOf(row.bus.state),
      title: stateTitle,
      render: (row) => {
        const quiet = notHeardText(row.bus);
        return (
          <span className="inline-flex min-w-0 items-center gap-2">
            <BusStateMark state={row.bus.state} short />
            {quiet ? <span className="text-[11px] text-depot-faint">{quiet}</span> : null}
          </span>
        );
      },
    },
    {
      key: 'location',
      header: 'Location',
      sortValue: (row) => row.bus.location,
      // The one wording the drawer uses too, so the two can never disagree.
      render: (row) => busLocationText(row.bus),
    },
    {
      key: 'route',
      header: 'Route',
      sortValue: (row) => row.bus.routeName,
      title: (row) => row.bus.routeName ?? 'No route in the feed',
      render: (row) => <span className="block max-w-[16rem] truncate">{row.bus.routeName ?? DASH}</span>,
    },
    {
      key: 'start',
      header: 'Scheduled start',
      sortValue: (row) => row.bus.scheduledStart,
      title: (row) => formatFeedDateTime(row.bus.scheduledStart),
      render: (row) => scheduleText(row.bus.scheduledStart, feedNow),
    },
    {
      key: 'running',
      header: 'Running',
      title: (row) => row.delay ?? 'No delay figure: no schedule for the feed date',
      render: (row) => row.delay ?? DASH,
    },
    {
      key: 'heard',
      header: 'Last heard',
      sortValue: (row) => row.bus.gpsAgeMin,
      render: (row) => row.lastHeard,
    },
    {
      key: 'flags',
      header: 'Flags',
      sortValue: (row) => row.flags.length,
      title: (row) => (row.flags.length === 0 ? 'No device flag raised' : row.flags.join('; ')),
      render: (row) => (row.flags.length === 0 ? DASH : row.flags.join('; ')),
    },
  ];
}

/**
 * The depot's buses: 36px rows that never wrap, the registration frozen, a cue
 * while columns are hidden to the right. The registration is the real control.
 */
export function RosterTable({ rows, feedNow, selectedRegistration, onOpen }: RosterTableProps) {
  const columns = useMemo(
    () => buildColumns(feedNow, selectedRegistration, onOpen),
    [feedNow, selectedRegistration, onOpen],
  );
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.bus.registrationNumber}
      caption="Buses homed at this depot"
      fixedRows
      freezeFirstColumn
      overflowCue
    />
  );
}
