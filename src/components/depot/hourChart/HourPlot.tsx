'use client';

import { useId, useMemo } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { HourChartModel, HourColumn } from '@/lib/depot/service/hourChartModel';
import { GapTick, HourTooltip } from './HourPlotParts';
import {
  HATCH_OPACITY,
  HATCH_SPACING,
  HOUR_AXIS_FONT_SIZE,
  HOUR_COLOUR,
  LINE_WIDTH,
  NEEDED_BAND_OPACITY,
  NEEDED_DASH,
  OUTLINE_DASH,
} from './hourChartStyle';

export interface HourPlotProps {
  readonly model: HourChartModel;
  /** Plot height in pixels, the gap row under the axis included. */
  readonly height: number;
}

const TICK = { fill: HOUR_COLOUR.axisText, fontSize: HOUR_AXIS_FONT_SIZE, fontFamily: 'inherit' };
const MARGIN = { top: 20, right: 12, bottom: 4, left: 0 };
const Y_AXIS_WIDTH = 40;
/** The gap row's own band under the hour axis. */
const GAP_ROW_HEIGHT = 22;
const BAR_GAP = 2;
const BAR_RADIUS: [number, number, number, number] = [2, 2, 0, 0];

/**
 * The drawn hour chart: one category per hour, so the bars, both lines, the now marker
 * and the gap row (a second axis on the same categories) always share one column grid.
 * No animation, so nothing draws in under reduced motion either. Recharts measures
 * its container, so the drawing is only seen in a browser.
 */
export function HourPlot({ model, height }: HourPlotProps) {
  const rows = model.columns as HourColumn[];
  const byLabel = useMemo(
    () => new Map(model.columns.map((c) => [c.label, c] as const)),
    [model.columns],
  );
  const hatchId = `depot-hour-hatch-${useId().replace(/:/g, '')}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={MARGIN} barCategoryGap={BAR_GAP}>
        <defs>
          <pattern
            id={hatchId}
            width={HATCH_SPACING}
            height={HATCH_SPACING}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={HATCH_SPACING}
              stroke={HOUR_COLOUR.deployed}
              strokeWidth={1.5}
              strokeOpacity={HATCH_OPACITY}
            />
          </pattern>
        </defs>
        <CartesianGrid vertical={false} stroke={HOUR_COLOUR.grid} />
        <XAxis
          dataKey="label"
          ticks={[...model.xTicks]}
          interval={0}
          tick={TICK}
          stroke={HOUR_COLOUR.grid}
          tickLine={false}
        />
        <XAxis
          xAxisId="gap"
          dataKey="label"
          interval={0}
          axisLine={false}
          tickLine={false}
          height={GAP_ROW_HEIGHT}
          tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => (
            <GapTick {...props} column={byLabel.get(String(props.payload?.value ?? ''))} />
          )}
        />
        <YAxis
          domain={[model.yDomain[0], model.yDomain[1]]}
          ticks={[...model.yTicks]}
          allowDecimals={false}
          tick={TICK}
          width={Y_AXIS_WIDTH}
          axisLine={false}
          tickLine={false}
        />
        <Area
          dataKey="neededBand"
          stroke="none"
          fill={HOUR_COLOUR.needed}
          fillOpacity={NEEDED_BAND_OPACITY}
          isAnimationActive={false}
          activeDot={false}
          type="step"
        />
        <Bar
          dataKey="solid"
          stackId="deployed"
          fill={HOUR_COLOUR.deployed}
          radius={BAR_RADIUS}
          isAnimationActive={false}
        />
        <Bar
          dataKey="hatched"
          stackId="deployed"
          fill={`url(#${hatchId})`}
          stroke={HOUR_COLOUR.deployed}
          strokeWidth={1}
          isAnimationActive={false}
        />
        <Bar
          dataKey="outlined"
          stackId="deployed"
          fill="none"
          stroke={HOUR_COLOUR.outline}
          strokeWidth={1}
          strokeDasharray={OUTLINE_DASH}
          isAnimationActive={false}
        />
        <Line
          dataKey="scheduled"
          type="step"
          stroke={HOUR_COLOUR.scheduled}
          strokeWidth={LINE_WIDTH}
          dot={false}
          activeDot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="needed"
          type="step"
          stroke={HOUR_COLOUR.needed}
          strokeWidth={LINE_WIDTH}
          strokeDasharray={NEEDED_DASH}
          dot={false}
          activeDot={false}
          isAnimationActive={false}
        />
        {model.nowLabel !== null ? (
          <ReferenceLine
            x={model.nowLabel}
            stroke={HOUR_COLOUR.now}
            strokeWidth={LINE_WIDTH}
            label={{
              value: 'Now',
              position: 'top',
              fill: HOUR_COLOUR.now,
              fontSize: HOUR_AXIS_FONT_SIZE,
            }}
          />
        ) : null}
        <Tooltip
          isAnimationActive={false}
          cursor={{ fill: HOUR_COLOUR.grid }}
          content={({ label }) => <HourTooltip column={byLabel.get(String(label))} />}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
