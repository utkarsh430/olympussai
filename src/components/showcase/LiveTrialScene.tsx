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