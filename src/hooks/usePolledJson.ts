'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { feedTimeOf, reportRefreshFailure } from '@/lib/depot/pageRefresh';

export const DEFAULT_POLL_INTERVAL_MS = 60_000;
const UNAUTHORISED = 401;
const NOT_FOUND = 404;
/**
 * The shell's own network feed speaks for itself through the feed chip, the provenance
 * line and its timed stale notice; only a page's own requests raise the page notice.
 */
const SHELL_FEED_URL = '/api/upsrtc/depot/network';

/** Fixed, user-facing failure reasons. Raw browser or server text never reaches the UI. */
export const SESSION_EXPIRED_MESSAGE = 'Session expired';
export const DEPOT_UNAVAILABLE_MESSAGE = 'Depot data unavailable';
export const NETWORK_UNREACHABLE_MESSAGE = 'Could not reach the server';

export interface PolledState<T> {
  readonly data: T | null;
  readonly error: string | null;
  /** True only until the first response or error for the current URL arrives. */
  readonly loading: boolean;
  /**
   * True while `data` is the previous query's answer, kept on screen while the new query
   * of the same resource loads (`keepPreviousOnQueryChange`); `loading` is then true too.
   */
  readonly previous?: boolean;
  /** Fetch now instead of waiting for the next tick. */
  readonly refresh: () => void;
}

export interface PolledJsonOptions {
  readonly intervalMs?: number;
  /** Fixed messages for specific HTTP statuses, e.g. 404. Anything unlisted falls back. */
  readonly statusMessages?: Readonly<Record<number, string>>;
  /**
   * Keep the last answer on screen while a new query of the SAME resource loads (only the
   * query string differs: a search, sort, page or filter). A new path (another depot,
   * another endpoint) never shows the old answer.
   */
  readonly keepPreviousOnQueryChange?: boolean;
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

/** The URL without its query string: two URLs with the same path are one resource. */
function resourceOf(url: string): string {
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

function messageForStatus(status: number, custom: Readonly<Record<number, string>>): string {
  const specific = custom[status];
  if (specific) return specific;
  return status === UNAUTHORISED ? SESSION_EXPIRED_MESSAGE : DEPOT_UNAVAILABLE_MESSAGE;
}

/**
 * The single fetch loop behind every depot data hook. `intervalMs` null fetches once
 * per URL. A new request aborts the one in flight; an aborted or unmounted request
 * sets no state; a URL change discards the previous URL's data in the same render,
 * unless the caller asked to keep it across a query change of the same resource.
 * A 404 drops the data and stops the ticks. A failure that keeps data is reported to
 * the page-refresh store (`lib/depot/pageRefresh`), which the shell's notice reads.
 */
export function useJsonResource<T>(
  url: string | null,
  intervalMs: number | null,
  statusMessages: Readonly<Record<number, string>> = NO_STATUS_MESSAGES,
  keepPreviousOnQueryChange = false,
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
    // Set once the resource is gone; a tick then does nothing, an explicit refresh still asks.
    let stopped = false;

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
      // The resource is gone (a depot that has left the feed): its last figures are
      // dropped, so the page shows its not-found state, and polling stops.
      const gone = (message: string): void => {
        stopped = true;
        settle(controller, () => ({ url, data: null, error: message }));
      };

      try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (controller.signal.aborted) return;
        const message = messageForStatus(response.status, messagesRef.current);
        if (response.status === NOT_FOUND) return gone(message);
        if (!response.ok) return fail(message);
        const payload = (await response.json()) as T;
        stopped = false;
        settle(controller, () => ({ url, data: payload, error: null }));
      } catch (caught) {
        if (isAbort(caught)) return;
        fail(NETWORK_UNREACHABLE_MESSAGE);
      }
    };

    fetchNowRef.current = () => void fetchNow();
    void fetchNow();
    const timer = intervalMs === null ? null : setInterval(() => {
      if (!stopped) void fetchNow();
    }, intervalMs);
    return () => {
      if (timer !== null) clearInterval(timer);
      inFlight?.abort();
      fetchNowRef.current = () => undefined;
    };
  }, [url, intervalMs]);

  const refresh = useCallback(() => fetchNowRef.current(), []);

  // A page's own request failing after a success: the shell says so at once, naming the
  // feed time of the figures still on screen, until the request succeeds again.
  const reportKey = useId();
  const failing = url !== null && slot?.url === url && slot.error !== null && slot.data !== null;
  const failingSince = failing ? feedTimeOf(slot?.data) : null;
  const reports = failing && url !== SHELL_FEED_URL;
  useEffect(() => {
    if (!reports) return undefined;
    reportRefreshFailure(reportKey, { since: failingSince });
    return () => reportRefreshFailure(reportKey, null);
  }, [reportKey, reports, failingSince]);

  if (url === null) return { data: null, error: null, loading: false, previous: false, refresh };
  if (slot?.url !== url) {
    const carry =
      keepPreviousOnQueryChange &&
      slot !== null &&
      slot.data !== null &&
      resourceOf(slot.url) === resourceOf(url);
    return { data: carry ? slot.data : null, error: null, loading: true, previous: carry, refresh };
  }
  return { data: slot.data, error: slot.error, loading: false, previous: false, refresh };
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
    options.keepPreviousOnQueryChange,
  );
}
