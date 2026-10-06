'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { rosterBusHref } from '@/lib/depot/depotNav';
import { formatMinute, type BoardRow } from '@/lib/depot/duties/dutyBoardModel';

export interface DutyTableProps {
  readonly depotId: string;
  readonly rows: readonly BoardRow[];
}

const DASH = '—';

function buildColumns(depotId: string): readonly Column<BoardRow>[] {
  return [
    {
      key: 'route',
      header: 'Route (MODELLED)',
      sortValue: (r) => r.routeName,
      render: (r) => r.routeName,
    },
    {
      key: 'class',
      header: 'Class (MODELLED)',
      sortValue: (r) => r.serviceClass,
      render: (r) => r.serviceClass,
    },
    {
      key: 'start',
      header: 'Start (MODELLED)',
      sortValue: (r) => r.startMin,
      render: (r) => formatMinute(r.startMin),
    },
    {
      key: 'end',
      header: 'End (MODELLED)',
      sortValue: (r) => r.endMin,
      render: (r) => formatMinute(r.endMin),
    },
    { key: 'state', header: 'State', sortValue: (r) => r.stateWord, render: (r) => r.stateWord },
    {
      key: 'bus',
      header: 'Bus',
      sortValue: (r) => r.registrationNumber,
      render: (r) =>
        r.registrationNumber === null ? (
          DASH
        ) : (
          <Link
            href={rosterBusHref(depotId, r.registrationNumber)}
            className="text-holo-glow underline-offset-2 hover:underline"
          >
            {r.registrationNumber}
          </Link>
        ),
    },
    {
      key: 'why',
      header: 'Why no bus',
      render: (r) =>
        r.reason === null ? DASH : <span className="font-sans text-[13px]">{r.reason}</span>,
    },
  ];
}

/** The same rows as the chart, for keyboard and screen-reader users. */
export function DutyTable({ depotId, rows }: DutyTableProps) {
  const columns = useMemo(() => buildColumns(depotId), [depotId]);
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      caption="Modelled duties and the buses proposed for them"
      initialSort={{ key: 'start', direction: 'asc' }}
    />
  );
}
