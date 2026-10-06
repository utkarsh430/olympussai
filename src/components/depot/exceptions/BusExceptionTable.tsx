'use client';

import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import {
  EXCEPTION_KIND_LABEL,
  SEVERITY_LABEL,
  describeBusException,
} from '@/lib/depot/exceptions/describe';
import type { BusException, ExceptionSeverity } from '@/lib/depot/exceptions/types';
import { formatFeedTime } from '@/lib/depot/format';

const SEVERITY_CLASS: Readonly<Record<ExceptionSeverity, string>> = {
  critical: 'depot-sev-critical',
  warning: 'depot-sev-warning',
  info: 'depot-sev-info',
};

const COLUMNS: readonly Column<BusException>[] = [
  {
    key: 'registration',
    header: 'Registration',
    render: (row) => row.registrationNumber,
  },
  {
    key: 'depot',
    header: 'Depot',
    render: (row) => row.depotName ?? 'No home depot in feed',
  },
  {
    key: 'kind',
    header: 'Kind',
    render: (row) => EXCEPTION_KIND_LABEL[row.kind],
  },
  {
    key: 'severity',
    header: 'Severity',
    render: (row) => (
      <span className={`depot-tag ${SEVERITY_CLASS[row.severity]}`}>
        {SEVERITY_LABEL[row.severity]}
      </span>
    ),
  },
  {
    key: 'lastSeen',
    header: 'Last seen',
    align: 'right',
    render: (row) => formatFeedTime(row.lastSeen),
  },
  {
    key: 'detail',
    header: 'Detail',
    render: (row) => <span className="depot-prose block min-w-[16rem]">{describeBusException(row)}</span>,
  },
];

export interface BusExceptionTableProps {
  /** Rows after the user's filters. */
  readonly rows: readonly BusException[];
  readonly emptyMessage?: string;
}

/**
 * One server page of buses that need attention, in the server's order (worst
 * first). Not sortable here: sorting one page would misstate the order of the whole list.
 */
export function BusExceptionTable({ rows, emptyMessage = 'No bus exceptions on this page.' }: BusExceptionTableProps) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      rowKey={(row) => row.id}
      caption="Buses that need attention"
      emptyMessage={emptyMessage}
    />
  );
}
