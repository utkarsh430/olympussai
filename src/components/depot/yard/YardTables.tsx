'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { BusStateMark } from '@/components/depot/shell/BusStateMark';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { ShowAllButton } from '@/components/depot/shell/LongLists';
import { rosterBusHref } from '@/lib/depot/depotNav';
import type { BusOpState } from '@/lib/depot/types';
import type { AwayRow, RollRow } from '@/lib/depot/yard/yardRollModel';

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
    <Link href={rosterBusHref(depotId, registration)} className="depot-link font-mono text-[13px]">
      {registration}
    </Link>
  );
}

const DASH = '—';

function registrationColumn<T extends { readonly registration: string }>(
  depotId: string,
): Column<T> {
  return {
    key: 'registration',
    header: 'Registration',
    width: '10rem',
    render: (r) => <BusLink depotId={depotId} registration={r.registration} />,
    title: (r) => r.registration,
    sortValue: (r) => r.registration,
  };
}

function stateColumn<T extends { readonly state: BusOpState }>(): Column<T> {
  return {
    key: 'state',
    header: 'State',
    width: '8rem',
    render: (r) => <BusStateMark state={r.state} short />,
    sortValue: (r) => r.state,
  };
}

const NOT_HEARD: Column<RollRow> = {
  key: 'notHeard',
  header: 'Not heard',
  align: 'right',
  width: '8rem',
  render: (r) => r.notHeard,
  sortValue: (r) => r.notHeardMin,
};

const REASON: Column<RollRow> = {
  key: 'reason',
  header: 'Reason',
  render: (r) => r.reason || DASH,
  title: (r) => r.reason || 'Listed for its state alone',
};

/** A state group's rows: the group names the state, so the rows do not repeat it. */
export function rollColumns(depotId: string, showReason: boolean): readonly Column<RollRow>[] {
  const base = [registrationColumn<RollRow>(depotId), NOT_HEARD];
  return showReason ? [...base, REASON] : base;
}

/** Buses with no known location: there is no group, so the state is a column. */
export function unknownColumns(depotId: string): readonly Column<RollRow>[] {
  return [registrationColumn<RollRow>(depotId), stateColumn<RollRow>(), NOT_HEARD];
}

/** Away buses; the other-depot column only when some bus stands in another yard. */
export function awayColumns(depotId: string, showAtYard: boolean): readonly Column<AwayRow>[] {
  const base: Column<AwayRow>[] = [
    registrationColumn<AwayRow>(depotId),
    stateColumn<AwayRow>(),
    { key: 'km', header: 'From yard', unit: 'km', align: 'right', width: '7rem', render: (r) => r.km },
    { key: 'notHeard', header: 'Not heard', align: 'right', width: '8rem', render: (r) => r.notHeard },
  ];
  const atYard: Column<AwayRow> = {
    key: 'atYard',
    header: 'In the yard of',
    render: (r) => r.atYard || DASH,
    title: (r) => r.atYard || 'Not in another depot’s yard',
  };
  return showAtYard ? [...base, atYard] : base;
}

export interface CappedTableProps<T> {
  readonly columns: readonly Column<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly caption: string;
  readonly cap: number;
}

/** A yard table at most 760px wide: the first `cap` rows, then the shared "Show all N". */
export function CappedTable<T>({ columns, rows, rowKey, caption, cap }: CappedTableProps<T>) {
  const [all, setAll] = useState(false);
  const id = useId();
  return (
    <div className={`min-w-0 ${YARD_TABLE_MAX_W}`}>
      <DataTable
        id={id}
        columns={columns}
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
