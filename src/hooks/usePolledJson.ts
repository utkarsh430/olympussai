'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export const DEFAULT_POLL_INTERVAL_MS = 60_000;
const UNAUTHORISED = 401;

/** Fixed, user-facing failure reasons. Raw browser or server text never reaches the UI. */
export const SESSION_EXPIRED_MESSAGE = 'Session expired';
export const DEPOT_UNAVAILABLE_MESSAGE = 'Depot data unavailable';
export const NETWORK_UNREACHABLE_MESSAGE = 'Could not reach the server';

export interface PolledState<T> {
  readonly data: T | null;
  readonly error: string | null;
  /** True only until the first response or error for the current URL arrives. */
  readonly loading: boolean;
  /** Fetch now instead of waiting for the next tick. */
  readonly refresh: () => void;
}

export interface PolledJsonOptions {
  readonly intervalMs?: number;
  /** Fixed messages for specific HTTP statuses, e.g. 404. Anything unlisted falls back. */
  readonly statusMessages?: Readonly<Record<number, string>>;
}

/** What one URL has produced so far; tagged so a URL change can never show stale data. */
interface Slot<T> {
  readonly url: string;
  readonly data: T | null;
  readonly error: string | null;
}

const NO_STATUS_MESSAGES: Readonly<Record<number, string>> = {};

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function messageForStatus(status: number, custom: Readonly<Record<number, string>>): string {
  const specific = custom[status];
  if (specific) return specific;
  return status === UNAUTHORISED ? SESSION_EXPIRED_MESSAGE : DEPOT_UNAVAILABLE_MESSAGE;
}

/**
 * The single fetch loop behind every depot data hook. `intervalMs` null fetches once
 * per URL. A new request aborts the one in flight; an aborted or unmounted request
 * sets no state; a URL change discards the previous URL's data in the same render.
 */
export function useJsonResource<T>(
  url: string | null,
  intervalMs: number | null,
  statusMessages: Readonly<Record<number, string>> = NO_STATUS_MESSAGES,
): PolledState<T> {
  const [slot, setSlot] = useState<Slot<T> | null>(null);
  const messagesRef = useRef(statusMessages);
  const fetchNowRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    messagesRef.current = statusMessages;
  }, [statusMessages]);

  useEffect(() => {
    if (url === null) {
      fetchNowRef.current = () => undefined;
      return;
    }
    let inFlight: AbortController | null = null;

    const settle = (controller: AbortController, next: (prev: Slot<T> | null) => Slot<T>) => {
      if (controller.signal.aborted) return;
      setSlot(next);
    };
    const keepGood = (prev: Slot<T> | null): T | null => (prev?.url === url ? prev.data : null);

    const fetchNow = async (): Promise<void> => {
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      const fail = (message: string): void =>
        settle(controller, (prev) => ({ url, data: keepGood(prev), error: message }));

      try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (controller.signal.aborted) return;
        if (!response.ok) return fail(messageForStatus(response.status, messagesRef.current));
        const payload = (await response.json()) as T;
        settle(controller, () => ({ url, data: payload, error: null }));
      } catch (caught) {
        if (isAbort(caught)) return;
        fail(NETWORK_UNREACHABLE_MESSAGE);
      }
    };

    fetchNowRef.current = () => void fetchNow();
    void fetchNow();
    const timer = intervalMs === null ? null : setInterval(() => void fetchNow(), intervalMs);
    return () => {
      if (timer !== null) clearInterval(timer);
      inFlight?.abort();
      fetchNowRef.current = () => undefined;
    };
  }, [url, intervalMs]);

  const refresh = useCallback(() => fetchNowRef.current(), []);

  if (url === null) return { data: null, error: null, loading: false, refresh };
  if (slot?.url !== url) return { data: null, error: null, loading: true, refresh };
  return { data: slot.data, error: slot.error, loading: false, refresh };
}

/**
 * Polls a JSON endpoint. A failed poll after a success keeps the last good `data`
 * and sets `error`; the next success clears it. A null URL does nothing.
 */
export function usePolledJson<T>(
  url: string | null,
  options: PolledJsonOptions = {},
): PolledState<T> {
  return useJsonResource<T>(
    url,
    options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    options.statusMessages,
  );
}
