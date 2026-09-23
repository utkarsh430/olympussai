'use client';

import { Pause, Play } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { REPLAY_SPEEDS } from '@/lib/showcase/replayClock';
import {
  emptyFrame,
  frameAt,
  replayWindow,
  type ReplayArm,
  type ReplayContext,
  type ReplayWindow,
} from '@/lib/showcase/replayFrame';
import type { LiveCorridorModel, LiveTrialModel } from '@/lib/showcase/resolve';
import { cn } from '@/lib/utils';
import { CorridorMap } from './CorridorMap';
import { ReplayLanes } from './ReplayLanes';
import { ARM_LABEL } from './TacticalMap';
import { useReplayClock } from './useReplayClock';

/**
 * The live trial: one scenario of the fleet trial replayed on one corridor.
 *
 * Two columns, and nothing floats over the plot. The three routes between
 * them run through every quadrant of the map - the city trunk south-west
 * to north-east, the suburban radial the other way, the inter-city trunk
 * from the right edge to the left - so any panel laid over the canvas
 * covered some route's end. The controls and readings therefore live in
 * a column of their own on the left, and the right column is the corridor
 * map - the basemap when there is one, the tactical plot when there is not -
 * with the time-distance lanes beneath it.
 *
 * Three choices drive everything: which corridor, which scenario on it, and
 * which arm - the corridor left alone or the corridor under control. The
 * frame for the chosen arm is derived from the clock on every change and
 * handed to the plot; the lanes show both arms at once so the comparison is
 * always on screen.
 *
 * The clock runs over the replay WINDOW (`replayWindow`): the sampled buses
 * occupy a few hours of a ~25,000 s horizon, so the clock counts seconds
 * from the window's start and every consumer of absolute trial time -
 * `frameAt`, the lanes, the sim clock - is handed `window.start + clock.t`.
 * Choosing a corridor resets the scenario, the followed bus and, through
 * the changed horizon, the clock.
 *
 * The scene holds no numbers of its own. Every figure it shows comes off
 * the model or off the frame.
 */

/** The simulated service day starts at 06:00. */
const SERVICE_START_SECONDS = 6 * 3600;

const ARMS: readonly ReplayArm[] = ['uncontrolled', 'controlled'];

const NO_WINDOW: ReplayWindow = { start: 0, end: 0 };

/**
 * `t` seconds into the run as a wall clock, HH:MM from 06:00. The clock is
 * a time of day, so it rolls past midnight: an inter-city window that runs
 * twenty hours reads `02:00`, never `26:00`.
 */
export function formatSimClock(t: number): string {
  const total = SERVICE_START_SECONDS + Math.max(0, Math.floor(t));
  const hours = Math.floor(total / 3600) % 24;
  const minutes = Math.floor((total % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** A saving as a signed percentage: `+3.1%`, `−0.4%`, or an em dash when unmeasured. */
export function formatSignedPercent(value: number | null, decimals = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '−' : '+';
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

/** A cut as a negative percentage: a 40-point cut in excess wait reads `−40%`. */
export function formatCutPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '−' : '+';
  return `${sign}${Math.abs(Math.round(value))}%`;
}

/** The corridor the scene opens on: the city trunk when the model has one, else the first. */
export function defaultCorridorIndex(corridors: readonly LiveCorridorModel[]): number {
  const urban = corridors.findIndex((corridor) => corridor.presetId === 'urban');
  return urban >= 0 ? urban : 0;
}