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