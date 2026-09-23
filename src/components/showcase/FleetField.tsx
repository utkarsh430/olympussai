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
const FALLBACK_INK: readonly [number, number, number] = [58, 179, 201];
const RGB_PATTERN = /rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/;

interface FieldLayout {
  mode: FleetFieldMode;
  count: number;
  /** Which line the point sits on and where along it, 0..1. */
  lineOf: Uint8Array;
  along: Float32Array;
  /** A residual off the line in -1..1, so order reads as even without being mechanical. */
  offset: Float32Array;
  /** 1 for the few points drawn larger and darker. */
  bright: Uint8Array;
  /** Scratch: this frame's positions in CSS pixels. */
  px: Float32Array;
  py: Float32Array;
  /** The last computed `color` string read, and what it parsed to. */
  inkRaw: string;
  ink: readonly [number, number, number];
}

function lineWeights(mode: FleetFieldMode): number[] {
  if (mode === 'converge') return Array.from({ length: CORRIDORS }, () => 1);
  // A spoke runs ~0.96 of the half-diagonal; a ring runs its circumference.
  // Weighting by length keeps the bead spacing similar on both.
  const spokes = Array.from({ length: SPOKES }, () => 1);
  const rings = RING_RADII.map((radius) => (2 * Math.PI * radius) / 0.96);
  return [...spokes, ...rings];
}

function buildLayout(points: number, mode: FleetFieldMode): FieldLayout {
  const count = Math.max(0, Math.floor(points));
  const random = createRandom(`fleet-field:${mode}`);
  const weights = lineWeights(mode);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const cumulative: number[] = [];
  let running = 0;
  for (const weight of weights) {
    running += weight / total;
    cumulative.push(running);
  }

  const layout: FieldLayout = {
    mode,
    count,
    lineOf: new Uint8Array(count),
    along: new Float32Array(count),
    offset: new Float32Array(count),
    bright: new Uint8Array(count),
    px: new Float32Array(count),
    py: new Float32Array(count),
    inkRaw: '',
    ink: FALLBACK_INK,
  };

  const perLine = new Uint32Array(weights.length);
  for (let i = 0; i < count; i += 1) {
    layout.offset[i] = random() * 2 - 1;
    layout.bright[i] = random() < BRIGHT_SHARE ? 1 : 0;

    // Stratified assignment: each line takes its weighted share of the
    // points, and a point's bead index on its line is its arrival order.
    const share = (i + 0.5) / count;
    let line = 0;
    while (line < cumulative.length - 1 && share > (cumulative[line] ?? 1)) line += 1;
    layout.lineOf[i] = line;
    layout.along[i] = perLine[line] ?? 0;
    perLine[line] = (perLine[line] ?? 0) + 1;
  }
  for (let i = 0; i < count; i += 1) {
    const beads = perLine[layout.lineOf[i] ?? 0] ?? 1;
    layout.along[i] = ((layout.along[i] ?? 0) + 0.5) / beads;
  }
  return layout;
}

function wrap01(value: number): number {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function placeCorridors(layout: FieldLayout, width: number, height: number, elapsed: number): void {
  const amplitude = height * 0.026;
  for (let i = 0; i < layout.count; i += 1) {
    const corridor = layout.lineOf[i] ?? 0;

    // A slow drift along the line, alternating direction per corridor, so
    // the field never reads as a still image.
    const direction = corridor % 2 === 0 ? 1 : -1;
    const speed = 0.006 + 0.002 * ((corridor * 5) % 3);
    const u = wrap01((layout.along[i] ?? 0) + direction * elapsed * speed);

    const baseY = height * (0.08 + 0.84 * ((corridor + 0.5) / CORRIDORS));
    const bend = amplitude * Math.sin((u * 1.3 + corridor * 0.37) * Math.PI * 2);
    layout.px[i] = u * width;
    layout.py[i] = baseY + bend + (layout.offset[i] ?? 0) * 1.4;
  }
}