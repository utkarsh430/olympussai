'use client';

import { useState } from 'react';
import { DisclosureChevron } from '@/components/depot/shell/DisclosureChevron';
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

const BODY_ID = 'depot-crew-roster-body';

/** "SHOW ›" in the section label's controls slot (as the duty board's toggle). */
function RosterToggle({ open, onToggle }: { readonly open: boolean; readonly onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={BODY_ID}
      aria-label={open ? 'Hide the suggested roster' : 'Show the suggested roster'}
      onClick={onToggle}
      className="depot-show-all"
    >
      {open ? 'Hide' : 'Show'}
      <DisclosureChevron open={open} />
    </button>
  );
}

/**
 * The suggested roster, closed until "SHOW ›" in its label opens it, a page of 25 at a
 * time. Generated shifts and slots beside real routes, so the label carries the
 * MODELLED tag (ruling S51, review R2-I3): a cropped table still says what it is.
 */
export function RosterSection({ roster, total }: RosterSectionProps) {
  const [requested, setRequested] = useState(0);
  const [open, setOpen] = useState(false);
  const range = pageRange(requested, roster.length, PAGE_ROWS);
  return (
    <section aria-labelledby="depot-crew-roster-heading" className="min-w-0 animate-rise">
      <SectionLabel
        id="depot-crew-roster-heading"
        label="Suggested roster"
        count={total}
        tag="modelled"
        controls={<RosterToggle open={open} onToggle={() => setOpen((was) => !was)} />}
      />
      {/* Mounted while closed (plain block, no display class), so `hidden` holds. */}
      <div id={BODY_ID} data-testid="crew-roster-body" hidden={!open}>
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
      </div>
    </section>
  );
}
