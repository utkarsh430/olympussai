'use client';

import { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MetricUnit } from '@/lib/depot/forecast/api';
import type { ChartPoint, PlotRow, TrendChartModel } from '@/lib/depot/forecast/chartModel';
import { formatDate, formatTick, formatValue } from '@/lib/depot/forecast/chartScale';
import { AXIS_FONT_SIZE, BAND_OPACITY, FORECAST_DASH, TREND_COLOUR } from './trendStyle';

export interface TrendPlotProps {
  readonly model: TrendChartModel;
  readonly unit: MetricUnit;
  /** Plot height in pixels, including the x-axis band. */
  readonly height: number;
}

const TICK = { fill: TREND_COLOUR.axisText, fontSize: AXIS_FONT_SIZE, fontFamily: 'inherit' };
const MARGIN = { top: 20, right: 20, bottom: 4, left: 0 };
const Y_AXIS_WIDTH = 52;
const LIVE_RADIUS = 5;

interface TooltipBodyProps {
  readonly point: ChartPoint | undefined;
  readonly unit: MetricUnit;
}

/** Value first, then what the point is: modelled history, the live value or a forecast with its range. */
function TooltipBody({ point, unit }: TooltipBodyProps) {
  if (!point) return null;
  return (
    <div className="rounded-[3px] border border-depot-line bg-depot-surface px-2.5 py-1.5 font-mono text-[11px] text-depot-muted">
      <div>{formatDate(point.date, true)}</div>
      <div className="text-[13px] tabular-nums text-depot-ink">
        {formatValue(point.value, unit)}
      </div>
      <div>{point.description}</div>
    </div>
  );
}

/**
 * The drawn chart: modelled history as a solid line, the live value as a
 * ringed dot labelled LIVE on the "now" marker, the forecast dashed over its
 * band. No animation, so nothing draws in under reduced motion either.
 * Recharts measures its container, so this part is only seen in a browser.
 */
export function TrendPlot({ model, unit, height }: TrendPlotProps) {
  const byDate = useMemo(
    () => new Map(model.points.map((p) => [p.date, p] as const)),
    [model.points],
  );
  const rows = model.rows as PlotRow[];
  const { domain, ticks, step } = model.yScale;
  const now = model.now;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={MARGIN}>
        <CartesianGrid vertical={false} stroke={TREND_COLOUR.grid} />
        <XAxis
          dataKey="date"
          ticks={[...model.xTicks]}
          interval={0}
          tickFormatter={(date: string) => formatDate(date)}
          tick={TICK}
          stroke={TREND_COLOUR.grid}
          tickLine={false}
        />
        <YAxis
          domain={[domain[0], domain[1]]}
          ticks={[...ticks]}
          allowDataOverflow
          tickFormatter={(value: number) => formatTick(value, unit, step)}
          tick={TICK}
          width={Y_AXIS_WIDTH}
          axisLine={false}
          tickLine={false}
        />
        <Area
          dataKey="band"
          stroke="none"
          fill={TREND_COLOUR.accent}
          fillOpacity={BAND_OPACITY}
          isAnimationActive={false}
          activeDot={false}
        />
        <Line
          dataKey="history"
          stroke={TREND_COLOUR.history}
          strokeWidth={2}
          dot={false}
          activeDot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="forecast"
          stroke={TREND_COLOUR.accent}
          strokeWidth={2}
          strokeDasharray={FORECAST_DASH}
          dot={false}
          activeDot={false}
          isAnimationActive={false}
        />
        {now ? (
          <ReferenceLine
            x={now.date}
            stroke={TREND_COLOUR.now}
            label={{
              value: 'Now',
              position: 'insideTopLeft',
              fill: TREND_COLOUR.axisText,
              fontSize: AXIS_FONT_SIZE,
            }}
          />
        ) : null}
        {now ? (
          <ReferenceDot
            x={now.date}
            y={now.value}
            r={LIVE_RADIUS}
            fill={TREND_COLOUR.accent}
            stroke={TREND_COLOUR.surface}
            strokeWidth={2}
            label={{
              value: 'LIVE',
              position: 'top',
              fill: TREND_COLOUR.accent,
              fontSize: AXIS_FONT_SIZE,
            }}
          />
        ) : null}
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: TREND_COLOUR.now, strokeWidth: 1 }}
          content={({ label }) => <TooltipBody point={byDate.get(String(label))} unit={unit} />}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
