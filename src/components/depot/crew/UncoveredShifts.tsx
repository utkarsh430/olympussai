'use client';

import { useState } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import type { UncoveredShiftRow } from '@/lib/depot/crew/api';
import { pageOf, shiftLabel, shortfallText, uncoveredCountSentence } from '@/lib/depot/crew/crewPageModel';
import { formatMinute } from '@/lib/depot/duties/dutyBoardModel';
import { Pager } from './Pager';

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

const PAGE_SIZE = 20;

/** Shifts with no crew and why, most pressing first (short of both roles, then earliest). */
export function UncoveredShifts({ shifts, total }: UncoveredShiftsProps) {
  const [requested, setRequested] = useState(0);
  const { page, pageCount, rows } = pageOf(shifts, requested, PAGE_SIZE);
  return (
    <section aria-labelledby="depot-crew-uncovered-heading" className="min-w-0 animate-rise">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="depot-crew-uncovered-heading" className="depot-section-label !mb-0">
          Uncovered shifts
        </h2>
        <ProvenanceBadge provenance="modelled" />
      </div>
      <DataTable
        columns={COLUMNS}
        rows={rows}
        rowKey={rowKey}
        caption="Uncovered shifts, most pressing first"
        emptyMessage="Every shift has a driver and a conductor on the modelled crew."
      />
      {total > 0 ? (
        <Pager
          page={page}
          pageCount={pageCount}
          summary={uncoveredCountSentence(shifts.length, total)}
          onPage={setRequested}
        />
      ) : null}
    </section>
  );
}
