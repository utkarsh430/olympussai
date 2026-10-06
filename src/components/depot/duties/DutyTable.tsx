'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { Pager } from '@/components/depot/shell/LongLists';
import { PAGE_ROWS, pageRange } from '@/lib/depot/listPaging';
import { rosterBusHref } from '@/lib/depot/depotNav';
import { formatMinute, type BoardRow } from '@/lib/depot/duties/dutyBoardModel';
import {
  DUTY_COLUMN_WIDTH_PX,
  dutyColumnKeys,
  dutyTableTier,
  type DutyColumnKey,
} from '@/lib/depot/duties/dutyTableLayout';
import { useBelowDesktop } from '@/components/depot/shell/useBelowDesktop';
import { DutyDetail } from './DutyDetail';
import { useTableFirst } from './useTableFirst';

export interface DutyTableProps {
  readonly depotId: string;
  readonly rows: readonly BoardRow[];
}

const DASH = '—';
/** Cyan, underlined on hover and focus (the shared `depot-table-link`, spelled out until the shell has it). */
const TABLE_LINK =
  'depot-table-link text-holo-glow underline-offset-2 hover:underline focus-visible:underline';

/**
 * The section label's MODELLED tag covers the board (ruling S51), so no header repeats
 * it; Bus now, how the bus stands in the live feed, is the one column that is not
 * modelled, and its header says so (DERIVED, review R2-m2).
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
    { key: 'state', header: 'State', render: (r) => r.stateWord },
    {
      key: 'bus',
      header: 'Bus',
      title: (r) => (r.registrationNumber === null ? 'No bus is matched to this duty' : undefined),
      render: (r) =>
        r.registrationNumber === null ? (
          DASH
        ) : (
          <Link href={rosterBusHref(depotId, r.registrationNumber)} className={TABLE_LINK}>
            {r.registrationNumber}
          </Link>
        ),
    },
    {
      key: 'now',
      header: 'Bus now',
      tag: 'derived',
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
  const tier = dutyTableTier(useBelowDesktop(), useTableFirst());
  const columns = useMemo(() => {
    const keys = new Set<string>(dutyColumnKeys(tier));
    return buildColumns(depotId)
      .filter((column) => keys.has(column.key))
      .map((column) => ({ ...column, width: DUTY_COLUMN_WIDTH_PX[column.key as DutyColumnKey] }));
  }, [depotId, tier]);
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
