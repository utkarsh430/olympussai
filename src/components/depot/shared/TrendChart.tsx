'use client';

import { useId, useMemo, useState } from 'react';
import { buildTrendChartModel, type TrendChartInput } from '@/lib/depot/forecast/chartModel';
import { TrendLegend, TrendTable } from './TrendChartParts';
import { TrendPlot } from './TrendPlot';

/** Plot height including the x-axis band; the chart never sets a width. */
export const TREND_CHART_MIN_HEIGHT = 240;

export interface TrendChartProps {
  /** The forecast API response, or any object with the same fields. */
  readonly data: TrendChartInput;
  /** Heading level for the title, to sit in the page's outline. */
  readonly headingLevel?: 2 | 3 | 4;
  readonly height?: number;
}

/**
 * History, the live value and the forecast with its band, titled and
 * legended with MODELLED, with the sentences the view wrote underneath and a
 * "Show as table" control that swaps the plot for the same points as rows.
 * Without a forecast it draws the history and says why. Fills its
 * container's width.
 */
export function TrendChart({
  data,
  headingLevel = 3,
  height = TREND_CHART_MIN_HEIGHT,
}: TrendChartProps) {
  const model = useMemo(() => buildTrendChartModel(data), [data]);
  const [asTable, setAsTable] = useState(false);
  const [announced, setAnnounced] = useState(false);
  const titleId = useId();
  const bodyId = useId();
  const Heading = `h${headingLevel}` as const;
  return (
    <section aria-labelledby={titleId} className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <Heading id={titleId} className="depot-section-label mb-0 min-w-0">
          {model.title}
        </Heading>
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
      <TrendLegend entries={model.legend} />
      <div id={bodyId}>
        {asTable ? (
          <TrendTable model={model} />
        ) : (
          <div
            role="img"
            aria-label={model.summary}
            className="relative w-full min-w-0"
            style={{ minHeight: height }}
          >
            <TrendPlot model={model} unit={data.metric.unit} height={height} />
          </div>
        )}
      </div>
      <div className="mt-3 space-y-1">
        {model.notes.map((note) => (
          <p key={note} className="depot-prose">
            {note}
          </p>
        ))}
      </div>
    </section>
  );
}
