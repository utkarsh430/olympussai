'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
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
    { key: 'route', header: 'Route', sortValue: (r) => r.routeName, render: (r) => r.routeName },
    {
      key: 'class',
      header: 'Class',
      sortValue: (r) => r.serviceClass,
      render: (r) => r.serviceClass,
    },
    {
      key: 'start',
      header: 'Start',
      sortValue: (r) => r.startMin,
      render: (r) => formatMinute(r.startMin),
    },
    {
      key: 'end',
      header: 'End',
      sortValue: (r) => r.endMin,
      render: (r) => formatMinute(r.endMin),
    },
    { key: 'state', header: 'State', sortValue: (r) => r.stateWord, render: (r) => r.stateWord },
    {
      key: 'bus',
      header: 'Bus',
      sortValue: (r) => r.registrationNumber,
      title: (r) =>
        r.registrationNumber === null ? 'No bus is proposed for this duty' : undefined,
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
  ];
}

/**
 * The same rows as the chart. No sentence sits in a cell: selecting a row opens its
 * full text, with the reason an unmatched duty has no bus, in the line under the table
 * (the shared table has no row expander, so selection stands in for one).
 */
export function DutyTable({ depotId, rows }: DutyTableProps) {
  const columns = useMemo(() => buildColumns(depotId), [depotId]);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const row = rows.find((r) => r.id === selected);
  return (
    <div className="min-w-0">
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption="Modelled duties and the buses proposed for them"
        initialSort={{ key: 'start', direction: 'asc' }}
        fixedRows
        freezeFirstColumn
        overflowCue
        onRowSelect={(r) => setSelected((current) => (current === r.id ? undefined : r.id))}
        selectedKey={selected}
      />
      <p
        role="status"
        data-testid="duty-row-detail"
        className="mt-2 min-h-5 text-[13px] text-depot-muted"
      >
        {row
          ? `${row.ariaLabel}${row.reason === null ? '' : ` ${row.reason}`}`
          : 'Select a duty to read why it has no bus.'}
      </p>
    </div>
  );
}
