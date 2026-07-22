'use client';

import { useEffect, useRef } from 'react';
import { useCopilotStore } from '@/stores/copilotStore';
import { buildInitialAlerts, buildNextAlert } from '@/lib/alerts/alertEngine';

/** New predictive alert cadence. */
const ALERT_INTERVAL_MS = 30_000;

/**
 * Drives the predictive alert feed.
 *
 * Seeds the board with five alerts as soon as live vehicles are available, then
 * raises one new alert every 30 seconds, rotating through the capability set.
 * Each alert is bound to a real vehicle from the current live feed.
 */
export function useAlertStream(): void {
  const seeded = useCopilotStore((state) => state.seededAlerts);
  const pushAlerts = useCopilotStore((state) => state.pushAlerts);
  const advanceAlertRotation = useCopilotStore((state) => state.advanceAlertRotation);
  const busCount = useCopilotStore((state) => state.buses.length);
  const seedGuard = useRef(false);

  // ---- Seed the board on first arrival of live data ----
  useEffect(() => {
    if (seeded || seedGuard.current || busCount === 0) return;
    seedGuard.current = true;

    const { buses } = useCopilotStore.getState();
    const initial = buildInitialAlerts(buses, 5);
    if (initial.length > 0) {
      pushAlerts(initial, true);
      // Continue the rotation after the seeded batch.
      for (let index = 0; index < initial.length; index += 1) advanceAlertRotation();
    }
  }, [busCount, seeded, pushAlerts, advanceAlertRotation]);

  // ---- Raise a new alert every 30s ----
  useEffect(() => {
    const timer = setInterval(() => {
      const state = useCopilotStore.getState();
      if (state.buses.length === 0) return;
      // Pitch Mode drives its own narrative; do not interrupt it with toasts.
      if (state.isPitchMode) return;

      const activeBusIds = new Set(state.alerts.slice(0, 8).map((alert) => alert.busId));
      const alert = buildNextAlert(state.buses, state.alertRotationIndex, activeBusIds);
      if (!alert) return;

      state.pushAlerts([alert]);
      state.advanceAlertRotation();
      state.setAi('Analysing', `${alert.title} — ${alert.registrationNumber}.`);
    }, ALERT_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);
}
