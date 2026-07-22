'use client';

import { useCallback } from 'react';
import { useCopilotStore } from '@/stores/copilotStore';
import { buildScenario } from '@/lib/simulation/scenarioEngine';
import { selectAlertCandidate } from '@/lib/alerts/alertEngine';

/**
 * Opens the network-wide demand and fleet-redistribution view.
 *
 * Demand is a corridor-level question rather than a per-vehicle one, so this is
 * reachable directly from the command bar. If the operator has not selected a
 * vehicle, a well-populated one is chosen to anchor the corridor — the same
 * selection logic the alert stream uses.
 */
export function useFleetDistribution(): () => void {
  return useCallback(() => {
    const state = useCopilotStore.getState();

    const anchor =
      state.buses.find((bus) => bus.id === state.selectedBusId) ??
      selectAlertCandidate(state.buses, new Set(), 'fleet-distribution');

    if (!anchor) return;

    if (state.selectedBusId !== anchor.id) state.selectBus(anchor.id);

    const scenario = buildScenario('demand', {
      bus: anchor,
      schedule: state.schedule,
      overrides: state.overrides,
    });

    state.setScenario('demand', scenario);
    state.setAi('Recommendation Ready', `Corridor demand profile ready for ${anchor.registrationNumber}.`);
    state.logAudit('scenario-launched', `Fleet distribution reviewed from ${anchor.registrationNumber}`, {
      registrationNumber: anchor.registrationNumber,
    });
  }, []);
}
