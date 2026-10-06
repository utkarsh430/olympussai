'use client';

import { useCallback, useEffect, useState } from 'react';
import { rateLimitSentence } from '@/lib/depot/routes/routeDrawerModel';
import type { RouteProfileResponse } from '@/lib/depot/routes/types';

export interface UseRouteProfile {
  readonly data: RouteProfileResponse | null;
  readonly error: string | null;
  readonly loading: boolean;
  /** Seconds the throttle asked to wait, on a 429; null otherwise. */
  readonly retryAfterSeconds: number | null;
  /** True once the lookup has run longer than `SLOW_AFTER_MS`: the upstream is slow. */
  readonly slow: boolean;
  /** Looks the route up again (after a wait or a failure); one lookup per press. */
  readonly retry: () => void;
}

/** After this long a lookup is still running, the drawer says it is waiting on the service. */
export const SLOW_AFTER_MS = 2500;

const INVALID_NAME_ERROR = 'This route name is not valid.';
const UNAVAILABLE_ERROR = 'Route details are unavailable right now.';

type Outcome = Pick<UseRouteProfile, 'data' | 'error' | 'retryAfterSeconds'>;

interface Settled {
  readonly key: string;
  readonly outcome: Outcome;
}

const failed = (error: string, retryAfterSeconds: number | null = null): Outcome => ({
  data: null,
  error,
  retryAfterSeconds,
});

function wholeSeconds(header: string | null): number | null {
  return header !== null && /^\d{1,5}$/.test(header.trim()) ? Number(header) : null;
}

async function lookup(name: string, signal: AbortSignal): Promise<Outcome> {
  const response = await fetch(`/api/upsrtc/depot/route/${encodeURIComponent(name)}`, {
    signal,
    cache: 'no-store',
  });
  if (response.status === 400) return failed(INVALID_NAME_ERROR);
  if (response.status === 429) {
    // The throttle's own wait, printed only as a whole number of seconds.
    const header = response.headers.get('retry-after');
    return failed(rateLimitSentence(header), wholeSeconds(header));
  }
  if (!response.ok) throw new Error('unavailable');
  return { data: (await response.json()) as RouteProfileResponse, error: null, retryAfterSeconds: null };
}

/**
 * Fetches one route's profile once per route name, and again only when `retry` is
 * pressed. The catalogue caches on the server and a route does not change within a
 * session, so there is no polling. Errors are fixed strings, never the browser's own.
 */
export function useRouteProfile(routeName: string | null): UseRouteProfile {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [slowKey, setSlowKey] = useState<string | null>(null);
  const key = routeName ? `${attempt}:${routeName}` : null;

  useEffect(() => {
    if (!routeName || key === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => setSlowKey(key), SLOW_AFTER_MS);
    lookup(routeName, controller.signal)
      .catch((): Outcome => failed(UNAVAILABLE_ERROR))
      .then((outcome) => {
        if (!controller.signal.aborted) setSettled({ key, outcome });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [routeName, key]);

  const retry = useCallback((): void => setAttempt((n) => n + 1), []);
  // A result for a previous route (or attempt) must never be shown for the current one.
  const current = key !== null && settled?.key === key ? settled.outcome : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    retryAfterSeconds: current?.retryAfterSeconds ?? null,
    loading: key !== null && current === null,
    slow: key !== null && current === null && slowKey === key,
    retry,
  };
}
