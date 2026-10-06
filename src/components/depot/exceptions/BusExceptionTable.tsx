'use client';

import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import {
  EXCEPTION_KIND_LABEL,
  SEVERITY_LABEL,
  describeBusException,
} from '@/lib/depot/exceptions/describe';
import type { BusException, ExceptionSeverity } from '@/lib/depot/exceptions/types';
import { formatFeedTime } from '@/lib/depot/format';

const SEVERITY_RANK: Readonly<Record<ExceptionSeverity, number>> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const SEVERITY_CLASS: Readonly<Record<ExceptionSeverity, string>> = {
  critical: 'depot-sev-critical',
  warning: 'depot-sev-warning',
  info: 'depot-sev-info',
};

const COLUMNS: readonly Column<BusException>[] = [
  {
    key: 'registration',
    header: 'Registration',
    sortValue: (row) => row.registrationNumber,
    render: (row) => row.registrationNumber,
  },
  {
    key: 'depot',
    header: 'Depot',
    sortValue: (row) => row.depotName,
    render: (row) => row.depotName ?? 'No home depot in feed',
  },
  {
    key: 'kind',
    header: 'Kind',
    sortValue: (row) => EXCEPTION_KIND_LABEL[row.kind],
    render: (row) => EXCEPTION_KIND_LABEL[row.kind],
  },
  {
    key: 'severity',
    header: 'Severity',
    sortValue: (row) => SEVERITY_RANK[row.severity],
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
    sortValue: (row) => row.lastSeen,
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

/** Buses that need attention, one row each; the page above says how many exist in all. */
export function BusExceptionTable({ rows, emptyMessage = 'No buses match these filters.' }: BusExceptionTableProps) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      rowKey={(row) => row.id}
      caption="Buses that need attention"
      initialSort={{ key: 'severity', direction: 'asc' }}
      emptyMessage={emptyMessage}
    />
  );
}
