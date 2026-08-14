'use client';

import { useEffect, useRef, useState } from 'react';
import type { OpsMapSnapshot } from '@/lib/ops/mapData';

/**
 * Live-refreshing scoped map data for a mounted OpsFleetMap.
 *
 * Polls GET /api/ops/fleet/map, which resolves the caller's depot from their
 * own ops_users row. The browser never asks for a depot and never receives a
 * vehicle outside its own scope, so this hook has nothing to filter and
 * deliberately provides no way to.
 *
 * Polling rather than a socket: the upstream fleet snapshot is cached for 15
 * seconds server-side (src/lib/ops/fleetData.ts), so a faster cadence would
 * re-serve the same data, and this app has no socket transport to maintain.
 *
 * A failed poll keeps the last good snapshot on screen and reports the error
 * alongside it. A control-room map that blanks on one dropped request is
 * worse than a map that says how old it is.
 */

/** Matches the server-side live cache TTL: polling faster only re-serves the same snapshot. */
export const OPS_MAP_POLL_INTERVAL_MS = 15_000;

export interface OpsMapFeed {
  snapshot: OpsMapSnapshot | null;
  /** True until the first response of any kind arrives. */
  loading: boolean;
  /** Non-null when the most recent poll failed. `snapshot` may still hold the last good one. */
  error: string | null;
}

export function useOpsMapFeed(options: {
  /** Optional corridor for control-service positions and bunching incidents. Not a scoping parameter. */
  routeDirectionId?: string;
  /** Seed from the Server Component render so the map is populated on first paint. */
  initialSnapshot?: OpsMapSnapshot;
  intervalMs?: number;
  /** Set false to hold the current snapshot without polling (a paused or hidden panel). */
  enabled?: boolean;
} = {}): OpsMapFeed {
  const { routeDirectionId, initialSnapshot, intervalMs = OPS_MAP_POLL_INTERVAL_MS, enabled = true } = options;

  const [snapshot, setSnapshot] = useState<OpsMapSnapshot | null>(initialSnapshot ?? null);
  const [loading, setLoading] = useState(initialSnapshot === undefined);
  const [error, setError] = useState<string | null>(null);
  // Kept in a ref so an in-flight response that resolves after unmount, or
  // after the corridor changed, cannot write stale vehicles onto the map.
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const requestId = (requestIdRef.current += 1);
    let cancelled = false;

    async function poll() {
      try {
        const query = routeDirectionId ? `?routeDirectionId=${encodeURIComponent(routeDirectionId)}` : '';
        const response = await fetch(`/api/ops/fleet/map${query}`, { cache: 'no-store' });
        if (cancelled || requestIdRef.current !== requestId) return;
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
          setError(body?.error?.message ?? `The map data request failed (HTTP ${response.status}).`);
          setLoading(false);
          return;
        }
        const data = (await response.json()) as OpsMapSnapshot;
        if (cancelled || requestIdRef.current !== requestId) return;
        setSnapshot(data);
        setError(null);
        setLoading(false);
      } catch {
        if (cancelled || requestIdRef.current !== requestId) return;
        setError('The map data could not be refreshed - showing the last known positions.');
        setLoading(false);
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [routeDirectionId, intervalMs, enabled]);

  return { snapshot, loading, error };
}
