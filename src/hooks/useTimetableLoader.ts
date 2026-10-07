'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { INITIAL_PROGRESS, type LoaderProgress } from '@/lib/depot/routes/profileLoader';
import { lookupBusDay, runTimetableLoader } from '@/lib/depot/service/timetableLoader';
import { waitFor } from './useRouteProfileLoader';

export interface TimetableLoader {
  readonly progress: LoaderProgress;
  readonly running: boolean;
  /** Buses whose lookup answered this visit (a day, or no timetable): not offered again. */
  readonly answered: ReadonlySet<string>;
  /** Starts a run over these buses; ignored while one runs. */
  readonly start: (buses: readonly string[]) => void;
  readonly cancel: () => void;
}

/**
 * Drives the route's timetable loader from a button press: never on mount, one run at a
 * time, cancelled on unmount or when the route changes. `onFinished` runs once a run ends
 * having looked something up, so the page can ask for its figures again.
 */
export function useTimetableLoader(
  routeName: string,
  onFinished: () => void,
  wait: (ms: number, signal: AbortSignal) => Promise<void> = waitFor,
): TimetableLoader {
  const [progress, setProgress] = useState<LoaderProgress>(INITIAL_PROGRESS);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const controller = useRef<AbortController | null>(null);
  const finished = useRef(onFinished);
  useEffect(() => {
    finished.current = onFinished;
  }, [onFinished]);
  useEffect(() => () => controller.current?.abort(), [routeName]);

  const start = useCallback(
    (buses: readonly string[]): void => {
      if (controller.current !== null || buses.length === 0) return;
      const own = new AbortController();
      controller.current = own;
      const deps = {
        lookup: (bus: string, signal: AbortSignal) => lookupBusDay(routeName, bus, signal),
        wait,
        onProgress: setProgress,
        onAnswered: (bus: string) => setAnswered((prev) => new Set([...prev, bus])),
      };
      void runTimetableLoader(buses, deps, own.signal).then((end) => {
        controller.current = null;
        if (end.looked > 0) finished.current();
      });
    },
    [routeName, wait],
  );

  const cancel = useCallback((): void => controller.current?.abort(), []);
  const running = progress.phase === 'running' || progress.phase === 'paused';
  return { progress, running, answered, start, cancel };
}
