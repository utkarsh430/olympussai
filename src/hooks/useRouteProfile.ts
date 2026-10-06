'use client';

import { useEffect, useState } from 'react';
import type { RouteProfileResponse } from '@/lib/depot/routes/types';

export interface UseRouteProfile {
  readonly data: RouteProfileResponse | null;
  readonly error: string | null;
  readonly loading: boolean;
}

const IDLE: UseRouteProfile = { data: null, error: null, loading: false };
const LOADING: UseRouteProfile = { data: null, error: null, loading: true };
const INVALID_NAME_ERROR = 'This route name is not valid.';
const UNAVAILABLE_ERROR = 'Route details are unavailable right now.';

interface Settled {
  readonly routeName: string;
  readonly state: UseRouteProfile;
}

/**
 * Fetches one route's profile once per route name. The catalogue caches on the
 * server and a route does not change within a session, so there is no polling.
 * Errors are fixed strings, never the browser's own message.
 */
export function useRouteProfile(routeName: string | null): UseRouteProfile {
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (!routeName) return;
    const controller = new AbortController();

    async function load(name: string): Promise<void> {
      try {
        const response = await fetch(`/api/upsrtc/depot/route/${encodeURIComponent(name)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (response.status === 400) {
          setSettled({ routeName: name, state: { data: null, error: INVALID_NAME_ERROR, loading: false } });
          return;
        }
        if (!response.ok) throw new Error('unavailable');
        const data = (await response.json()) as RouteProfileResponse;
        setSettled({ routeName: name, state: { data, error: null, loading: false } });
      } catch {
        if (controller.signal.aborted) return;
        setSettled({ routeName: name, state: { data: null, error: UNAVAILABLE_ERROR, loading: false } });
      }
    }

    void load(routeName);
    return () => controller.abort();
  }, [routeName]);

  if (!routeName) return IDLE;
  // A result for a previous route must never be shown for the current one.
  return settled?.routeName === routeName ? settled.state : LOADING;
}
