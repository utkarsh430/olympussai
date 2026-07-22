'use client';

import { create } from 'zustand';
import type { CanonicalLiveBus, CanonicalSchedule, LiveFeedResponse } from '@/models/canonical';
import type { ScenarioKind, ScenarioOverrides } from '@/lib/demo-scenarios/types';
import type { AnyScenario } from '@/lib/simulation/scenarioEngine';
import type { CommunicationState } from '@/lib/demo-scenarios/communicationScenario';
import {
  appendAuditEvent,
  clearAuditLog,
  readAuditLog,
  writeAuditLog,
  type AuditEvent,
  type AuditEventType,
} from '@/lib/audit/auditLog';
import type { AiState } from '@/lib/constants';
import type { FleetAlert } from '@/lib/alerts/alertEngine';

export interface FleetFilters {
  search: string;
  depot: string;
  route: string;
  quality: 'all' | 'good' | 'degraded' | 'stale';
}

export interface DiagnosticsSnapshot {
  lastFetchAt: string | null;
  source: LiveFeedResponse['source'] | null;
  stale: boolean;
  recordCount: number;
  rejectedRecordCount: number;
  normalizedCount: number;
  error: string | null;
  scheduleError: string | null;
  scheduleSource: string | null;
}

interface CopilotState {
  buses: CanonicalLiveBus[];
  feedMeta: DiagnosticsSnapshot;
  isLoadingFleet: boolean;

  selectedBusId: string | null;
  schedule: CanonicalSchedule | null;
  scheduleMessage: string | null;
  isLoadingSchedule: boolean;

  filters: FleetFilters;

  activeScenario: AnyScenario | null;
  activeScenarioKind: ScenarioKind | null;
  overrides: ScenarioOverrides;

  communicationState: CommunicationState | null;
  isMessageModalOpen: boolean;
  isCallActive: boolean;

  aiState: AiState;
  aiLine: string;

  isPitchMode: boolean;
  pitchStep: number;
  isScenarioLabOpen: boolean;
  isDiagnosticsOpen: boolean;
  isImpactOpen: boolean;
  isAuditOpen: boolean;

  auditEvents: AuditEvent[];

  /** Predictive alert feed, anchored to real vehicles. */
  alerts: FleetAlert[];
  alertRotationIndex: number;
  toastQueue: FleetAlert[];
  seededAlerts: boolean;

  pushAlerts: (alerts: FleetAlert[], seeded?: boolean) => void;
  advanceAlertRotation: () => void;
  acknowledgeAlert: (id: string) => void;
  dismissAlert: (id: string) => void;
  dismissToast: (id: string) => void;
  clearAlerts: () => void;

  setFleet: (response: LiveFeedResponse) => void;
  setFleetError: (message: string) => void;
  setLoadingFleet: (loading: boolean) => void;

  selectBus: (busId: string | null) => void;
  setSchedule: (schedule: CanonicalSchedule | null, message: string | null, source: string) => void;
  setLoadingSchedule: (loading: boolean) => void;

  setFilters: (patch: Partial<FleetFilters>) => void;

  setScenario: (kind: ScenarioKind | null, scenario: AnyScenario | null) => void;
  setOverrides: (patch: Partial<ScenarioOverrides>) => void;
  resetOverrides: () => void;

  setCommunicationState: (state: CommunicationState | null) => void;
  setMessageModalOpen: (open: boolean) => void;
  setCallActive: (active: boolean) => void;

  setAi: (state: AiState, line?: string) => void;

  setPitchMode: (active: boolean) => void;
  setPitchStep: (step: number) => void;
  toggleScenarioLab: (open?: boolean) => void;
  toggleDiagnostics: (open?: boolean) => void;
  toggleImpact: (open?: boolean) => void;
  toggleAudit: (open?: boolean) => void;

  logAudit: (
    type: AuditEventType,
    summary: string,
    options?: { registrationNumber?: string; simulated?: boolean; detail?: string },
  ) => void;
  hydrateAudit: () => void;
  clearAudit: () => void;

  resetDemonstration: () => void;
}

const initialFilters: FleetFilters = { search: '', depot: 'all', route: 'all', quality: 'all' };

const initialMeta: DiagnosticsSnapshot = {
  lastFetchAt: null,
  source: null,
  stale: false,
  recordCount: 0,
  rejectedRecordCount: 0,
  normalizedCount: 0,
  error: null,
  scheduleError: null,
  scheduleSource: null,
};

