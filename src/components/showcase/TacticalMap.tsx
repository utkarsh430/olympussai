'use client';

import { useRef, type MouseEvent } from 'react';
import { projectToBox, type CorridorRoute, type GeoPoint } from '@/lib/showcase/corridor';
import type { ReplayArm, ReplayFrame } from '@/lib/showcase/replayFrame';
import { cn } from '@/lib/utils';
import { useCanvasLoop, type CanvasFrame } from './useCanvasLoop';
import { useStillRepaint } from './useReplayClock';

/**
 * The corridor drawn as an instrument rather than a basemap.
 *
 * The live trial's route, its buses, the pairs that are not fine and the
 * holds in progress, projected into the canvas with `projectToBox`. It fills
 * the panel it is given and nothing is laid over it, so the corridor can use
 * the whole box. It is drawn quietly: thin lines, small ticks, no halo on anything, and every
 * state carried twice - a bunched pair is a dashed link AND a ring at each
 * bus, a hold is a pulse AND a label, the arm is the line's ink AND its name
 * in the corner - so colour is never the only encoding.
 *
 * Every colour is a design token, resolved from the canvas's computed style
 * once per frame. `--sim-*` are literal colours and pass straight through;
 * `--instrument-*` and the page tokens are HSL triplets and are wrapped.
 * Under reduced motion `useCanvasLoop` draws a single frame and
 * `useStillRepaint` redraws it when the replay is scrubbed; the hold pulses
 * then sit at their first phase rather than expanding.
 */
export interface TacticalMapProps {
  route: CorridorRoute;
  frame: ReplayFrame;
  arm: ReplayArm;
  followedId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}

export const ARM_LABEL: Record<ReplayArm, string> = {
  uncontrolled: 'Left alone',
  controlled: 'Under control',
};

/**
 * Room around the corridor, as a share of the shorter side with a floor:
 * enough for a station label at either end and the followed bus's
 * crosshair. Symmetric, because nothing sits over the canvas any more -
 * the scene's controls live in their own column.
 */
const PADDING_SHARE = 0.08;
const PADDING_MIN = 48;
/** Room a station label keeps from the canvas edge; a name at an end station is pushed inward to keep it. */
const LABEL_EDGE_PX = 4;
/** Approximate advance of one character at the 10 px mono label size, for the edge clamp. */
const LABEL_CHAR_PX = 6;
/** Where the arm is named: bottom-left, with the route's ends beneath it. */
const CAPTION_X = 16;
const CAPTION_BOTTOM = 16;
const GRID_PX = 44;
/** Seconds one hold pulse takes to expand and fade before the next begins. */
const PULSE_PERIOD = 1.6;
/** How close, in CSS pixels, a click has to land to a bus to select it. */
const HIT_RADIUS = 18;

/* The fleet layer's chevron geometry at scale 1, nose up (fleetCanvasLayer.ts).
   Mirrored rather than imported because that file builds SVG path strings
   for Path2D, which this plot does not need: ten buses are drawn with four
   lineTo calls each. */
const NOSE_Y = -7;
const WING_X = 4.4;
const WING_Y = 5.6;