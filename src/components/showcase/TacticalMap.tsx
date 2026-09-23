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
const TAIL_Y = 2.8;
const CHEVRON_SCALE = 1.7;

/**
 * Which stations get a name. A short route names every one; a medium one
 * every second; a long one falls back to the width rule, since twenty-five
 * names on a narrow plot overlap each other.
 */
export function labelEvery(stopCount: number, width: number): number {
  if (stopCount <= 12) return 1;
  if (stopCount <= 16) return 2;
  return width > 900 ? 2 : 4;
}

interface Ink {
  grid: string;
  axis: string;
  corridor: string;
  hold: string;
  danger: string;
  warning: string;
  info: string;
  muted: string;
  ground: string;
  font: string;
  captionFont: string;
}

/**
 * Resolve every colour the frame needs from the canvas's computed style.
 * A token that does not resolve (no themed ancestor) draws transparent
 * rather than inventing a hex; that is a theming failure to fix upstream,
 * not one to paper over here.
 */
function resolveInk(host: HTMLCanvasElement | null, arm: ReplayArm): Ink {
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
    corridor: colour(arm === 'controlled' ? '--sim-controlled' : '--sim-baseline'),
    hold: colour('--sim-hold'),
    danger: colour('--instrument-danger'),
    warning: colour('--instrument-warning'),
    info: colour('--instrument-info'),
    muted: colour('--muted-foreground'),
    ground: colour('--background'),
    font: `10px ${mono}`,
    captionFont: `11px ${mono}`,
  };
}

interface Hit {
  x: number;
  y: number;
  id: string;
}

