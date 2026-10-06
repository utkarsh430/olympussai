'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  INITIAL_PROGRESS,
  runProfileLoader,
  type LoaderProgress,
  type LookupOutcome,
} from '@/lib/depot/routes/profileLoader';
import type { RouteProfileResponse } from '@/lib/depot/routes/types';

const PROFILE_ENDPOINT = '/api/upsrtc/depot/route/';
const DEFAULT_RETRY_SECONDS = 30;

/** Reads a `Retry-After` header as whole seconds; a missing or odd value waits the default. */
function retrySeconds(header: string | null): number {
  return header !== null && /^\d{1,5}$/.test(header.trim()) ? Number(header) : DEFAULT_RETRY_SECONDS;
}

/** One lookup through the existing per-route endpoint, as an outcome; it never throws. */
export async function lookupRouteProfile(
  routeName: string,
  signal: AbortSignal,
): Promise<LookupOutcome> {
  try {
    const response = await fetch(`${PROFILE_ENDPOINT}${encodeURIComponent(routeName)}`, {
      signal,
      cache: 'no-store',
    });
    if (response.status === 429) {
      return { kind: 'limited', retryAfterSeconds: retrySeconds(response.headers.get('retry-after')) };
    }
    if (!response.ok) return { kind: 'failed' };
    const body = (await response.json()) as RouteProfileResponse;
    if (body.status === 'ok') return body.profile.stops.length > 0 ? { kind: 'loaded' } : { kind: 'empty' };
    return body.reason === 'upstream_error' ? { kind: 'failed' } : { kind: 'empty' };
  } catch {
    return { kind: 'failed' };
  }
}

/** Resolves after `ms`, or at once when the signal aborts. */
export function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

export interface RouteProfileLoader {
  readonly progress: LoaderProgress;
  readonly running: boolean;
  /** Starts a run over these route names; ignored while one runs. */
  readonly start: (routeNames: readonly string[]) => void;
  readonly cancel: () => void;
}

/**
 * Drives `runProfileLoader` from a button press: never on mount, one run at a time,
 * cancelled on unmount. `onFinished` runs once a run ends with at least one lookup;
 * `onAnswered` runs for each route whose lookup answered.
 */
export function useRouteProfileLoader(
  onFinished: () => void,
  wait: (ms: number, signal: AbortSignal) => Promise<void> = waitFor,
  onAnswered: (routeName: string) => void = () => undefined,
): RouteProfileLoader {
  const [progress, setProgress] = useState<LoaderProgress>(INITIAL_PROGRESS);
  const controller = useRef<AbortController | null>(null);
  const finished = useRef(onFinished);
  const answered = useRef(onAnswered);
  useEffect(() => {
    finished.current = onFinished;
    answered.current = onAnswered;
  }, [onFinished, onAnswered]);
  useEffect(() => () => controller.current?.abort(), []);

  const start = useCallback(
    (routeNames: readonly string[]): void => {
      if (controller.current !== null || routeNames.length === 0) return;
      const own = new AbortController();
      controller.current = own;
      const deps = {
        lookup: lookupRouteProfile,
        wait,
        onProgress: setProgress,
        onAnswered: (name: string) => answered.current(name),
      };
      void runProfileLoader(routeNames, deps, own.signal).then((end) => {
        controller.current = null;
        if (end.looked > 0) finished.current();
      });
    },
    [wait],
  );

  const cancel = useCallback((): void => controller.current?.abort(), []);
  const running = progress.phase === 'running' || progress.phase === 'paused';
  return { progress, running, start, cancel };
}
