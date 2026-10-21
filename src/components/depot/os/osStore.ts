'use client';

import { create } from 'zustand';

/**
 * Browser-side state of Depot Intelligence OS: the region chosen in the context
 * selector, the sidebar's shape, the copilot dock, the command palette,
 * the entity drawer, and the review trail of AI decisions and fuel-audit cases. Nothing
 * here is sent anywhere: decisions are recorded in this browser for the prototype, and
 * every action stays with a person.
 */

export type EntityRef =
  | { readonly kind: 'vehicle'; readonly id: string; readonly depotId: string | null }
  | { readonly kind: 'depot'; readonly id: string }
  | { readonly kind: 'route'; readonly id: string; readonly depotId?: string | null };

export type ReviewAction = 'approved' | 'rejected' | 'deferred' | 'assigned' | 'escalated';

export interface ReviewRecord {
  readonly decisionId: string;
  readonly title: string;
  readonly scope: string;
  readonly action: ReviewAction;
  readonly note: string;
  /** ISO time the person recorded it, from the browser clock. */
  readonly at: string;
}

export type CaseStatus = 'open' | 'assigned' | 'under_review' | 'explained' | 'referred';

export interface FuelCase {
  readonly journeyId: string;
  readonly status: CaseStatus;
  readonly assignee: string;
  readonly at: string;
}

/** A thing the page has in focus, for the copilot to reason about. */
export interface CopilotFocus {
  readonly kind: 'vehicle' | 'depot' | 'route' | 'incident' | 'journey' | 'decision' | 'scenario';
  readonly id: string;
  readonly label: string;
  /** The address it was set on; a focus from another page is not this page's. */
  readonly path?: string;
}

interface OsState {
  readonly regionId: string | null;
  readonly copilotOpen: boolean;
  readonly paletteOpen: boolean;
  readonly capabilitiesOpen: boolean;
  readonly entity: EntityRef | null;
  readonly focus: CopilotFocus | null;
  /** A question another part of the interface asks the copilot to answer now. */
  readonly pendingQuestion: string | null;
  readonly reviews: readonly ReviewRecord[];
  readonly fuelCases: Readonly<Record<string, FuelCase>>;
  /** The sidebar drawn as an icon rail. */
  readonly navCollapsed: boolean;
  /** Workspaces the person has opened in the sidebar tree, beside the current one. */
  readonly navExpanded: readonly string[];
  /** The sidebar tree as a drawer below 1280px. */
  readonly navDrawerOpen: boolean;
  readonly setNavCollapsed: (collapsed: boolean) => void;
  readonly toggleNavGroup: (workspaceId: string, open: boolean) => void;
  readonly setNavDrawerOpen: (open: boolean) => void;
  readonly clearReviews: () => void;
  readonly clearFuelCases: () => void;
  readonly setRegion: (regionId: string | null) => void;
  readonly setCopilotOpen: (open: boolean) => void;
  readonly askCopilot: (question: string) => void;
  readonly takePendingQuestion: () => string | null;
  readonly setPaletteOpen: (open: boolean) => void;
  readonly setCapabilitiesOpen: (open: boolean) => void;
  readonly openEntity: (entity: EntityRef) => void;
  readonly closeEntity: () => void;
  readonly setFocus: (focus: CopilotFocus | null) => void;
  readonly recordReview: (record: Omit<ReviewRecord, 'at'>) => void;
  readonly clearReview: (decisionId: string) => void;
  readonly setFuelCase: (journeyId: string, status: CaseStatus, assignee: string) => void;
  readonly hydrate: () => void;
}

const KEYS = {
  region: 'depot-os-region-v1',
  copilot: 'depot-os-copilot-v1',
  reviews: 'depot-os-reviews-v1',
  fuelCases: 'depot-os-fuel-cases-v1',
  nav: 'depot-os-nav-v1',
} as const;

const MAX_REVIEWS = 300;

interface NavPrefs {
  readonly collapsed: boolean;
  readonly expanded: readonly string[];
}

const strings = (value: unknown, fallback: readonly string[]): readonly string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 40) : fallback;

function navPrefsOf(state: Pick<OsState, 'navCollapsed' | 'navExpanded'>): NavPrefs {
  return { collapsed: state.navCollapsed, expanded: state.navExpanded };
}

