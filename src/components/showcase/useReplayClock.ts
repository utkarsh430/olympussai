'use client';

import { useCallback, useEffect, useReducer, useRef, type RefObject } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { initialReplayClock, replayReducer, type ReplayClock } from '@/lib/showcase/replayClock';
import type { CanvasDraw } from './useCanvasLoop';

export interface ReplayClockHandle {
  clock: ReplayClock;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  setSpeed: (speed: number) => void;
}

/**
 * The replay clock, driven by requestAnimationFrame.
 *
 * The reducer in `lib/showcase/replayClock.ts` owns every rule; this hook
 * only supplies real time. Each animation frame dispatches a `tick` with the
 * measured delta, capped at 0.1 s so a tab that was throttled or a machine
 * that stalled does not leap the replay forward by a minute of simulated
 * time in one frame.
 *
 * The loop stops while the document is hidden and resumes on return without
 * touching `playing`, so a replay left running in a background tab picks up
 * where it was rather than where it would have been.
 *
 * Under `prefers-reduced-motion` the clock starts paused: the scene is still
 * there, and Play is one deliberate click away. A horizon change (a new
 * scenario) resets the clock to zero.
 */
export function useReplayClock(horizon: number): ReplayClockHandle {
  const reduced = useReducedMotion();
  const [clock, dispatch] = useReducer(replayReducer, horizon, (initial) =>
    initialReplayClock(initial),
  );

  // The reduced-motion preference is only known after mount (the hook reads
  // matchMedia in an effect), so the pause lands one render in rather than at
  // initialisation. Pausing on the flip, not on every render, keeps a
  // deliberate Play under reduced motion honoured.
  useEffect(() => {
    if (reduced) dispatch({ type: 'pause' });
  }, [reduced]);

  useEffect(() => {
    dispatch({ type: 'setHorizon', horizon });
    dispatch({ type: 'reset' });
  }, [horizon]);

  useEffect(() => {
    if (!clock.playing) return;
    if (typeof window === 'undefined') return;

    let frame = 0;
    let running = false;
    let previous = performance.now();

    const loop = (now: number) => {
      if (!running) return;
      const delta = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      if (delta > 0) dispatch({ type: 'tick', deltaSeconds: delta });
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
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [clock.playing]);

  const play = useCallback(() => dispatch({ type: 'play' }), []);
  const pause = useCallback(() => dispatch({ type: 'pause' }), []);
  const toggle = useCallback(() => dispatch({ type: 'toggle' }), []);
  const seek = useCallback((t: number) => dispatch({ type: 'seek', t }), []);
  const setSpeed = useCallback((speed: number) => dispatch({ type: 'setSpeed', speed }), []);

  return { clock, play, pause, toggle, seek, setSpeed };
}

/**
 * Repaint a `useCanvasLoop` canvas when its subject changes under reduced
 * motion.
 *
 * `useCanvasLoop` honours `prefers-reduced-motion` by drawing ONE frame and
 * stopping, which is right for ambient motion and wrong for a replay: with
 * the loop stopped, a scrub of the timeline or a deliberate Play would move
 * the clock and leave the picture where it was. This hook watches `signal`
 * (the frame, the time, whatever the picture is of) and, only while motion
 * is reduced, paints once more with the same sizing rules the loop uses. It
 * does nothing at all when the loop is running, so the two never race.
 */
export function useStillRepaint(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  draw: CanvasDraw,
  signal: unknown,
): void {
  const reduced = useReducedMotion();
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    if (!reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 1;
    const height = canvas.clientHeight || canvas.parentElement?.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const backingWidth = Math.max(1, Math.round(width * dpr));
    const backingHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawRef.current({ ctx, width, height, elapsed: 0, delta: 0, reduced: true });
  }, [reduced, signal, canvasRef]);
}
