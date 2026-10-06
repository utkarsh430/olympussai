'use client';

import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { describeBusException } from '@/lib/depot/exceptions/describe';
import { busGroupLabel } from '@/lib/depot/exceptions/pageScope';
import { busColumnPlan } from '@/lib/depot/exceptions/pageModel';
import type { BusException, BusExceptionKind } from '@/lib/depot/exceptions/types';
import { useMemo } from 'react';
import { formatFeedDateTime, formatFeedTimeOn } from '@/lib/depot/format';

const REGISTRATION: Column<BusException> = {
  key: 'registration',
  header: 'Registration',
  render: (row) => row.registrationNumber,
  // The one sentence about the bus lives here, not in a cell.
  title: (row) => describeBusException(row),
};
const DEPOT: Column<BusException> = {
  key: 'depot',
  header: 'Depot',
  render: (row) => row.depotName ?? '—',
  title: (row) => row.depotName ?? 'No home depot in the feed',
};
const CODE: Column<BusException> = {
  key: 'code',
  header: 'Tamper code',
  render: (row) => row.detail ?? '—',
  title: (row) => (row.detail === null ? 'Only a tamper code row has one' : `Raw code "${row.detail}"`),
};
/** A bus last heard on an earlier day than the feed's shows that day with its time. */
function lastSeenColumn(feedNow: string | null): Column<BusException> {
  return {
    key: 'lastSeen',
    header: 'Last seen',
    align: 'right',
    render: (row) => formatFeedTimeOn(row.lastSeen, feedNow),
    title: (row) => formatFeedDateTime(row.lastSeen),
  };
}

export interface BusExceptionTableProps {
  /** Rows after the user's filters. */
  readonly rows: readonly BusException[];
  /** The kind filter in force (the plan's tamper-code column follows the rows). */
  readonly kind?: BusExceptionKind | null;
  /** Each kind's total in the page's scope, for its group row; the page count when unknown. */
  readonly kindTotals?: Readonly<Partial<Record<BusExceptionKind, number | null>>>;
  readonly emptyMessage?: string;
  /** The feed's clock, which decides whether a last-seen time needs its day. */
  readonly feedNow: string | null;
}

/**
 * One server page of buses that need attention, in the server's order (worst
 * first). Not sortable here: sorting one page would misstate the order of the whole list.
 */
export function BusExceptionTable({
  rows,
  kind = null,
  emptyMessage = 'No bus exceptions on this page.',
  kindTotals = {},
  feedNow,
}: BusExceptionTableProps) {
  const plan = busColumnPlan(kind, rows);
  const lastSeen = useMemo(() => lastSeenColumn(feedNow), [feedNow]);
  // Kind and severity are said once per group row, not on every row (critique MUST 3).
  const columns = [REGISTRATION, DEPOT, ...(plan.showCode ? [CODE] : []), lastSeen];
  const severityOf = new Map(rows.map((row) => [row.kind, row.severity]));
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      caption="Buses that need attention"
      emptyMessage={emptyMessage}
      fixedRows
      freezeFirstColumn
      overflowCue
      group={{
        key: (row) => row.kind,
        label: (key, count) => {
          const busKind = key as BusExceptionKind;
          return busGroupLabel(busKind, kindTotals[busKind] ?? count, severityOf.get(busKind) ?? 'info');
        },
      }}
    />
  );
}
