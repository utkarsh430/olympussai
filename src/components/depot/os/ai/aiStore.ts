'use client';

import { create } from 'zustand';
import type { ActivityDraft, Findings } from '@/lib/depot/os/intel/analysis';

/**
 * The AI engine's state in this browser: the analysis cycle's schedule, its last
 * findings, and the activity stream the cycles have written. Every entry is something a
 * cycle actually computed; the stream is kept for this tab only.
 */

export interface ActivityEvent extends ActivityDraft {
  readonly id: string;
  /** Browser time the cycle ran, ms. */
  readonly at: number;
  readonly cycle: number;
  readonly scopeLabel: string;
}

/** A step of an analysis or optimisation the person started, shown as it completes. */
export interface WorkStep {
  readonly label: string;
  readonly state: 'pending' | 'running' | 'done' | 'failed';
  /** What the step found, once done. */
  readonly result?: string;
}

/** Cycle intervals the Settings page offers; 0 pauses the cycle. */
export const CYCLE_CHOICES: readonly number[] = [0, 30, 60, 120];
export const DEFAULT_CYCLE_SEC = 30;
const MAX_EVENTS = 160;
const CYCLE_KEY = 'depot-os-ai-cycle-v1';

interface AiState {
  readonly cycle: number;
  readonly intervalSec: number;
  readonly lastRunAt: number | null;
  readonly nextRunAt: number | null;
  readonly lastDurationMs: number | null;
  readonly running: boolean;
  readonly findings: Findings | null;
  readonly events: readonly ActivityEvent[];
  /** Bumped to ask the engine for a cycle now. */
  readonly runRequest: number;
  readonly setIntervalSec: (sec: number) => void;
  readonly requestRun: () => void;
  readonly setRunning: (running: boolean) => void;
  readonly record: (result: { readonly findings: Findings; readonly drafts: readonly ActivityDraft[]; readonly at: number; readonly durationMs: number; readonly scopeLabel: string }) => void;
  readonly scheduleNext: (at: number | null) => void;
  readonly clearEvents: () => void;
  readonly hydrate: () => void;
}

export const useAiStore = create<AiState>((set, get) => ({
  cycle: 0,
  intervalSec: DEFAULT_CYCLE_SEC,
  lastRunAt: null,
  nextRunAt: null,
  lastDurationMs: null,
  running: false,
  findings: null,
  events: [],
  runRequest: 0,
  setIntervalSec: (intervalSec) => {
    try {
      window.localStorage.setItem(CYCLE_KEY, String(intervalSec));
    } catch {
      // The choice still holds for this page view.
    }
    set({ intervalSec });
  },
  requestRun: () => set({ runRequest: get().runRequest + 1 }),
  setRunning: (running) => set({ running }),
  record: ({ findings, drafts, at, durationMs, scopeLabel }) => {
    const cycle = get().cycle + 1;
    const fresh = drafts.map((d, i) => ({ ...d, id: `${cycle}:${i}:${d.key}`, at, cycle, scopeLabel }));
    set({
      cycle,
      findings,
      lastRunAt: at,
      lastDurationMs: durationMs,
      running: false,
      events: [...fresh.reverse(), ...get().events].slice(0, MAX_EVENTS),
    });
  },
  scheduleNext: (nextRunAt) => set({ nextRunAt }),
  clearEvents: () => set({ events: [] }),
  hydrate: () => {
    try {
      const raw = Number(window.localStorage.getItem(CYCLE_KEY));
      if (CYCLE_CHOICES.includes(raw) && window.localStorage.getItem(CYCLE_KEY) !== null) set({ intervalSec: raw });
    } catch {
      // Default cycle.
    }
  },
}));
