'use client';

import { useState } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { Pager } from '@/components/depot/shell/LongLists';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import type { RosterShiftRow } from '@/lib/depot/crew/api';
import {
  ROSTER_NOTE,
  SLOT_NOTE,
  rosterCountSentence,
  shiftLabel,
} from '@/lib/depot/crew/crewPageModel';
import { formatMinute } from '@/lib/depot/duties/dutyBoardModel';
import { PAGE_ROWS, pageRange } from '@/lib/depot/listPaging';

/** Slot ids are plain identifiers: nothing else about a slot sits beside them. */
const COLUMNS: readonly Column<RosterShiftRow>[] = [
  { key: 'shift', header: 'Shift', render: (row) => shiftLabel(row) },
  { key: 'route', header: 'Route', render: (row) => row.route },
  { key: 'start', header: 'Start', align: 'right', render: (row) => formatMinute(row.startMin) },
  { key: 'end', header: 'End', align: 'right', render: (row) => formatMinute(row.endMin) },
  { key: 'driver', header: 'Driver slot', render: (row) => row.driverSlot },
  { key: 'conductor', header: 'Conductor slot', render: (row) => row.conductorSlot },
];

const rowKey = (row: RosterShiftRow): string => `${row.dutyId}#${row.shiftIndex}`;

export interface RosterSectionProps {
  readonly roster: readonly RosterShiftRow[];
  readonly total: number;
}

/** The suggested roster behind a closed disclosure, a page of 25 at a time. */
export function RosterSection({ roster, total }: RosterSectionProps) {
  const [requested, setRequested] = useState(0);
  const range = pageRange(requested, roster.length, PAGE_ROWS);
  return (
    <section aria-labelledby="depot-crew-roster-heading" className="min-w-0 animate-rise">
      <SectionLabel id="depot-crew-roster-heading" label="Suggested roster" count={total} />
      <details className="group min-w-0">
        <summary className="flex cursor-pointer list-none items-baseline gap-2 py-1 font-sans text-sm text-depot-muted hover:text-depot-ink [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="inline-block w-3 text-depot-faint group-open:rotate-90">
            ›
          </span>
          Show the suggested roster
        </summary>
        <p className="depot-prose my-2">{ROSTER_NOTE}</p>
        <DataTable
          columns={COLUMNS}
          rows={roster.slice(range.start, range.end)}
          rowKey={rowKey}
          caption="Covered shifts and the crew slots suggested for them"
          emptyMessage="No shift is covered on the modelled crew."
          fixedRows
          freezeFirstColumn
          overflowCue
        />
        <p className="depot-prose mt-2">{SLOT_NOTE}</p>
        <p className="depot-prose mt-1">{rosterCountSentence(roster.length, total)}</p>
        <Pager page={range.page} total={roster.length} onPage={setRequested} />
      </details>
    </section>
  );
}
