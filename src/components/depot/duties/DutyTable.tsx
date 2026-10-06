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
 * The same rows as the chart. No sentence sits in a cell: a row's expander opens its
 * full text, with the reason an unmatched duty has no bus, in a full-width row beneath.
 */
function rowDetail(row: BoardRow): React.ReactNode {
  const text = `${row.ariaLabel}${row.reason === null ? '' : ` ${row.reason}`}`;
  return <p data-testid="duty-row-detail">{text}</p>;
}

export function DutyTable({ depotId, rows }: DutyTableProps) {
  const columns = useMemo(() => buildColumns(depotId), [depotId]);
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
        renderExpanded={rowDetail}
        expandLabel={() => 'Show this duty in full'}
      />
    </div>
  );
}
