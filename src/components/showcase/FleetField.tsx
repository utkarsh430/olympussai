'use client';

import { useMemo, useRef } from 'react';
import { createRandom } from '@/lib/simulation/seededRandom';
import { cn } from '@/lib/utils';
import { useCanvasLoop, type CanvasFrame } from './useCanvasLoop';

/**
 * Five thousand points: a fleet, drawn as a field.
 *
 * `converge` lays every point on one of twelve gently bent corridor lines at
 * even spacing and lets each line drift, slowly, alternating direction - a
 * network that is already running to its headway. `network` lays the same
 * points along eight spokes and three rings and lets them flow.
 *
 * Every position lives in typed arrays built ONCE per (points, mode) from a
 * seeded generator, so the server and the client agree on the layout and the
 * draw loop allocates nothing per point. The ink is the canvas's own computed
 * `color` (it is classed `text-primary`), read once per change, so the field
 * follows the theme rather than carrying a colour. Plain source-over
 * compositing: where beads crowd the line reads denser, never brighter.
 *
 * `speed` scales the drift: 1 is the pace each mode was tuned at, and a
 * smaller value slows every line by the same factor without changing where
 * any point sits at rest, so a caller can run the same field calmer.
 */
type FleetFieldMode = 'converge' | 'network';

const CORRIDORS = 12;
const SPOKES = 8;
const RING_RADII: readonly number[] = [0.2, 0.36, 0.52];
const BRIGHT_SHARE = 1 / 40;
const DIM_ALPHA = 0.17;
const BRIGHT_ALPHA = 0.45;