function read<T>(storage: 'local' | 'session', key: string, fallback: T): T {
  try {
    const store = storage === 'local' ? window.localStorage : window.sessionStorage;
    const raw = store.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(storage: 'local' | 'session', key: string, value: unknown): void {
  try {
    const store = storage === 'local' ? window.localStorage : window.sessionStorage;
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows and full storage keep working for this page view.
  }
}

function isReview(value: unknown): value is ReviewRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.decisionId === 'string' && typeof v.action === 'string' && typeof v.at === 'string';
}

export const useOsStore = create<OsState>((set, get) => ({
  regionId: null,
  copilotOpen: false,
  paletteOpen: false,
  capabilitiesOpen: false,
  entity: null,
  focus: null,
  pendingQuestion: null,
  reviews: [],
  fuelCases: {},
  navCollapsed: false,
  navExpanded: [],
  navDrawerOpen: false,
  setNavCollapsed: (navCollapsed) => {
    set({ navCollapsed });
    write('local', KEYS.nav, navPrefsOf(get()));
  },
  toggleNavGroup: (workspaceId, open) => {
    const rest = get().navExpanded.filter((id) => id !== workspaceId);
    set({ navExpanded: open ? [...rest, workspaceId] : rest });
    write('local', KEYS.nav, navPrefsOf(get()));
  },
  setNavDrawerOpen: (navDrawerOpen) => set({ navDrawerOpen }),
  clearReviews: () => {
    write('local', KEYS.reviews, []);
    set({ reviews: [] });
  },
  clearFuelCases: () => {
    write('local', KEYS.fuelCases, {});
    set({ fuelCases: {} });
  },
  setRegion: (regionId) => {
    write('session', KEYS.region, regionId);
    set({ regionId });
  },
  setCopilotOpen: (copilotOpen) => {
    write('local', KEYS.copilot, copilotOpen);
    set({ copilotOpen });
  },
  askCopilot: (question) => {
    write('local', KEYS.copilot, true);
    set({ copilotOpen: true, pendingQuestion: question });
  },
  takePendingQuestion: () => {
    const question = get().pendingQuestion;
    if (question !== null) set({ pendingQuestion: null });
    return question;
  },
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setCapabilitiesOpen: (capabilitiesOpen) => set({ capabilitiesOpen }),
  openEntity: (entity) => set({ entity }),
  closeEntity: () => set({ entity: null }),
  setFocus: (focus) => set({ focus: focus ? { ...focus, path: window.location.pathname } : null }),
  recordReview: (record) => {
    const entry: ReviewRecord = { ...record, at: new Date().toISOString() };
    const reviews = [entry, ...get().reviews.filter((r) => r.decisionId !== record.decisionId)].slice(
      0,
      MAX_REVIEWS,
    );
    write('local', KEYS.reviews, reviews);
    set({ reviews });
  },
  clearReview: (decisionId) => {
    const reviews = get().reviews.filter((r) => r.decisionId !== decisionId);
    write('local', KEYS.reviews, reviews);
    set({ reviews });
  },
  setFuelCase: (journeyId, status, assignee) => {
    const fuelCases = {
      ...get().fuelCases,
      [journeyId]: { journeyId, status, assignee, at: new Date().toISOString() },
    };
    write('local', KEYS.fuelCases, fuelCases);
    set({ fuelCases });
  },
  hydrate: () => {
    const reviews = read<unknown>('local', KEYS.reviews, []);
    const fuelCases = read<unknown>('local', KEYS.fuelCases, {});
    const nav = read<Partial<Record<keyof NavPrefs, unknown>> | null>('local', KEYS.nav, null) ?? {};
    set({
      navCollapsed: nav.collapsed === true,
      navExpanded: strings(nav.expanded, []),
      regionId: read<string | null>('session', KEYS.region, null),
      copilotOpen: read<boolean>('local', KEYS.copilot, false) === true,
      reviews: Array.isArray(reviews) ? reviews.filter(isReview) : [],
      fuelCases:
        typeof fuelCases === 'object' && fuelCases !== null && !Array.isArray(fuelCases)
          ? (fuelCases as Record<string, FuelCase>)
          : {},
    });
  },
}));

/** The latest review recorded for a decision, or null. */
export function useReviewFor(decisionId: string): ReviewRecord | null {
  return useOsStore((state) => state.reviews.find((r) => r.decisionId === decisionId) ?? null);
}
