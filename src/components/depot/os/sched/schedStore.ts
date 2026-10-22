'use client';

import { create } from 'zustand';
import type { BusParams, CrewParams } from '@/lib/depot/os/sched/types';

/*
 * The schedulers' state in this browser: scenarios a person saved (their parameters and
 * headline figures, to reload and regenerate), and the latest result of each scheduler
 * per depot, so the copilot and the workspace ribbon quote the plan on screen. A saved
 * scenario is a plan to review; nothing here is dispatched to a bus or a crew.
 */

export type SchedKind = 'bus' | 'crew' | 'joint';

export interface SavedScenario {
  readonly id: string;
  readonly kind: SchedKind;
  readonly depotId: string;
  readonly depotName: string;
  readonly date: string;
  readonly label: string;
  readonly busParams: BusParams;
  readonly crewParams: CrewParams | null;
  /** Headline figures at save time, e.g. `{ covered: 244, buses: 69 }`. */
  readonly figures: Readonly<Record<string, number>>;
  readonly savedAt: string;
}

export interface LatestResult {
  readonly kind: SchedKind;
  readonly depotId: string;
  readonly date: string;
  readonly label: string;
  readonly figures: Readonly<Record<string, number>>;
  /** One sentence on what the plan does against the original. */
  readonly summary: string;
  /** The bus parameters the plan was made under, so the crew scheduler rosters the same duties. */
  readonly busParams?: BusParams;
  readonly at: number;
}

const KEY = 'depot-os-sched-scenarios-v1';
const MAX_SAVED = 40;

function readSaved(): SavedScenario[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((s): s is SavedScenario => typeof s === 'object' && s !== null && typeof (s as SavedScenario).id === 'string') : [];
  } catch {
    return [];
  }
}

function writeSaved(saved: readonly SavedScenario[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Kept for this page view.
  }
}

interface SchedState {
  readonly saved: readonly SavedScenario[];
  readonly latest: Readonly<Record<string, LatestResult>>;
  readonly hydrated: boolean;
  readonly hydrate: () => void;
  readonly save: (scenario: Omit<SavedScenario, 'id' | 'savedAt'>) => void;
  readonly remove: (id: string) => void;
  readonly clear: () => void;
  readonly setLatest: (result: Omit<LatestResult, 'at'>) => void;
}

export const latestKey = (kind: SchedKind, depotId: string): string => `${kind}:${depotId}`;

export const useSchedStore = create<SchedState>((set, get) => ({
  saved: [],
  latest: {},
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ saved: readSaved(), hydrated: true });
  },
  save: (scenario) => {
    const entry: SavedScenario = { ...scenario, id: `${scenario.kind}-${scenario.depotId}-${Date.now().toString(36)}`, savedAt: new Date().toISOString() };
    const saved = [entry, ...get().saved].slice(0, MAX_SAVED);
    writeSaved(saved);
    set({ saved });
  },
  remove: (id) => {
    const saved = get().saved.filter((s) => s.id !== id);
    writeSaved(saved);
    set({ saved });
  },
  clear: () => {
    writeSaved([]);
    set({ saved: [] });
  },
  setLatest: (result) => set({ latest: { ...get().latest, [latestKey(result.kind, result.depotId)]: { ...result, at: Date.now() } } }),
}));