function chevron(ctx: CanvasRenderingContext2D, cx: number, cy: number, heading: number): void {
  const radians = (heading * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const nose = NOSE_Y * CHEVRON_SCALE;
  const wingX = WING_X * CHEVRON_SCALE;
  const wingY = WING_Y * CHEVRON_SCALE;
  const tail = TAIL_Y * CHEVRON_SCALE;
  ctx.beginPath();
  ctx.moveTo(cx - nose * sin, cy + nose * cos);
  ctx.lineTo(cx + wingX * cos - wingY * sin, cy + wingX * sin + wingY * cos);
  ctx.lineTo(cx - tail * sin, cy + tail * cos);
  ctx.lineTo(cx - wingX * cos - wingY * sin, cy - wingX * sin + wingY * cos);
  ctx.closePath();
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
}

interface Scene {
  route: CorridorRoute;
  frame: ReplayFrame;
  arm: ReplayArm;
  followedId: string | null;
}

function paint({ ctx, width, height, elapsed }: CanvasFrame, scene: Scene, hits: Hit[]): void {
  const host = ctx.canvas instanceof HTMLCanvasElement ? ctx.canvas : null;
  const ink = resolveInk(host, scene.arm);
  const { route, frame } = scene;
  const padding = Math.max(PADDING_MIN, PADDING_SHARE * Math.min(width, height));
  const project = (point: GeoPoint) => projectToBox(point, route.bounds, width, height, padding);

  ctx.clearRect(0, 0, width, height);
  hits.length = 0;

  // Grid.
  ctx.save();
  ctx.strokeStyle = ink.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0.5; x < width; x += GRID_PX) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = 0.5; y < height; y += GRID_PX) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.restore();

  // Corridor: a faint wide underlay, then the thin line. No shadow - the
  // underlay is the whole of the softening.
  const stops = route.stops.map((stop) => ({ stop, at: project(stop) }));
  const tracePath = () => {
    ctx.beginPath();
    for (let index = 0; index < stops.length; index += 1) {
      const entry = stops[index];
      if (!entry) continue;
      if (index === 0) ctx.moveTo(entry.at.x, entry.at.y);
      else ctx.lineTo(entry.at.x, entry.at.y);
    }
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink.corridor;
  ctx.globalAlpha = 0.05;
  ctx.lineWidth = 7;
  tracePath();
  ctx.stroke();
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1.5;
  tracePath();
  ctx.stroke();
  ctx.restore();

  // Stations: a small tick at every stop, a name on some of them.
  const every = labelEvery(stops.length, width);
  ctx.save();
  ctx.font = ink.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Names already on the canvas, so two stations a few pixels apart (the
  // Lucknow end of the inter-city route) do not print over each other: a
  // name that would overlap tries the other side of its tick, then yields.
  const drawnLabels: { x1: number; x2: number; y1: number; y2: number }[] = [];
  const overlapsDrawn = (x1: number, x2: number, y1: number, y2: number) =>
    drawnLabels.some((box) => x1 < box.x2 && x2 > box.x1 && y1 < box.y2 && y2 > box.y1);
  for (let index = 0; index < stops.length; index += 1) {
    const entry = stops[index];
    if (!entry) continue;
    ring(ctx, entry.at.x, entry.at.y, 2.5);
    ctx.fillStyle = ink.ground;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = ink.corridor;
    ctx.stroke();
    if (index % every === 0 || index === stops.length - 1) {
      const above = Math.floor(index / every) % 2 === 0;
      // A name centred on an end station would run off the canvas; slide it
      // inward rather than clip it.
      const half = (entry.stop.name.length * LABEL_CHAR_PX) / 2;
      const x = Math.min(Math.max(entry.at.x, half + LABEL_EDGE_PX), width - half - LABEL_EDGE_PX);
      const candidates = above ? [-11, 13] : [13, -11];
      for (const offset of candidates) {
        const y = entry.at.y + offset;
        const box = { x1: x - half, x2: x + half, y1: y - 6, y2: y + 6 };
        if (overlapsDrawn(box.x1, box.x2, box.y1, box.y2)) continue;
        ctx.fillStyle = ink.muted;
        ctx.fillText(entry.stop.name, x, y);
        drawnLabels.push(box);
        break;
      }
    }
  }
  ctx.restore();

  // Pairs that are not fine: a dashed link with a ring at each bus.
  ctx.save();
  ctx.lineWidth = 1;
  for (const pair of frame.pairs) {
    if (pair.state === 'ok') continue;
    const colour = pair.state === 'bunched' ? ink.danger : ink.warning;
    const a = project(pair.leader);
    const b = project(pair.follower);
    ctx.strokeStyle = colour;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ring(ctx, a.x, a.y, 6);
    ctx.stroke();
    ring(ctx, b.x, b.y, 6);
    ctx.stroke();
  }
  ctx.restore();

  // Holds: one ring expanding and fading at the station, one still ring
  // inside it, and the seconds remaining in text.
  ctx.save();
  ctx.font = ink.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const phase = (elapsed % PULSE_PERIOD) / PULSE_PERIOD;
  for (const hold of frame.holds) {
    const at = project(hold.position);
    ctx.strokeStyle = ink.hold;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.45 * (1 - phase);
    ring(ctx, at.x, at.y, 8 + phase * 14);
    ctx.stroke();
    ctx.globalAlpha = 0.7;
    ring(ctx, at.x, at.y, 6);
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = ink.hold;
    ctx.fillText(`HOLD ${Math.ceil(hold.remainingSeconds)}s`, at.x, at.y - 18);
  }
  ctx.restore();

  // Buses: a chevron pointing along the heading, filled with the arm's ink
  // and cased thinly in the ground colour so it survives over the corridor
  // line. A holding bus takes the hold ink; its pulse and label say so too.
  ctx.save();
  ctx.lineJoin = 'round';
  for (const vehicle of frame.vehicles) {
    const at = project(vehicle.position);
    hits.push({ x: at.x, y: at.y, id: vehicle.id });
    chevron(ctx, at.x, at.y, vehicle.position.headingDegrees);
    ctx.fillStyle = vehicle.holding ? ink.hold : ink.corridor;
    ctx.fill();
    ctx.strokeStyle = ink.ground;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();

  // The followed bus: a one-pixel crosshair and its id.
  const followed = scene.followedId
    ? frame.vehicles.find((vehicle) => vehicle.id === scene.followedId)
    : undefined;
  if (followed) {
    const at = project(followed.position);
    ctx.save();
    ctx.strokeStyle = ink.info;
    ctx.lineWidth = 1;
    ring(ctx, at.x, at.y, 14);
    ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      ctx.moveTo(at.x + dx * 17, at.y + dy * 17);
      ctx.lineTo(at.x + dx * 26, at.y + dy * 26);
    }
    ctx.stroke();
    ctx.font = ink.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = ink.info;
    ctx.fillText(followed.id, at.x + 20, at.y - 18);
    ctx.restore();
  }

  // The arm, named in text, with the route's ends beneath it: bottom-left,
  // where the corridor's own geometry never reaches.
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.font = ink.captionFont;
  ctx.fillStyle = ink.muted;
  ctx.fillText(ARM_LABEL[scene.arm].toUpperCase(), CAPTION_X, height - CAPTION_BOTTOM - 16);
  ctx.font = ink.font;
  ctx.fillStyle = ink.axis;
  ctx.fillText(`${route.origin} → ${route.destination}`, CAPTION_X, height - CAPTION_BOTTOM);
  ctx.restore();
}

export function TacticalMap({
  route,
  frame,
  arm,
  followedId,
  onSelect,
  className,
}: TacticalMapProps) {
  const hitsRef = useRef<Hit[]>([]);
  const draw = (canvasFrame: CanvasFrame) =>
    paint(canvasFrame, { route, frame, arm, followedId }, hitsRef.current);
  const canvasRef = useCanvasLoop(draw);
  useStillRepaint(canvasRef, draw, frame);

  const onClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best: string | null = null;
    let bestDistance = HIT_RADIUS * HIT_RADIUS;
    for (const hit of hitsRef.current) {
      const dx = hit.x - x;
      const dy = hit.y - y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = hit.id;
      }
    }
    if (best) onSelect(best);
  };

  const label = `${ARM_LABEL[arm]}: ${frame.busesLive} buses on ${route.name}, ${frame.bunchedPairs} bunched pairs, ${frame.holds.length} holds in progress`;

  return (
    <div className={cn('absolute inset-0 bg-background', className)}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className="absolute inset-0 h-full w-full cursor-crosshair"
        onClick={onClick}
      />
    </div>
  );
}
