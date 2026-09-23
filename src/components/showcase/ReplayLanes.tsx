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

interface LaneInk {
  grid: string;
  axis: string;
  baseline: string;
  controlled: string;
  hold: string;
  info: string;
  font: string;
}

function resolveInk(host: HTMLCanvasElement | null): LaneInk {
  const style = host ? getComputedStyle(host) : null;
  const read = (name: string): string => style?.getPropertyValue(name).trim() ?? '';
  const colour = (name: string): string => {
    const value = read(name);
    if (!value) return 'transparent';
    return /^\d/.test(value) ? `hsl(${value})` : value;
  };
  const mono = read('--font-mono') || 'ui-monospace, SFMono-Regular, monospace';
  return {
    grid: colour('--sim-grid'),
    axis: colour('--sim-axis'),
    baseline: colour('--sim-baseline'),
    controlled: colour('--sim-controlled'),
    hold: colour('--sim-hold'),
    info: colour('--instrument-info'),
    font: `10px ${mono}`,
  };
}

/**
 * The stations' distances along the simulator's corridor, read off the
 * longest trajectory in either arm: every visit is one station, in order.
 */
function stationDistances(scenario: ReplayScenarioModel): number[] {
  let longest: TrialTrajectory | null = null;
  for (const arm of [scenario.trajectories.uncontrolled, scenario.trajectories.controlled]) {
    for (const trajectory of arm) {
      if (!longest || trajectory.points.length > longest.points.length) longest = trajectory;
    }
  }
  return longest ? longest.points.map((point) => point.d) : [];
}

interface Lane {
  top: number;
  bottom: number;
  colour: string;
  trajectories: readonly TrialTrajectory[];
}

interface Plot {
  width: number;
  start: number;
  end: number;
  corridor: number;
}

function xAt(plot: Plot, t: number): number {
  const inner = Math.max(1, plot.width - PAD_X * 2);
  const span = plot.end - plot.start;
  const fraction = span > 0 ? Math.max(0, Math.min(1, (t - plot.start) / span)) : 0;
  return PAD_X + fraction * inner;
}

function yAt(lane: Lane, plot: Plot, d: number): number {
  const fraction = plot.corridor > 0 ? Math.max(0, Math.min(1, d / plot.corridor)) : 0;
  return lane.bottom - fraction * (lane.bottom - lane.top);
}

/** One bus's trace: stand at each station for its dwell and hold, then run to the next. */
function trace(
  ctx: CanvasRenderingContext2D,
  lane: Lane,
  plot: Plot,
  trajectory: TrialTrajectory,
): void {
  const points = trajectory.points;
  ctx.beginPath();
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point) continue;
    const y = yAt(lane, plot, point.d);
    if (index === 0) ctx.moveTo(xAt(plot, point.t), y);
    else ctx.lineTo(xAt(plot, point.t), y);
    const next = points[index + 1];
    const departs = point.t + DWELL_SECONDS + point.hold;
    ctx.lineTo(xAt(plot, next ? Math.min(departs, next.t) : departs), y);
  }
}

interface Subject {
  scenario: ReplayScenarioModel;
  t: number;
  windowStart: number;
  windowEnd: number;
  corridor: number;
  stations: readonly number[];
}

