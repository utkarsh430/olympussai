'use client';

import { useId, useMemo, useState } from 'react';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { buildHourChartModel, hourTableRows } from '@/lib/depot/service/hourChartModel';
import { chartNote } from '@/lib/depot/service/servicePageModel';
import { SERVICE_TEXT } from '@/lib/depot/service/serviceWording';
import type { RouteHourlyBody } from '@/lib/depot/service/types';
import { formatPlainDate } from '@/lib/depot/format';
import { HourLegend } from './HourLegend';
import { HourPlot } from './HourPlot';
import { HourTable } from './HourTable';

export interface HourChartProps {
  readonly body: Pick<RouteHourlyBody, 'hours' | 'currentHour' | 'operatingDate' | 'routeName'>;
  /** Plot height in pixels; the chart takes its container's width. */
  readonly height?: number;
}

const PLOT_HEIGHT_PX = 300;

/**
 * The page's hero: the route's 24 hours as deployed bars, the scheduled step line and the
 * needed dashed line over its range, with the now marker and the signed gap row; "Show as
 * table" swaps the drawing for its 24-row text table.
 */
export function HourChart({ body, height = PLOT_HEIGHT_PX }: HourChartProps) {
  const [asTable, setAsTable] = useState(false);
  const model = useMemo(
    () => buildHourChartModel({ hours: body.hours, currentHour: body.currentHour }),
    [body.hours, body.currentHour],
  );
  const rows = useMemo(() => hourTableRows(model), [model]);
  const baseId = useId().replace(/:/g, '');
  const titleId = `hour-chart-${baseId}`;
  const viewId = `hour-chart-view-${baseId}`;
  const label = `${body.routeName} by hour on ${formatPlainDate(body.operatingDate)}: buses deployed, scheduled and needed for each of the 24 hours, with the gap under each hour.`;
  const toggle = (
    <button
      type="button"
      className="depot-filter-button"
      aria-pressed={asTable}
      aria-controls={viewId}
      onClick={() => setAsTable((on) => !on)}
    >
      {SERVICE_TEXT.showTable}
    </button>
  );
  return (
    <section aria-labelledby={titleId} className="min-w-0" data-testid="hour-chart">
      <SectionLabel id={titleId} label={SERVICE_TEXT.chartTitle} note={chartNote(body)} controls={toggle} />
      <div id={viewId} className="min-w-0">
        {asTable ? (
          <HourTable rows={rows} />
        ) : (
          <>
            <div role="img" aria-label={label} className="min-w-0" data-testid="hour-chart-plot">
              <HourPlot model={model} height={height} />
            </div>
            <HourLegend hasNow={model.nowLabel !== null} />
          </>
        )}
      </div>
    </section>
  );
}
