'use client';

import { useState } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { Pager } from '@/components/depot/shell/LongLists';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import type { UncoveredShiftRow } from '@/lib/depot/crew/api';
import {
  NO_UNCOVERED_SENTENCE,
  shiftLabel,
  shortfallText,
  uncoveredCountSentence,
} from '@/lib/depot/crew/crewPageModel';
import { formatMinute } from '@/lib/depot/duties/dutyBoardModel';
import { PAGE_ROWS, pageRange } from '@/lib/depot/listPaging';

/** Per-role reasons are the one text column; no slot id is needed here. */
const COLUMNS: readonly Column<UncoveredShiftRow>[] = [
  { key: 'shift', header: 'Shift', render: (row) => shiftLabel(row) },
  { key: 'route', header: 'Route', render: (row) => row.route },
  { key: 'start', header: 'Start', align: 'right', render: (row) => formatMinute(row.startMin) },
  { key: 'end', header: 'End', align: 'right', render: (row) => formatMinute(row.endMin) },
  { key: 'short', header: 'Short', render: (row) => row.shortRoles.join(' and ') },
  { key: 'why', header: 'Why', render: (row) => shortfallText(row.shortfalls) },
];

const rowKey = (row: UncoveredShiftRow): string => `${row.dutyId}#${row.shiftIndex}`;

export interface UncoveredShiftsProps {
  readonly shifts: readonly UncoveredShiftRow[];
  /** The true count; `shifts` may be a capped list. */
  readonly total: number;
}

/**
 * One green status line when every shift has its crew; otherwise the shifts with no
 * crew and the per-role reason, most pressing first, a page of 25 at a time.
 */
export function UncoveredShifts({ shifts, total }: UncoveredShiftsProps) {
  const [requested, setRequested] = useState(0);
  const range = pageRange(requested, shifts.length, PAGE_ROWS);
  return (
    <section aria-labelledby="depot-crew-uncovered-heading" className="min-w-0 animate-rise">
      <SectionLabel id="depot-crew-uncovered-heading" label="Uncovered shifts" count={total} />
      {total === 0 ? (
        <p className="flex items-center gap-2 font-sans text-[14px] text-depot-ink" role="status">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 bg-alert-green" />
          {NO_UNCOVERED_SENTENCE}
        </p>
      ) : (
        <>
          <p className="depot-prose mb-2">{uncoveredCountSentence(shifts.length, total)}</p>
          <DataTable
            columns={COLUMNS}
            rows={shifts.slice(range.start, range.end)}
            rowKey={rowKey}
            caption="Uncovered shifts, most pressing first"
            fixedRows
            freezeFirstColumn
            overflowCue
          />
          <Pager page={range.page} total={shifts.length} onPage={setRequested} />
        </>
      )}
    </section>
  );
}
