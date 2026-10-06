'use client';

import { useMemo } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { formatCount, formatPercent } from '@/lib/depot/format';
import { DASH, SERVICE_TEXT, delayFigure, hourLabel } from '@/lib/depot/service/serviceWording';
import type { RouteHourFigures } from '@/lib/depot/service/types';

const TITLE_ID = 'service-punctuality';

interface PunctualityRow {
  readonly key: string;
  readonly hour: string;
  readonly delay: string;
  readonly late: string;
  readonly coverage: string;
}

const COLUMNS: readonly Column<PunctualityRow>[] = [
  { key: 'hour', header: 'Hour', render: (r) => r.hour },
  { key: 'delay', header: 'Median delay', align: 'right', render: (r) => r.delay },
  { key: 'late', header: 'Late share', align: 'right', render: (r) => r.late },
  {
    key: 'coverage',
    header: 'Buses with a delay',
    align: 'right',
    render: (r) => r.coverage,
    title: () => 'Buses that carried a delay figure, of the buses deployed in the hour',
  },
];

/** Hours with any delay figure, in hour order; the rest have nothing to show. */
function punctualityRows(hours: readonly RouteHourFigures[]): readonly PunctualityRow[] {
  return hours
    .filter((h) => h.delayCoverage.n > 0)
    .map((h) => ({
      key: String(h.hour),
      hour: hourLabel(h.hour),
      delay: delayFigure(h.delayMedianMin),
      late: h.lateShare === null ? DASH : formatPercent(h.lateShare),
      coverage: `${formatCount(h.delayCoverage.n)} of ${formatCount(Math.round(h.delayCoverage.of))}`,
    }));
}

/** Median delay and late share per observed hour, with how many buses each rests on. */
export function PunctualitySection({ hours }: { readonly hours: readonly RouteHourFigures[] }) {
  const rows = useMemo(() => punctualityRows(hours), [hours]);
  return (
    <section aria-labelledby={TITLE_ID} className="min-w-0" data-testid="service-punctuality">
      <SectionLabel id={TITLE_ID} label={SERVICE_TEXT.punctualityTitle} note={SERVICE_TEXT.delayUnit} />
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
    </section>
  );
}
