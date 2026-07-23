/**
 * Mutable scene-state singleton.
 *
 * Scroll progress and pointer position are read every frame inside `useFrame`.
 * Keeping them in a plain module object (not React state) means the animation
 * loop never triggers a React re-render — the render tree stays stable while the
 * GPU work is driven imperatively. GSAP ScrollTrigger and the pointer listener
 * write here; the R3F scene reads here.
 */
export interface SceneState {
  /** Global scroll progress across the whole page, 0..1. */
  progress: number;
  /** Normalized pointer position, -1..1 on each axis (0 at centre). */
  pointerX: number;
  pointerY: number;
  /** Smoothed pointer, lerped in the frame loop for gentle parallax. */
  smoothX: number;
  smoothY: number;
  /** True while the tab is hidden — the loop idles to save power. */
  hidden: boolean;
  /** Concept index (0..4) the visitor is focusing in Fields of Exploration. */
  activeConcept: number | null;
}

export const scene: SceneState = {
  progress: 0,
  pointerX: 0,
  pointerY: 0,
  smoothX: 0,
  smoothY: 0,
  hidden: false,
  activeConcept: null,
};

/**
 * The narrative sections mapped onto normalized progress ranges. Objects fade
 * in/out by asking "how far am I into range [a,b]" via `phase()`.
 *
 * A sixth band — `research` (AI Research Projects) — sits between exploration
 * and intelligence. Adding that DOM section makes the page physically taller, so
 * every band was recomputed against the new layout to keep each transition
 * aligned with its section. The values below are tuned to the measured scroll
 * offsets of the rendered page (Section offsets ÷ total scrollable height).
 *
 * The globe choreography reads only arrival/ascent/exploration/intelligence/
 * portal: `phase()` clamps `exploration` to 1 and `intelligence` stays 0 across
 * the research band, so the globe holds its calm, receded pose there — no extra
 * WebGL timeline, no jump on entry or exit.
 */
export const RANGES = {
  arrival: [0.0, 0.11],
  ascent: [0.11, 0.26],
  exploration: [0.26, 0.43],
  research: [0.43, 0.76],
  intelligence: [0.76, 0.96],
  portal: [0.96, 1.0],
} as const;

/** Linear 0..1 progress within [a,b], clamped. */
export function phase(p: number, a: number, b: number): number {
  if (b === a) return p >= b ? 1 : 0;
  return Math.min(1, Math.max(0, (p - a) / (b - a)));
}

/** Smooth 0..1..0 pulse peaking at the centre of [a,b] — for transient reveals. */
export function bell(p: number, a: number, b: number): number {
  const t = phase(p, a, b);
  return Math.sin(t * Math.PI);
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Frame-rate independent damping factor. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}
