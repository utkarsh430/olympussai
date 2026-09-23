'use client';

import { useMemo, type ChangeEvent, type MouseEvent } from 'react';
import { DWELL_SECONDS } from '@/lib/showcase/replayFrame';
import type { ReplayScenarioModel } from '@/lib/showcase/resolve';
import type { TrialTrajectory } from '@/lib/showcase/trialData';
import { cn } from '@/lib/utils';
import { useCanvasLoop, type CanvasFrame } from './useCanvasLoop';
import { useStillRepaint } from './useReplayClock';

/**
 * The two arms as time-distance diagrams, stacked, with the replay's
 * playhead across both.
 *
 * A time-distance plot is the one picture in which bunching is unmistakable:
 * two traces converging and then running together. The uncontrolled arm sits
 * on top and the controlled arm beneath, each named in text at its corner,
 * so the comparison is by position and by label and never by colour alone.
 * Everything before the playhead is drawn solid and everything after it
 * faint, so the eye reads "what has happened" against "what is coming".
 *
 * The x axis covers the replay WINDOW - the span of trial time the sampled
 * buses occupy - not the scenario's whole horizon, of which they fill only
 * a few hours. Times are absolute trial seconds throughout: `t`, the window
 * bounds, the trajectories and what `onSeek` is called with. The window can
 * be a few hours on the city trunk or most of a day on the inter-city one,
 * so the hour ticks thin themselves out to stay legible (`hourTickStep`).
 *
 * The scrub bar beneath is the accessible control for the same axis: it
 * carries the label, the value and the keyboard, and the canvas click is a
 * shortcut to it.
 */
export interface ReplayLanesProps {
  scenario: ReplayScenarioModel;
  /** Absolute trial time, in the trajectories' seconds. */
  t: number;
  /** The span of trial time the x axis covers. */
  windowStart: number;
  windowEnd: number;
  trialCorridorLengthMeters: number;
  stationNames: readonly string[];
  /** Called with an absolute trial time. */
  onSeek: (t: number) => void;
  className?: string;
}

const PAD_X = 12;
const PAD_TOP = 22;
const PAD_BOTTOM = 18;
const LANE_GAP = 26;
/** The least room two hour labels may have between them. */
const MIN_TICK_PX = 44;

/**
 * Hours between labelled ticks so that labels stay at least `MIN_TICK_PX`
 * apart: 1 for a short window, 2 or more once the window runs long enough
 * or the panel narrow enough that every hour would collide.
 */
export function hourTickStep(spanSeconds: number, innerWidthPx: number): number {
  const hoursSpan = spanSeconds / 3600;
  if (!(hoursSpan > 0) || !(innerWidthPx > 0)) return 1;
  const pxPerHour = innerWidthPx / hoursSpan;
  return Math.max(1, Math.ceil(MIN_TICK_PX / pxPerHour));
}