function paint({ ctx, width, height }: CanvasFrame, subject: Subject): void {
  const host = ctx.canvas instanceof HTMLCanvasElement ? ctx.canvas : null;
  const ink = resolveInk(host);
  const { scenario, t, windowStart, windowEnd, corridor, stations } = subject;
  const plot: Plot = { width, start: windowStart, end: windowEnd, corridor };
  const laneHeight = Math.max(1, (height - PAD_TOP - PAD_BOTTOM - LANE_GAP) / 2);
  const lanes: Lane[] = [
    {
      top: PAD_TOP,
      bottom: PAD_TOP + laneHeight,
      colour: ink.baseline,
      trajectories: scenario.trajectories.uncontrolled,
    },
    {
      top: PAD_TOP + laneHeight + LANE_GAP,
      bottom: PAD_TOP + laneHeight * 2 + LANE_GAP,
      colour: ink.controlled,
      trajectories: scenario.trajectories.controlled,
    },
  ];

  ctx.clearRect(0, 0, width, height);
  const playhead = xAt(plot, t);

  for (const lane of lanes) {
    // Station rules and the lane's own baseline.
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = ink.grid;
    ctx.beginPath();
    for (const d of stations) {
      const y = Math.round(yAt(lane, plot, d)) + 0.5;
      ctx.moveTo(PAD_X, y);
      ctx.lineTo(width - PAD_X, y);
    }
    ctx.stroke();
    ctx.strokeStyle = ink.axis;
    ctx.beginPath();
    ctx.moveTo(PAD_X, Math.round(lane.bottom) + 0.5);
    ctx.lineTo(width - PAD_X, Math.round(lane.bottom) + 0.5);
    ctx.stroke();
    ctx.restore();

    // Every trace faint, then the part already played solid, clipped at the playhead.
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = lane.colour;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.25;
    for (const trajectory of lane.trajectories) {
      trace(ctx, lane, plot, trajectory);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD_X, lane.top - 2, Math.max(0, playhead - PAD_X), lane.bottom - lane.top + 4);
    ctx.clip();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = lane.colour;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.9;
    for (const trajectory of lane.trajectories) {
      trace(ctx, lane, plot, trajectory);
      ctx.stroke();
    }
    ctx.restore();

    // Holds: a small ring where each began, solid once the replay has reached it.
    ctx.save();
    ctx.strokeStyle = ink.hold;
    ctx.lineWidth = 1;
    for (const trajectory of lane.trajectories) {
      for (const point of trajectory.points) {
        if (point.hold <= 0) continue;
        const begins = point.t + DWELL_SECONDS;
        ctx.globalAlpha = begins <= t ? 0.9 : 0.35;
        ctx.beginPath();
        ctx.arc(xAt(plot, begins), yAt(lane, plot, point.d), 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Hour ticks along the bottom, counted from the start of the window and
  // thinned so the labels never collide on a long window.
  ctx.save();
  ctx.font = ink.font;
  ctx.fillStyle = ink.axis;
  ctx.strokeStyle = ink.axis;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const bottom = height - PAD_BOTTOM;
  const step = hourTickStep(windowEnd - windowStart, Math.max(1, width - PAD_X * 2));
  for (let hour = step; windowStart + hour * 3600 < windowEnd; hour += step) {
    const x = Math.round(xAt(plot, windowStart + hour * 3600)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, bottom + 4);
    ctx.stroke();
    ctx.fillText(`${hour}h`, x, bottom + 5);
  }
  ctx.restore();

  // The playhead, across both lanes.
  ctx.save();
  ctx.strokeStyle = ink.info;
  ctx.fillStyle = ink.info;
  ctx.lineWidth = 1;
  const x = Math.round(playhead) + 0.5;
  ctx.beginPath();
  ctx.moveTo(x, PAD_TOP - 8);
  ctx.lineTo(x, bottom);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 5, PAD_TOP - 14);
  ctx.lineTo(x + 5, PAD_TOP - 14);
  ctx.lineTo(x, PAD_TOP - 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function ReplayLanes({
  scenario,
  t,
  windowStart,
  windowEnd,
  trialCorridorLengthMeters,
  stationNames,
  onSeek,
  className,
}: ReplayLanesProps) {
  const stations = useMemo(() => stationDistances(scenario), [scenario]);
  const draw = (canvasFrame: CanvasFrame) =>
    paint(canvasFrame, {
      scenario,
      t,
      windowStart,
      windowEnd,
      corridor: trialCorridorLengthMeters,
      stations,
    });
  const canvasRef = useCanvasLoop(draw);
  useStillRepaint(canvasRef, draw, t);

  const span = Math.max(0, windowEnd - windowStart);
  const onCanvasClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const inner = Math.max(1, rect.width - PAD_X * 2);
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left - PAD_X) / inner));
    onSeek(windowStart + fraction * span);
  };
  const onRange = (event: ChangeEvent<HTMLInputElement>) => {
    onSeek(Number(event.target.value));
  };

  const min = Math.max(0, Math.round(windowStart));
  const max = Math.max(min, Math.round(windowEnd));
  const stationCount = stationNames.length;
  const label = `Time-distance diagram of ${scenario.title}: ${scenario.vehicleCount} buses over ${stationCount} stations, left alone above and under control below`;

  return (
    <section className={cn('sc-panel flex flex-col', className)}>
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          className="absolute inset-0 h-full w-full cursor-col-resize"
          onClick={onCanvasClick}
        />
        <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col">
          <div className="relative flex-1">
            <span className="sc-label absolute left-3 top-1.5">Left alone</span>
          </div>
          <div className="relative flex-1">
            <span className="sc-label absolute left-3 top-1.5">Under control</span>
          </div>
        </div>
      </div>
      <label className="flex items-center gap-3 border-t border-border px-3 py-2">
        <span className="sc-label whitespace-nowrap">Scrub the replay</span>
        <input
          type="range"
          min={min}
          max={max}
          step={30}
          value={Math.min(max, Math.max(min, t))}
          onChange={onRange}
          aria-valuetext={`${Math.round(t)} seconds into the run`}
          className="h-1 w-full cursor-pointer rounded bg-primary/20"
          style={{ accentColor: 'hsl(var(--primary))' }}
        />
      </label>
    </section>
  );
}
