/**
 * The user-initiated loader of route profiles for one depot. Each route is one lookup on
 * the upstream route-details service, so the loader is deliberately slow: one lookup at a
 * time, in order, never in parallel; on a 429 it waits the `Retry-After` time (counting
 * down in whole seconds) and retries the same route; it can be cancelled; it never starts
 * by itself; and one press loads at most `PROFILE_LOAD_CAP` routes. The fetch and the
 * timer are injected, so the sequencing is tested without a network or a clock.
 */

/** The most routes one press looks up. */
export const PROFILE_LOAD_CAP = 40;
/** A route still refused after this many pauses counts as not read, and the loader moves on. */
export const MAX_PAUSES_PER_ROUTE = 3;
const SECOND_MS = 1000;

export const UPSTREAM_COST = 'Each route is one lookup on the route-details service.';
export const PLAN_FOLLOWS = 'The plan will include the new profiles within half a minute.';

export type LookupOutcome =
  | { readonly kind: 'loaded' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'limited'; readonly retryAfterSeconds: number }
  | { readonly kind: 'failed' };

export type LoaderPhase = 'idle' | 'running' | 'paused' | 'cancelled' | 'done';

export interface LoaderProgress {
  readonly phase: LoaderPhase;
  readonly total: number;
  /** Routes looked up so far, whatever the answer. */
  readonly looked: number;
  /** Looked up, but the feed had no stops for the route. */
  readonly empty: number;
  /** Looked up, but the answer could not be read. */
  readonly failed: number;
  /** Seconds left in a pause, while paused. */
  readonly pausedSeconds: number | null;
}

export const INITIAL_PROGRESS: LoaderProgress = {
  phase: 'idle',
  total: 0,
  looked: 0,
  empty: 0,
  failed: 0,
  pausedSeconds: null,
};

export interface LoaderDeps {
  readonly lookup: (routeName: string, signal: AbortSignal) => Promise<LookupOutcome>;
  /** Resolves after `ms`, or early when the signal aborts. */
  readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly onProgress: (progress: LoaderProgress) => void;
  /**
   * A route whose lookup answered (details loaded, or the feed has no stops for it). Only
   * these are done; a failed, refused or cancelled route is still to load.
   */
  readonly onAnswered?: (routeName: string) => void;
}

function counted(p: LoaderProgress, outcome: LookupOutcome): LoaderProgress {
  return {
    ...p,
    phase: 'running',
    pausedSeconds: null,
    looked: p.looked + 1,
    empty: p.empty + (outcome.kind === 'empty' ? 1 : 0),
    failed: p.failed + (outcome.kind === 'failed' || outcome.kind === 'limited' ? 1 : 0),
  };
}

/** Counts down a pause one second at a time; false when cancelled during it. */
async function pause(
  seconds: number,
  progress: LoaderProgress,
  deps: LoaderDeps,
  signal: AbortSignal,
): Promise<boolean> {
  for (let left = Math.max(1, seconds); left > 0; left -= 1) {
    deps.onProgress({ ...progress, phase: 'paused', pausedSeconds: left });
    await deps.wait(SECOND_MS, signal);
    if (signal.aborted) return false;
  }
  return true;
}

/** Looks up each route in turn; resolves with the final progress (done or cancelled). */
export async function runProfileLoader(
  routeNames: readonly string[],
  deps: LoaderDeps,
  signal: AbortSignal,
): Promise<LoaderProgress> {
  const names = routeNames.slice(0, PROFILE_LOAD_CAP);
  let progress: LoaderProgress = { ...INITIAL_PROGRESS, phase: 'running', total: names.length };
  deps.onProgress(progress);
  for (const name of names) {
    let pauses = 0;
    for (;;) {
      if (signal.aborted) return finish({ ...progress, phase: 'cancelled' }, deps);
      const outcome = await deps.lookup(name, signal);
      if (outcome.kind === 'limited' && pauses < MAX_PAUSES_PER_ROUTE && !signal.aborted) {
        pauses += 1;
        if (!(await pause(outcome.retryAfterSeconds, progress, deps, signal))) {
          return finish({ ...progress, phase: 'cancelled', pausedSeconds: null }, deps);
        }
        continue;
      }
      progress = counted(progress, outcome);
      if (outcome.kind === 'loaded' || outcome.kind === 'empty') deps.onAnswered?.(name);
      deps.onProgress(progress);
      break;
    }
  }
  const phase: LoaderPhase = signal.aborted ? 'cancelled' : 'done';
  return finish({ ...progress, phase }, deps);
}

function finish(progress: LoaderProgress, deps: LoaderDeps): LoaderProgress {
  deps.onProgress(progress);
  return progress;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function countLine(p: LoaderProgress): string {
  const parts = [`${p.looked} of ${p.total} loaded`];
  if (p.empty > 0) parts.push(`${p.empty} had no stops in the feed`);
  if (p.failed > 0) parts.push(`${p.failed} could not be read`);
  return `${parts.join(', ')}.`;
}

/** The progress in words, for a `role="status"` line. */
export function progressSentence(p: LoaderProgress): string {
  switch (p.phase) {
    case 'idle':
      return '';
    case 'paused':
      return `Paused: too many lookups; resuming in ${plural(p.pausedSeconds ?? 0, 'second', 'seconds')}. ${p.looked} of ${p.total} loaded.`;
    case 'cancelled':
      return `Cancelled: ${countLine(p)}`;
    case 'done':
      return `Done: ${countLine(p)} ${PLAN_FOLLOWS}`;
    default:
      return countLine(p);
  }
}

/** The routes one press would look up: those without a profile, at most the cap. */
export function routesToLoad(
  routes: readonly { readonly routeName: string; readonly profiled: boolean }[],
): readonly string[] {
  return routes
    .filter((r) => !r.profiled)
    .slice(0, PROFILE_LOAD_CAP)
    .map((r) => r.routeName);
}

/** The button's words; the depot is the select beside it, the cost is in its `title`. */
export function loadButtonLabel(routes: number): string {
  return `Load route details: ${plural(routes, 'lookup', 'lookups')}`;
}
