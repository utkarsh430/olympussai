'use client';

import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import type { HourTableRow } from '@/lib/depot/service/hourChartModel';
import { SERVICE_TEXT } from '@/lib/depot/service/serviceWording';

const COLUMNS: readonly Column<HourTableRow>[] = [
  { key: 'hour', header: 'Hour', render: (r) => r.hour },
  { key: 'deployed', header: 'Deployed', align: 'right', render: (r) => r.deployed },
  { key: 'basis', header: 'Basis', render: (r) => r.basis },
  { key: 'scheduled', header: 'Scheduled', align: 'right', render: (r) => r.scheduled },
  { key: 'needed', header: 'Needed', tag: 'modelled', align: 'right', render: (r) => r.needed },
  { key: 'range', header: 'Range', align: 'right', render: (r) => r.neededRange },
  { key: 'gap', header: 'Gap', align: 'right', render: (r) => r.gap, title: (r) => r.gapTitle },
  { key: 'delay', header: 'Delay', align: 'right', render: (r) => r.delay },
  { key: 'late', header: 'Late share', align: 'right', render: (r) => r.lateShare },
];

/**
 * The chart's text equivalent: one row per hour of the operating day. The gap says its sign
 * in words ("+9 Short by 9"), the needed range is its own column, and the delay's caveat is
 * under the table, so the table needs neither the legend nor the punctuality section.
 */
export function HourTable({ rows, id }: { readonly rows: readonly HourTableRow[]; readonly id?: string }) {
  return (
    // In the page flow: the 24 rows are the chart's equivalent, so they never sit in a
    // second vertical scroll; the frame still scrolls sideways.
    <div className="depot-table-flow">
      <DataTable
        id={id}
        columns={COLUMNS}
        rows={rows}
        rowKey={(r) => r.key}
        caption={SERVICE_TEXT.tableCaption}
        fixedRows
      />
      <p className="depot-note mt-2">{SERVICE_TEXT.delayUnit}</p>
    </div>
  );
}
