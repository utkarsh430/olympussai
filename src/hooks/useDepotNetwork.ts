'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DepotNetworkResponse } from '@/lib/depot/api';

export const DEPOT_POLL_INTERVAL_MS = 60_000;
const NETWORK_ENDPOINT = '/api/upsrtc/depot/network';
const UNAUTHORISED = 401;

export interface DepotNetworkState {
  readonly data: DepotNetworkResponse | null;
  readonly error: string | null;
  /** True only until the first response or error arrives. */
  readonly loading: boolean;
  /** Fetch now instead of waiting for the next tick. */
  readonly refresh: () => void;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Polls the depot network API. Same abort-on-overlap pattern as `useLiveFleet`.
 * A failed poll after a success keeps the last good `data` and sets `error`;
 * the next success clears it. A 401 reports 'Session expired' (navigation, not
 * this hook, sends the user to sign in).
 */
export function useDepotNetwork(): DepotNetworkState {
  const [data, setData] = useState<DepotNetworkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef<AbortController | null>(null);
  const cancelled = useRef(false);

  const poll = useCallback(async (): Promise<void> => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    try {
      const response = await fetch(NETWORK_ENDPOINT, {
        signal: controller.signal,
        cache: 'no-store',
      });
      if (response.status === UNAUTHORISED) throw new Error('Session expired');
      if (!response.ok) throw new Error(`Depot feed responded ${response.status}`);
      const payload = (await response.json()) as DepotNetworkResponse;
      if (cancelled.current || controller.signal.aborted) return;
      setData(payload);
      setError(null);
      setLoading(false);
    } catch (caught) {
      if (cancelled.current || isAbort(caught) || controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : 'Depot feed unavailable');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cancelled.current = false;
    void poll();
    const timer = setInterval(() => void poll(), DEPOT_POLL_INTERVAL_MS);
    return () => {
      cancelled.current = true;
      clearInterval(timer);
      inFlight.current?.abort();
    };
  }, [poll]);

  const refresh = useCallback(() => void poll(), [poll]);

  return { data, error, loading, refresh };
}
