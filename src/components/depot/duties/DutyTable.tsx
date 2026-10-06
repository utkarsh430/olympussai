'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { Pager } from '@/components/depot/shell/LongLists';
import { PAGE_ROWS, pageRange } from '@/lib/depot/listPaging';
import { rosterBusHref } from '@/lib/depot/depotNav';
import { formatMinute, type BoardRow } from '@/lib/depot/duties/dutyBoardModel';
import { DutyDetail } from './DutyDetail';

export interface DutyTableProps {
  readonly depotId: string;
  readonly rows: readonly BoardRow[];
}

const DASH = '—';

/**
 * State and Bus are the matching, a model beside a real registration on a MIXED page,
 * so their headers carry the MODELLED tag (ruling S51). Bus now is the bus's live state.
 * The class cell names the bus's class only where it differs ("Ordinary · Express bus").
 */
function buildColumns(depotId: string): readonly Column<BoardRow>[] {
  return [
    { key: 'route', header: 'Route', render: (r) => r.routeName },
    {
      key: 'class',
      header: 'Class',
      render: (r) => (r.busClassWord === null ? r.classWord : `${r.classWord} · ${r.busClassWord} bus`),
    },
    {
      key: 'start',
      header: 'Start',
      render: (r) => formatMinute(r.startMin),
    },
    { key: 'end', header: 'End', render: (r) => formatMinute(r.endMin) },
    {
      key: 'state',
      header: 'State',
      tag: 'modelled',
      render: (r) => r.stateWord,
    },
    {
      key: 'bus',
      header: 'Bus',
      tag: 'modelled',
      title: (r) => (r.registrationNumber === null ? 'No bus is matched to this duty' : undefined),
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
      key: 'now',
      header: 'Bus now',
      title: (r) => (r.standingWord === null ? 'No bus is matched to this duty' : undefined),
      render: (r) => r.standingWord ?? DASH,
    },
  ];
}

const rowDetail = (row: BoardRow): React.ReactNode => <DutyDetail row={row} />;

/**
 * The same rows as the chart, in its order (by start), 25 to a page with the shared
 * pager; not sortable, since a sort within one page would misstate the order. A row's
 * expander opens the duty in full beneath it.
 */
export function DutyTable({ depotId, rows }: DutyTableProps) {
  const columns = useMemo(() => buildColumns(depotId), [depotId]);
  const [requested, setRequested] = useState(0);
  const range = pageRange(requested, rows.length, PAGE_ROWS);
  return (
    <div className="min-w-0">
      <DataTable
        columns={columns}
        rows={rows.slice(range.start, range.end)}
        rowKey={(r) => r.id}
        caption="Modelled duties and the buses matched to them"
        fixedRows
        freezeFirstColumn
        overflowCue
        renderExpanded={rowDetail}
        expandLabel={() => 'Show this duty in full'}
      />
      {rows.length > PAGE_ROWS ? (
        <Pager page={range.page} total={rows.length} onPage={setRequested} />
      ) : null}
    </div>
  );
}
