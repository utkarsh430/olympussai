'use client';

import { useEffect, useRef } from 'react';
import { useCopilotStore } from '@/stores/copilotStore';
import { LIVE_POLL_INTERVAL_MS } from '@/lib/constants';
import type { LiveFeedResponse } from '@/models/canonical';

/**
 * Polls the server proxy for live UPSRTC GPS data.
 * The browser never touches the upstream PHP endpoint directly.
 */
export function useLiveFleet(): void {
  const setFleet = useCopilotStore((state) => state.setFleet);
  const setFleetError = useCopilotStore((state) => state.setFleetError);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll(): Promise<void> {
      // Abort a still-running request before starting the next tick.
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      try {
        const response = await fetch('/api/upsrtc/live', {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`Live feed responded ${response.status}`);
        const payload = (await response.json()) as LiveFeedResponse;
        if (!cancelled) setFleet(payload);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setFleetError(error instanceof Error ? error.message : 'Live feed unavailable');
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), LIVE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      inFlight.current?.abort();
    };
  }, [setFleet, setFleetError]);
}
