'use client';

import { useCallback, useEffect, useState } from 'react';
import { ITERATION_PLAYBACK_MS } from '@/lib/bunching/config';

export interface SimulationPlayer {
  index: number;
  playing: boolean;
  atEnd: boolean;
  atStart: boolean;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  reset: () => void;
  seek: (index: number) => void;
}

/**
 * Playback for both simulations at once.
 *
 * There is a single iteration index for the whole page — that is what keeps the
 * two comparisons synchronised, and it is why every step control here is a pure
 * index change. The runs themselves are precomputed, so stepping backwards,
 * scrubbing and replaying are exact rather than re-simulated.
 */
export function useSimulationPlayer(total: number, resetKey: string): SimulationPlayer {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Changing scenario rewinds and pauses both sides together.
  useEffect(() => {
    setIndex(0);
    setPlaying(false);
  }, [resetKey]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setIndex((current) => Math.min(total - 1, current + 1));
    }, ITERATION_PLAYBACK_MS);
    return () => window.clearInterval(timer);
  }, [playing, total]);

  // Stop at the last iteration; the comparison ends on its summary, not a loop.
  useEffect(() => {
    if (index >= total - 1) setPlaying(false);
  }, [index, total]);

  const toggle = useCallback(() => {
    setPlaying((current) => {
      if (current) return false;
      // Pressing play on a finished run replays it from the disturbance.
      setIndex((position) => (position >= total - 1 ? 0 : position));
      return true;
    });
  }, [total]);

  const next = useCallback(() => {
    setPlaying(false);
    setIndex((current) => Math.min(total - 1, current + 1));
  }, [total]);

  const previous = useCallback(() => {
    setPlaying(false);
    setIndex((current) => Math.max(0, current - 1));
  }, []);

  const reset = useCallback(() => {
    setPlaying(false);
    setIndex(0);
  }, []);

  const seek = useCallback(
    (value: number) => {
      setPlaying(false);
      setIndex(Math.max(0, Math.min(total - 1, value)));
    },
    [total],
  );

  return {
    index,
    playing,
    atEnd: index >= total - 1,
    atStart: index === 0,
    toggle,
    next,
    previous,
    reset,
    seek,
  };
}
