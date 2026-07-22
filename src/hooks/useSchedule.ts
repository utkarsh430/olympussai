'use client';

import { useEffect, useRef } from 'react';
import { useCopilotStore } from '@/stores/copilotStore';
import type { ScheduleResponse } from '@/models/canonical';

/**
 * Fetches the UPSRTC schedule ONLY for the currently selected bus.
 * Never bulk-fetches schedules for the whole fleet.
 */
export function useSchedule(): void {
  const selectedBusId = useCopilotStore((state) => state.selectedBusId);
  /**
   * The upstream keys schedules on the trip's operating date, so the vehicle's
   * own scheduled_start_time date is sent rather than today's — an overnight
   * service still runs under the date it departed.
   */
  const tripDate = useCopilotStore(
    (state) => state.buses.find((bus) => bus.id === state.selectedBusId)?.tripDate ?? null,
  );
  /**
   * A day's response lists every journey the bus runs, each restarting its stop
   * sequence at 1. The live vehicle_journey_id picks out the one it is on.
   */
  const tripId = useCopilotStore(
    (state) => state.buses.find((bus) => bus.id === state.selectedBusId)?.tripId ?? null,
  );
  const setSchedule = useCopilotStore((state) => state.setSchedule);
  const setLoadingSchedule = useCopilotStore((state) => state.setLoadingSchedule);
  const logAudit = useCopilotStore((state) => state.logAudit);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!selectedBusId) return;

    // Cancel any outstanding request for a previously selected bus.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    let cancelled = false;
    setLoadingSchedule(true);

    async function load(): Promise<void> {
      try {
        const query = new URLSearchParams({ regNum: selectedBusId as string });
        if (tripDate) query.set('date', tripDate);
        if (tripId) query.set('tripId', tripId);

        const response = await fetch(`/api/upsrtc/schedule?${query.toString()}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const payload = (await response.json()) as ScheduleResponse;
        if (cancelled) return;

        setSchedule(payload.schedule, payload.message ?? null, payload.source);
        logAudit(
          'schedule-fetched',
          payload.schedule
            ? `Live UPSRTC schedule retrieved for ${selectedBusId}`
            : `No UPSRTC schedule assigned for ${selectedBusId}`,
          { registrationNumber: selectedBusId ?? undefined, simulated: false },
        );
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setSchedule(null, 'Schedule service unavailable. Live GPS remains active.', 'error');
      }
    }

    void load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedBusId, tripDate, tripId, setSchedule, setLoadingSchedule, logAudit]);
}
