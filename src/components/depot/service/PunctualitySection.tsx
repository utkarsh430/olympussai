'use client';

import { useMemo } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { CollapsedSection } from '@/components/depot/shell/CollapsedSection';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import {
  PUNCTUALITY_COLUMN_WIDTHS as W,
  punctualityRows,
  type PunctualityRow,
} from '@/lib/depot/service/punctualityModel';
import { SERVICE_TEXT } from '@/lib/depot/service/serviceWording';
import type { HourReliability } from '@/lib/depot/service/types';

const TITLE_ID = 'service-punctuality';

const COLUMNS: readonly Column<PunctualityRow>[] = [
  { key: 'hour', header: 'Hour', width: W.hour, render: (r) => r.hour },
  { key: 'delay', header: 'Delay', align: 'right', width: W.delay, render: (r) => r.delay },
  { key: 'late', header: 'Late share', align: 'right', width: W.late, render: (r) => r.late },
  {
    key: 'coverage',
    header: 'Journeys',
    align: 'right',
    width: W.coverage,
    render: (r) => r.coverage,
    title: () => 'Journeys that carried a delay figure, of the journeys placed in the hour',
  },
];

/**
 * Median delay and late share by hour from the journeys the feed reported on the route,
 * placed by scheduled start (the response's `reliability`), with the journeys each rests on.
 * Closed by default: an hour rests on a few journeys and the delay's unit is unconfirmed, so
 * it is a figure to open, not one to read beside the chart.
 */
export function PunctualitySection({ reliability }: { readonly reliability: readonly HourReliability[] }) {
  const rows = useMemo(() => punctualityRows(reliability), [reliability]);
  return (
    <CollapsedSection
      label={SERVICE_TEXT.punctualityTitle}
      note={SERVICE_TEXT.delayUnit}
      headingId={TITLE_ID}
      testId="service-punctuality"
    >
      {rows.length === 0 ? (
        <StatePanel kind="empty" compact sentence={SERVICE_TEXT.noPunctuality} />
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          rowKey={(r) => r.key}
          caption={SERVICE_TEXT.punctualityCaption}
          fixedRows
        />
      )}
    </CollapsedSection>
  );
}
