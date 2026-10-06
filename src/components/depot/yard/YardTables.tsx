'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { BusStateMark } from '@/components/depot/shell/BusStateMark';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { ShowAllButton } from '@/components/depot/shell/LongLists';
import { rosterBusHref } from '@/lib/depot/depotNav';
import type { BusOpState } from '@/lib/depot/types';
import type { AwayRow, RollRow } from '@/lib/depot/yard/yardRollModel';
import {
  YARD_COLUMN_PX,
  awayColumnKeys,
  rollColumnKeys,
  unknownColumnKeys,
  type YardColumnKey,
  type YardTier,
} from '@/lib/depot/yard/yardTableLayout';

/** Every yard table is at most this wide, so short rows never stretch across 1,160px. */
export const YARD_TABLE_MAX_W = 'max-w-[760px]';

export function BusLink({
  depotId,
  registration,
}: {
  readonly depotId: string;
  readonly registration: string;
}) {
  return (
    <Link
      href={rosterBusHref(depotId, registration)}
      className="depot-table-link font-mono text-[13px]"
    >
      {registration}
    </Link>
  );
}

const DASH = '—';

type Keyed<T> = Column<T> & { readonly key: YardColumnKey };

/** The columns named by the layout module, in its order, at its widths for the tier. */
function pick<T>(all: readonly Keyed<T>[], keys: readonly YardColumnKey[], tier: YardTier) {
  return keys.flatMap((key) =>
    all
      .filter((column) => column.key === key)
      .map((column): Column<T> => ({ ...column, width: YARD_COLUMN_PX[tier][key] || undefined })),
  );
}

function registrationColumn<T extends { readonly registration: string }>(
  depotId: string,
  title?: (row: T) => string,
): Keyed<T> {
  return {
    key: 'registration',
    header: 'Registration',
    render: (r) => <BusLink depotId={depotId} registration={r.registration} />,
    title: title ?? ((r) => r.registration),
    sortValue: (r) => r.registration,
  };
}

function stateColumn<T extends { readonly state: BusOpState }>(): Keyed<T> {
  return {
    key: 'state',
    header: 'State',
    render: (r) => <BusStateMark state={r.state} short />,
    sortValue: (r) => r.state,
  };
}

const NOT_HEARD: Keyed<RollRow> = {
  key: 'notHeard',
  header: 'Not heard',
  align: 'right',
  render: (r) => r.notHeard,
  sortValue: (r) => r.notHeardMin,
};

const REASON: Keyed<RollRow> = {
  key: 'reason',
  header: 'Reason',
  render: (r) => r.reason || DASH,
  title: (r) => r.reason || 'Listed for its state alone',
};

/**
 * A state group's rows: the group names the state, so the rows do not repeat it. On a
 * phone REASON is dropped; a reason that differs by row then stays in the row's title.
 */
export function rollColumns(
  depotId: string,
  showReason: boolean,
  tier: YardTier = 'wide',
): readonly Column<RollRow>[] {
  const keys = rollColumnKeys(tier, showReason);
  const title = keys.includes('reason')
    ? undefined
    : (r: RollRow) => (r.reason ? `${r.registration}; ${r.reason}` : r.registration);
  return pick([registrationColumn<RollRow>(depotId, title), NOT_HEARD, REASON], keys, tier);
}

/** Buses with no known location: there is no group, so the state is a column. */
export function unknownColumns(
  depotId: string,
  tier: YardTier = 'wide',
): readonly Column<RollRow>[] {
  return pick(
    [registrationColumn<RollRow>(depotId), stateColumn<RollRow>(), NOT_HEARD],
    unknownColumnKeys(),
    tier,
  );
}

/** Away buses; the other-depot column only when a row shown stands in another yard. */
export function awayColumns(
  depotId: string,
  showAtYard: boolean,
  tier: YardTier = 'wide',
): readonly Column<AwayRow>[] {
  const all: readonly Keyed<AwayRow>[] = [
    registrationColumn<AwayRow>(depotId),
    stateColumn<AwayRow>(),
    { key: 'km', header: 'From yard', unit: 'km', align: 'right', render: (r) => r.km },
    { key: 'notHeard', header: 'Not heard', align: 'right', render: (r) => r.notHeard },
    {
      key: 'atYard',
      header: 'In the yard of',
      render: (r) => r.atYard || DASH,
      title: (r) => r.atYard || 'Not in another depot’s yard',
    },
  ];
  return pick(all, awayColumnKeys(tier, showAtYard), tier);
}

export interface CappedTableProps<T> {
  /** The columns, or a function of the rows on screen (re-decided when "Show all" opens). */
  readonly columns: readonly Column<T>[] | ((visible: readonly T[]) => readonly Column<T>[]);
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly caption: string;
  readonly cap: number;
}

/** A yard table at most 760px wide: the first `cap` rows, then the shared "Show all N". */
export function CappedTable<T>({ columns, rows, rowKey, caption, cap }: CappedTableProps<T>) {
  const [all, setAll] = useState(false);
  const id = useId();
  const shown = typeof columns === 'function' ? columns(all ? rows : rows.slice(0, cap)) : columns;
  return (
    <div className={`min-w-0 ${YARD_TABLE_MAX_W}`}>
      <DataTable
        id={id}
        columns={shown}
        rows={rows}
        rowKey={rowKey}
        caption={caption}
        fixedRows
        maxRows={all ? undefined : cap}
      />
      {rows.length > cap ? (
        <div className="mt-2">
          <ShowAllButton
            total={rows.length}
            expanded={all}
            onToggle={() => setAll((open) => !open)}
            controls={id}
          />
        </div>
      ) : null}
    </div>
  );
}
