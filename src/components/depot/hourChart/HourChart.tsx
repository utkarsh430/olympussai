'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { useWidthTier } from '@/components/depot/shell/useWidthTier';
import { GAP_ROW_TIERS } from '@/lib/depot/service/gapRowLayout';
import { buildHourChartModel, hourTableRows } from '@/lib/depot/service/hourChartModel';
import { chartNote, scheduledLegendText } from '@/lib/depot/service/serviceCoverage';
import { SERVICE_TEXT } from '@/lib/depot/service/serviceWording';
import type { RouteHourlyResponse } from '@/lib/depot/service/types';
import { formatPlainDate } from '@/lib/depot/format';
import { HourLegend } from './HourLegend';
import { HourPlot } from './HourPlot';
import { HourTable } from './HourTable';

export interface HourChartProps {
  readonly body: Pick<
    RouteHourlyResponse,
    'hours' | 'currentHour' | 'operatingDate' | 'routeName' | 'observed' | 'scheduledCoverage' | 'feedNow'
  >;
  /** Plot height in pixels; the chart takes its container's width. */
  readonly height?: number;
  /** More of the section's own controls, before the view toggle (the timetable loader). */
  readonly controls?: ReactNode;
  /** Lines under the chart or its table, in either view (the loader's progress). */
  readonly footer?: ReactNode;
}

const PLOT_HEIGHT_PX = 300;

/**
 * The page's hero: the route's 24 hours as deployed bars, the scheduled step line and the
 * needed dashed line over its range, with the now marker and the signed gap row; "Show as
 * table" swaps the drawing for its 24-row text table and "Show as chart" swaps it back.
 */
export function HourChart({ body, height = PLOT_HEIGHT_PX, controls, footer }: HourChartProps) {
  const [asTable, setAsTable] = useState(false);
  const gapRow = useWidthTier(GAP_ROW_TIERS);
  const model = useMemo(
    () => buildHourChartModel({ hours: body.hours, currentHour: body.currentHour }),
    [body.hours, body.currentHour],
  );
  const rows = useMemo(() => hourTableRows(model), [model]);
  const baseId = useId().replace(/:/g, '');
  const titleId = `hour-chart-${baseId}`;
  const viewId = `hour-chart-view-${baseId}`;
  const label = `${body.routeName} by hour on ${formatPlainDate(body.operatingDate)}: bars for the buses deployed, lines for the buses scheduled and needed, and the gap under each hour. ${SERVICE_TEXT.showTable} lists every figure.`;
  // The words say what the button will show next, so it carries no pressed state as well.
  const toggle = (
    <button
      type="button"
      className="depot-filter-button"
      aria-controls={viewId}
      data-testid="hour-chart-toggle"
      onClick={() => setAsTable((on) => !on)}
    >
      {asTable ? SERVICE_TEXT.showChart : SERVICE_TEXT.showTable}
    </button>
  );
  return (
    <section aria-labelledby={titleId} className="min-w-0" data-testid="hour-chart">
      <SectionLabel
        id={titleId}
        label={SERVICE_TEXT.chartTitle}
        note={chartNote(body)}
        controls={
          <>
            {controls}
            {toggle}
          </>
        }
      />
      <div id={viewId} className="min-w-0">
        {asTable ? (
          <HourTable rows={rows} />
        ) : (
          <>
            <div role="img" aria-label={label} className="min-w-0" data-testid="hour-chart-plot">
              <HourPlot model={model} height={height} staggered={gapRow === 'staggered'} />
            </div>
            <HourLegend
              hasNow={model.nowLabel !== null}
              observed={body.observed !== null}
              scheduled={scheduledLegendText(body.scheduledCoverage)}
            />
          </>
        )}
        {footer}
      </div>
    </section>
  );
}
