'use client';

import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { SeverityMark } from '@/components/depot/shell/SeverityMark';
import { EXCEPTION_KIND_LABEL, describeBusException } from '@/lib/depot/exceptions/describe';
import { busColumnPlan } from '@/lib/depot/exceptions/pageModel';
import type { BusException, BusExceptionKind } from '@/lib/depot/exceptions/types';
import { formatFeedDateTime, formatFeedTime } from '@/lib/depot/format';

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
const KIND: Column<BusException> = {
  key: 'kind',
  header: 'Kind',
  render: (row) => EXCEPTION_KIND_LABEL[row.kind],
};
const SEVERITY: Column<BusException> = {
  key: 'severity',
  header: 'Severity',
  render: (row) => <SeverityMark severity={row.severity} />,
};
const CODE: Column<BusException> = {
  key: 'code',
  header: 'Tamper code',
  render: (row) => row.detail ?? '—',
  title: (row) => (row.detail === null ? 'Only a tamper code row has one' : `Raw code "${row.detail}"`),
};
const LAST_SEEN: Column<BusException> = {
  key: 'lastSeen',
  header: 'Last seen',
  align: 'right',
  render: (row) => formatFeedTime(row.lastSeen),
  title: (row) => formatFeedDateTime(row.lastSeen),
};

export interface BusExceptionTableProps {
  /** Rows after the user's filters. */
  readonly rows: readonly BusException[];
  /** The kind filter: a constant Kind column is not drawn. */
  readonly kind?: BusExceptionKind | null;
  readonly emptyMessage?: string;
}

/**
 * One server page of buses that need attention, in the server's order (worst
 * first). Not sortable here: sorting one page would misstate the order of the whole list.
 */
export function BusExceptionTable({
  rows,
  kind = null,
  emptyMessage = 'No bus exceptions on this page.',
}: BusExceptionTableProps) {
  const plan = busColumnPlan(kind, rows);
  const columns = [
    REGISTRATION,
    DEPOT,
    ...(plan.showKind ? [KIND] : []),
    SEVERITY,
    ...(plan.showCode ? [CODE] : []),
    LAST_SEEN,
  ];
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
    />
  );
}