export const useCopilotStore = create<CopilotState>((set, get) => ({
  buses: [],
  feedMeta: initialMeta,
  isLoadingFleet: true,

  selectedBusId: null,
  schedule: null,
  scheduleMessage: null,
  isLoadingSchedule: false,

  filters: initialFilters,

  activeScenario: null,
  activeScenarioKind: null,
  overrides: {},

  communicationState: null,
  isMessageModalOpen: false,
  isCallActive: false,

  aiState: 'Listening',
  aiLine: 'Fleet telemetry synchronized.',

  isPitchMode: false,
  pitchStep: 0,
  isScenarioLabOpen: false,
  isDiagnosticsOpen: false,
  isImpactOpen: false,
  isAuditOpen: false,

  auditEvents: [],

  alerts: [],
  alertRotationIndex: 0,
  toastQueue: [],
  seededAlerts: false,

  pushAlerts: (incoming, seeded = false) =>
    set((state) => ({
      // Newest first, capped so a long session cannot grow without bound.
      alerts: [...incoming, ...state.alerts].slice(0, 40),
      // Seeded alerts populate the board silently; only live arrivals toast.
      toastQueue: seeded ? state.toastQueue : [...incoming, ...state.toastQueue].slice(0, 3),
      seededAlerts: seeded ? true : state.seededAlerts,
    })),

  advanceAlertRotation: () => set((state) => ({ alertRotationIndex: state.alertRotationIndex + 1 })),

  acknowledgeAlert: (id) =>
    set((state) => ({
      alerts: state.alerts.map((alert) =>
        alert.id === id ? { ...alert, acknowledged: true } : alert,
      ),
      toastQueue: state.toastQueue.filter((alert) => alert.id !== id),
    })),

  dismissAlert: (id) =>
    set((state) => ({
      alerts: state.alerts.filter((alert) => alert.id !== id),
      toastQueue: state.toastQueue.filter((alert) => alert.id !== id),
    })),

  dismissToast: (id) =>
    set((state) => ({ toastQueue: state.toastQueue.filter((alert) => alert.id !== id) })),

  clearAlerts: () => set({ alerts: [], toastQueue: [], alertRotationIndex: 0, seededAlerts: false }),

  setFleet: (response) =>
    set({
      buses: response.buses,
      isLoadingFleet: false,
      feedMeta: {
        ...get().feedMeta,
        lastFetchAt: response.fetchedAt,
        source: response.source,
        stale: response.stale,
        recordCount: response.recordCount,
        rejectedRecordCount: response.rejectedRecordCount,
        normalizedCount: response.buses.length,
        error: null,
      },
    }),

  setFleetError: (message) =>
    set({
      isLoadingFleet: false,
      feedMeta: { ...get().feedMeta, error: message },
    }),

  setLoadingFleet: (loading) => set({ isLoadingFleet: loading }),

  selectBus: (busId) =>
    set({
      selectedBusId: busId,
      // A new selection invalidates the previous bus's schedule and scenario.
      schedule: null,
      scheduleMessage: null,
      activeScenario: null,
      activeScenarioKind: null,
      communicationState: null,
    }),

  setSchedule: (schedule, message, source) =>
    set({
      schedule,
      scheduleMessage: message,
      isLoadingSchedule: false,
      feedMeta: { ...get().feedMeta, scheduleSource: source, scheduleError: message },
    }),

  setLoadingSchedule: (loading) => set({ isLoadingSchedule: loading }),

  setFilters: (patch) => set({ filters: { ...get().filters, ...patch } }),

  setScenario: (kind, scenario) =>
    set({
      activeScenarioKind: kind,
      activeScenario: scenario,
      communicationState: scenario ? 'suggestion-generated' : null,
      aiState: scenario ? 'Recommendation Ready' : 'Monitoring',
    }),

  setOverrides: (patch) => set({ overrides: { ...get().overrides, ...patch } }),
  resetOverrides: () => set({ overrides: {} }),

  setCommunicationState: (state) => set({ communicationState: state }),
  setMessageModalOpen: (open) => set({ isMessageModalOpen: open }),
  setCallActive: (active) => set({ isCallActive: active }),

  setAi: (state, line) => set({ aiState: state, ...(line ? { aiLine: line } : {}) }),

  // Entering Pitch Mode always starts from a clean stage: any scenario, drawer
  // or modal left open from manual exploration would otherwise sit under the
  // opening caption, which is meant to show the bare fleet map.
  setPitchMode: (active) =>
    set(
      active
        ? {
            isPitchMode: true,
            pitchStep: 0,
            selectedBusId: null,
            schedule: null,
            scheduleMessage: null,
            activeScenario: null,
            activeScenarioKind: null,
            communicationState: null,
            isMessageModalOpen: false,
            isCallActive: false,
            isImpactOpen: false,
            isScenarioLabOpen: false,
            isDiagnosticsOpen: false,
            isAuditOpen: false,
          }
        : { isPitchMode: false, pitchStep: 0 },
    ),
  setPitchStep: (step) => set({ pitchStep: step }),
  toggleScenarioLab: (open) => set({ isScenarioLabOpen: open ?? !get().isScenarioLabOpen }),
  toggleDiagnostics: (open) => set({ isDiagnosticsOpen: open ?? !get().isDiagnosticsOpen }),
  toggleImpact: (open) => set({ isImpactOpen: open ?? !get().isImpactOpen }),
  toggleAudit: (open) => set({ isAuditOpen: open ?? !get().isAuditOpen }),

  logAudit: (type, summary, options) => {
    const next = appendAuditEvent(get().auditEvents, {
      type,
      summary,
      registrationNumber: options?.registrationNumber,
      simulated: options?.simulated ?? true,
      detail: options?.detail,
    });
    writeAuditLog(next);
    set({ auditEvents: next });
  },

  hydrateAudit: () => set({ auditEvents: readAuditLog() }),

  clearAudit: () => set({ auditEvents: clearAuditLog() }),

  resetDemonstration: () =>
    set({
      activeScenario: null,
      activeScenarioKind: null,
      overrides: {},
      communicationState: null,
      isMessageModalOpen: false,
      isCallActive: false,
      isPitchMode: false,
      pitchStep: 0,
      aiState: 'Listening',
      aiLine: 'Demonstration reset. Fleet telemetry synchronized.',
    }),
}));

/** Derived selector: the currently selected canonical bus, if any. */
export function useSelectedBus(): CanonicalLiveBus | null {
  return useCopilotStore((state) => {
    if (!state.selectedBusId) return null;
    return state.buses.find((bus) => bus.id === state.selectedBusId) ?? null;
  });
}
