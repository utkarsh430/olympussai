'use client';

import { useState } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import type { RosterShiftRow } from '@/lib/depot/crew/api';
import {
  ROSTER_NOTE,
  pageOf,
  rosterCountSentence,
  shiftLabel,
} from '@/lib/depot/crew/crewPageModel';
import { formatMinute } from '@/lib/depot/duties/dutyBoardModel';
import { Pager } from './Pager';

/** Slot ids are shown as plain identifiers: no other figure sits beside them. */
const COLUMNS: readonly Column<RosterShiftRow>[] = [
  { key: 'shift', header: 'Shift', render: (row) => shiftLabel(row) },
  { key: 'route', header: 'Route', render: (row) => row.route },
  { key: 'start', header: 'Start', align: 'right', render: (row) => formatMinute(row.startMin) },
  { key: 'end', header: 'End', align: 'right', render: (row) => formatMinute(row.endMin) },
  { key: 'driver', header: 'Driver slot', render: (row) => row.driverSlot },
  { key: 'conductor', header: 'Conductor slot', render: (row) => row.conductorSlot },
];

const PAGE_SIZE = 20;
const rowKey = (row: RosterShiftRow): string => `${row.dutyId}#${row.shiftIndex}`;

export interface RosterSectionProps {
  readonly roster: readonly RosterShiftRow[];
  readonly total: number;
}

/** Covered shifts with the anonymous slot ids suggested for them, a page at a time. */
export function RosterSection({ roster, total }: RosterSectionProps) {
  const [requested, setRequested] = useState(0);
  const { page, pageCount, rows } = pageOf(roster, requested, PAGE_SIZE);
  return (
    <section aria-labelledby="depot-crew-roster-heading" className="min-w-0 animate-rise">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="depot-crew-roster-heading" className="depot-section-label !mb-0">
          Suggested roster
        </h2>
        <ProvenanceBadge provenance="modelled" />
      </div>
      <p className="depot-prose mb-3">{ROSTER_NOTE}</p>
      <DataTable
        columns={COLUMNS}
        rows={rows}
        rowKey={rowKey}
        caption="Covered shifts and the crew slots suggested for them"
        emptyMessage="No shift is covered on the modelled crew."
      />
      <Pager
        page={page}
        pageCount={pageCount}
        summary={rosterCountSentence(roster.length, total)}
        onPage={setRequested}
      />
    </section>
  );
}
