'use client';

import { useId, useMemo, useState } from 'react';
import { TREND_CHART_MIN_HEIGHT } from '@/components/depot/shared/TrendChart';
import { TrendLegend } from '@/components/depot/shared/TrendChartParts';
import { TrendPlot } from '@/components/depot/shared/TrendPlot';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import type { TrendChartInput } from '@/lib/depot/forecast/chartModel';
import { buildTrendsChartView, type TrendsTableRow } from '@/lib/depot/forecast/trendsChartView';

const NO_VALUE = '—';

const COLUMNS: readonly Column<TrendsTableRow>[] = [
  { key: 'date', header: 'Date', sortValue: (row) => row.iso, render: (row) => row.date },
  {
    key: 'value',
    header: 'Value',
    align: 'right',
    sortValue: (row) => row.sortValue,
    render: (row) => row.value,
  },
  {
    key: 'low',
    header: 'Low',
    align: 'right',
    sortValue: (row) => row.sortLow,
    render: (row) => row.low || NO_VALUE,
  },
  {
    key: 'high',
    header: 'High',
    align: 'right',
    sortValue: (row) => row.sortHigh,
    render: (row) => row.high || NO_VALUE,
  },
  { key: 'kind', header: 'Kind', sortValue: (row) => row.kind, render: (row) => row.kind },
];

const BY_DATE = { key: 'date', direction: 'asc' } as const;

export interface TrendsChartProps {
  readonly data: TrendChartInput;
  readonly height?: number;
}

/**
 * The Trends pages' hero: a history that is generated beside a real depot or the real
 * network, so its section label carries the one MODELLED tag (ruling S51) and nothing
 * under it repeats the word. The legend, the text equivalent and the one caption line
 * come from `buildTrendsChartView`; the live point stays labelled LIVE by the shared plot,
 * and "Show as table" swaps the plot for the same points in a sortable table.
 */
export function TrendsChart({ data, height = TREND_CHART_MIN_HEIGHT }: TrendsChartProps) {
  const view = useMemo(() => buildTrendsChartView(data), [data]);
  const [asTable, setAsTable] = useState(false);
  const [announced, setAnnounced] = useState(false);
  const bodyId = useId();
  return (
    <section aria-labelledby={`${bodyId}-label`} className="min-w-0" data-testid="trends-chart">
      <SectionLabel id={`${bodyId}-label`} label={view.label} tag="modelled" />
      <div className="mb-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <TrendLegend entries={view.legend} />
        </div>
        <button
          type="button"
          className="depot-filter-button"
          aria-pressed={asTable}
          aria-controls={bodyId}
          onClick={() => {
            setAsTable((shown) => !shown);
            setAnnounced(true);
          }}
        >
          Show as table
        </button>
      </div>
      {/* Announces the swap; silent until the control is first used. */}
      <p role="status" className="sr-only">
        {announced ? (asTable ? 'Showing the values as a table.' : 'Showing the chart.') : ''}
      </p>
      <div id={bodyId}>
        {asTable ? (
          <DataTable
            columns={COLUMNS}
            rows={view.table}
            rowKey={(row) => row.key}
            caption={`${view.label}: every point drawn`}
            initialSort={BY_DATE}
          />
        ) : (
          <div
            role="img"
            aria-label={view.summary}
            className="relative w-full min-w-0"
            style={{ minHeight: height }}
          >
            <TrendPlot model={view.model} unit={data.metric.unit} height={height} />
          </div>
        )}
      </div>
      {view.caption ? (
        <p className="depot-caption mt-3" data-testid="trends-caption">
          {view.caption}
        </p>
      ) : null}
    </section>
  );
}
