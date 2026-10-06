'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DepotExceptionsResponse } from '@/lib/depot/api';
import {
  DEPOT_POLL_INTERVAL_MS,
  DEPOT_UNAVAILABLE_MESSAGE,
  NETWORK_UNREACHABLE_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
} from '@/hooks/useDepotNetwork';

// One set of poll timing and failure wording for every depot hook.
export {
  DEPOT_POLL_INTERVAL_MS,
  DEPOT_UNAVAILABLE_MESSAGE,
  NETWORK_UNREACHABLE_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
};

const EXCEPTIONS_ENDPOINT = '/api/upsrtc/depot/exceptions';
const UNAUTHORISED = 401;

export interface DepotExceptionsState {
  readonly data: DepotExceptionsResponse | null;
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
 * Polls the depot exceptions API, exactly as `useDepotNetwork` polls the
 * network API: a new poll aborts the one in flight, a failed poll keeps the
 * last good `data` and sets a fixed `error`, and the next success clears it.
 */
export function useDepotExceptions(): DepotExceptionsState {
  const [data, setData] = useState<DepotExceptionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef<AbortController | null>(null);
  const cancelled = useRef(false);

  const poll = useCallback(async (): Promise<void> => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    const fail = (message: string): void => {
      if (cancelled.current || controller.signal.aborted) return;
      setError(message);
      setLoading(false);
    };

    try {
      const response = await fetch(EXCEPTIONS_ENDPOINT, {
        signal: controller.signal,
        cache: 'no-store',
      });
      if (response.status === UNAUTHORISED) return fail(SESSION_EXPIRED_MESSAGE);
      if (!response.ok) return fail(DEPOT_UNAVAILABLE_MESSAGE);
      const payload = (await response.json()) as DepotExceptionsResponse;
      if (cancelled.current || controller.signal.aborted) return;
      setData(payload);
      setError(null);
      setLoading(false);
    } catch (caught) {
      if (cancelled.current || isAbort(caught) || controller.signal.aborted) return;
      fail(NETWORK_UNREACHABLE_MESSAGE);
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
