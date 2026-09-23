'use client';

import { useEffect, useRef } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';

/**
 * A 2D canvas that draws itself every frame, following the conventions the
 * fleet map layer established (`src/components/map/fleetCanvasLayer.ts`):
 *
 *   - the backing store is sized to the element at a device-pixel ratio
 *     capped at 2, and resized only when the element's size changes;
 *   - the loop pauses while the tab is hidden and resumes on return;
 *   - under `prefers-reduced-motion` ONE frame is drawn and the loop stops,
 *     so the picture is still there without the motion;
 *   - a ResizeObserver redraws on layout change.
 *
 * `draw` receives the context, the CSS size, the elapsed seconds since the
 * loop started and the seconds since the previous frame. It must not keep
 * React state; anything it needs across frames lives in a ref the caller
 * owns.
 */
export interface CanvasFrame {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** Seconds since the loop started. */
  elapsed: number;
  /** Seconds since the previous frame (0 on the first). */
  delta: number;
  reduced: boolean;
}

export type CanvasDraw = (frame: CanvasFrame) => void;

export function useCanvasLoop(draw: CanvasDraw, options: { paused?: boolean } = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const reduced = useReducedMotion();
  const paused = options.paused ?? false;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    let running = false;
    let started = performance.now();
    let previous = started;
    let backingWidth = 0;
    let backingHeight = 0;

    const size = () => {
      const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 1;
      const height = canvas.clientHeight || canvas.parentElement?.clientHeight || 1;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const nextWidth = Math.max(1, Math.round(width * dpr));
      const nextHeight = Math.max(1, Math.round(height * dpr));
      if (nextWidth !== backingWidth || nextHeight !== backingHeight) {
        backingWidth = nextWidth;
        backingHeight = nextHeight;
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { width, height };
    };

    const paint = (now: number) => {
      const { width, height } = size();
      const elapsed = (now - started) / 1000;
      const delta = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      drawRef.current({ ctx, width, height, elapsed, delta, reduced });
    };

    const loop = (now: number) => {
      if (!running) return;
      paint(now);
      frame = requestAnimationFrame(loop);
    };

    const start = () => {
      if (running) return;
      running = true;
      previous = performance.now();
      frame = requestAnimationFrame(loop);
    };

    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    const once = () => {
      paint(performance.now());
    };

    if (reduced || paused) {
      once();
    } else {
      started = performance.now();
      start();
    }

    const onVisibility = () => {
      if (document.hidden) stop();
      else if (!reduced && !paused) start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (!running) once();
          });
    observer?.observe(canvas.parentElement ?? canvas);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
    };
  }, [reduced, paused]);

  return canvasRef;
}
