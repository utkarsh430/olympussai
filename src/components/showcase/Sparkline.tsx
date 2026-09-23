'use client';

import { useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import type { TrialSweepPoint } from '@/lib/showcase/trialData';
import { cn } from '@/lib/utils';

interface Row {
  t: number;
  before: number;
  after: number;
}

/** The sample nearest to `t` by `atSeconds`, in a series sorted by time. */
function nearestAt(series: readonly TrialSweepPoint[], t: number): TrialSweepPoint | undefined {
  if (series.length === 0) return undefined;
  let low = 0;
  let high = series.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((series[mid]?.atSeconds ?? 0) < t) low = mid + 1;
    else high = mid;
  }
  const here = series[low];
  const previous = series[low - 1];
  if (!previous || !here) return here ?? previous;
  return Math.abs(previous.atSeconds - t) <= Math.abs(here.atSeconds - t) ? previous : here;
}

/**
 * Both arms on one time axis. They share sample times, so equal lengths zip
 * by index; when they differ the longer series is the axis and the shorter
 * is read at its nearest sample.
 */
function alignSweeps(
  controlled: readonly TrialSweepPoint[],
  uncontrolled: readonly TrialSweepPoint[],
): Row[] {
  const sameLength = controlled.length === uncontrolled.length;
  const axis = uncontrolled.length >= controlled.length ? uncontrolled : controlled;
  return axis.map((point, index) => {
    const before = sameLength ? uncontrolled[index] : nearestAt(uncontrolled, point.atSeconds);
    const after = sameLength ? controlled[index] : nearestAt(controlled, point.atSeconds);
    return {
      t: point.atSeconds,
      before: before?.openIncidents ?? 0,
      after: after?.openIncidents ?? 0,
    };
  });
}

function peakOf(series: readonly TrialSweepPoint[]): number {
  return series.reduce((peak, point) => Math.max(peak, point.openIncidents), 0);
}

/**
 * The open-incident curve of both arms, drawn small. The baseline is drawn
 * first so the controlled arm sits on top of it; neither has axes because the
 * card beside it states the numbers. Fills are the flat `-fill` tokens and
 * strokes are hairlines: the shape is the information, not the ink.
 */
export function Sparkline({
  controlled,
  uncontrolled,
  className,
}: {
  controlled: readonly TrialSweepPoint[];
  uncontrolled: readonly TrialSweepPoint[];
  className?: string;
}) {
  const rows = useMemo(() => alignSweeps(controlled, uncontrolled), [controlled, uncontrolled]);
  const label = `Open incidents over the run: peaked at ${peakOf(uncontrolled)} left alone and ${peakOf(controlled)} under control.`;

  return (
    <div role="img" aria-label={label} className={cn('h-full w-full', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Area
            type="monotone"
            dataKey="before"
            stroke="var(--sim-baseline)"
            strokeWidth={1.25}
            fill="var(--sim-baseline-fill)"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="after"
            stroke="var(--sim-controlled)"
            strokeWidth={1.25}
            fill="var(--sim-controlled-fill)"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
