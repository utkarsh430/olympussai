'use client';

import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import type { UncoveredShiftRow } from '@/lib/depot/crew/api';
import { reasonText, shiftLabel } from '@/lib/depot/crew/crewPageModel';
import { formatMinute } from '@/lib/depot/duties/dutyBoardModel';

const COLUMNS: readonly Column<UncoveredShiftRow>[] = [
  { key: 'shift', header: 'Shift', render: (row) => shiftLabel(row) },
  { key: 'route', header: 'Route', render: (row) => row.route },
  { key: 'start', header: 'Start', align: 'right', render: (row) => formatMinute(row.startMin) },
  { key: 'end', header: 'End', align: 'right', render: (row) => formatMinute(row.endMin) },
  { key: 'short', header: 'Short', render: (row) => row.shortRoles.join(' and ') },
  { key: 'why', header: 'Why', render: (row) => reasonText(row.shortRoles, row.reason) },
];

const rowKey = (row: UncoveredShiftRow): string => `${row.dutyId}#${row.shiftIndex}`;

export interface UncoveredShiftsProps {
  readonly shifts: readonly UncoveredShiftRow[];
}

/** Shifts with no crew and why, most pressing first (short of both roles, then earliest). */
export function UncoveredShifts({ shifts }: UncoveredShiftsProps) {
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
        rows={shifts}
        rowKey={rowKey}
        caption="Uncovered shifts, most pressing first"
        emptyMessage="Every shift has a driver and a conductor on the modelled crew."
      />
    </section>
  );
}
