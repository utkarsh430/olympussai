'use client';

import { useMemo } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { formatNumber } from '@/lib/formatters';
import { BUS_LOCATION_LABEL, BUS_STATE_LABEL } from '@/lib/depot/labels';
import { BUS_STATE_ORDER, type RosterRow } from '@/lib/depot/roster/rosterModel';

export interface RosterTableProps {
  readonly rows: readonly RosterRow[];
  readonly selectedRegistration: string | null;
  readonly onOpen: (registration: string, opener: HTMLElement) => void;
}

const DASH = '—';

function locationText(row: RosterRow): string {
  const { bus } = row;
  const label = BUS_LOCATION_LABEL[bus.location];
  if (bus.location === 'away' && bus.distanceFromYardKm !== null) {
    return `${label}, ${formatNumber(Math.round(bus.distanceFromYardKm))} km from yard`;
  }
  return label;
}

function buildColumns(
  selected: string | null,
  onOpen: RosterTableProps['onOpen'],
): readonly Column<RosterRow>[] {
  return [
    {
      key: 'registration',
      header: 'Registration',
      sortValue: (row) => row.bus.registrationNumber,
      render: (row) => (
        <button
          type="button"
          aria-pressed={row.bus.registrationNumber === selected}
          className="text-left text-holo-glow underline-offset-2 hover:underline"
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
      render: (row) => BUS_STATE_LABEL[row.bus.state],
    },
    {
      key: 'location',
      header: 'Location',
      sortValue: (row) => row.bus.location,
      render: (row) => locationText(row),
    },
    {
      key: 'route',
      header: 'Route',
      sortValue: (row) => row.bus.routeName,
      render: (row) => (
        <span className="block max-w-[16rem] truncate" title={row.bus.routeName ?? undefined}>
          {row.bus.routeName ?? DASH}
        </span>
      ),
    },
    {
      key: 'start',
      header: 'Scheduled start',
      sortValue: (row) => row.bus.scheduledStart,
      render: (row) => (
        <span className="flex flex-col leading-tight">
          <span>{row.bus.scheduledStart ?? DASH}</span>
          {row.delay ? <span className="text-[11px] text-depot-muted">{row.delay}</span> : null}
        </span>
      ),
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
      render: (row) => (row.flags.length === 0 ? DASH : row.flags.join('; ')),
    },
  ];
}

/** The depot's buses. The registration is the real control; the row is not clickable. */
export function RosterTable({ rows, selectedRegistration, onOpen }: RosterTableProps) {
  const columns = useMemo(
    () => buildColumns(selectedRegistration, onOpen),
    [selectedRegistration, onOpen],
  );
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.bus.registrationNumber}
      caption="Buses homed at this depot"
    />
  );
}
