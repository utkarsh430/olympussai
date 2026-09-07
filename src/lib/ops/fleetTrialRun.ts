/**
 * The states an operator meets while a fleet trial runs, and nothing else.
 *
 * ─── WHY THE CONSOLE DOES NOT KEEP THIS IN useState ──────────────────────
 *
 * All four of the ways a run can end without a report are unreachable by hand
 * on a healthy system. A trial that FAILS needs a spec the route refuses
 * before the trial ever sees it; a request that EXCEEDS ITS OWN BUDGET needs a
 * run longer than the deadline watching it; an OPEN CIRCUIT needs three real
 * failures in a row first; and a service that DISAPPEARS mid-run needs the
 * control service restarted at exactly the right moment - which is how the
 * captain met that one, by accident, once. Those are precisely the paths that
 * never get exercised, and precisely the ones where a wrong message costs
 * somebody an hour looking at the wrong machine. Held here, as data, they are
 * ordinary to test; held in a component, they are not tested at all.
 *
 * ─── WHAT THIS FILE REFUSES TO DO ────────────────────────────────────────
 *
 * It does not estimate. There is no percentage, no fraction of a bar, no
 * "about ten seconds remaining" anywhere in it, and `progress` carries a count
 * and a denominator rather than a ratio. The trial's runs are not equal in
 * cost - a phase run carries several times the fleet of a study run - so a
 * share of runs done is NOT a share of the wait, and anything derived from it
 * would be a confident-sounding guess. The console renders the pair through
 * `OpsCoverage`, whose own rule is the same one: a percentage hides the
 * denominator, and the denominator is the honest part.
 *
 * What it offers instead is what is true: which stage, how many runs of how
 * many, and how long the run has been going.
 */
import type { FleetTrialReport } from '@/models/fleetTrial';
import type { TrialOrigin } from './fleetTrialView';

/** The stages a trial reports, mirroring the control service's own vocabulary. */
export type TrialStage =
  | 'phases'
  | 'policy_study'
  | 'occupancy_contrast'
  | 'self_equalizing';

export interface TrialProgress {
  done: number;
  total: number;
  stage: TrialStage;
  label: string;
}

/**
 * Why a run ended without a report.
 *
 * Four kinds, not one, because they have four different fixes and the operator
 * is the person who has to pick one.
 */
export type TrialFailureKind =
  /** The trial itself threw. The service is fine; the run is not. */
  | 'failed'
  /** Nothing answered: the service is down, restarting, or not configured. */
  | 'unreachable'
  /**
   * This process has STOPPED calling, after a measured streak of real
   * failures. Distinct from `unreachable` because retrying achieves nothing
   * until the cooldown elapses - it is the one of the three to escalate.
   */
  | 'circuit_open'
  /**
   * WE gave up, not the service. Distinct from `unreachable` because the
   * service is healthy and probably still working - see the console's copy.
   */
  | 'timed_out'
  /** Somebody else's run is in flight. Nothing is wrong. */
  | 'already_running';

export type TrialRunState =
  | { status: 'idle' }
  | { status: 'running'; startedAtMs: number; progress: TrialProgress | null }
  | { status: 'succeeded' }
  | { status: 'failed'; message: string }
  | { status: 'unreachable'; message: string }
  | { status: 'circuit_open'; message: string }
  | { status: 'timed_out'; message: string }
  | { status: 'already_running'; message: string };

export interface TrialConsoleState {
  /** The report on screen. Only ever replaced by a COMPLETED run. */
  report: FleetTrialReport | null;
  origin: TrialOrigin;
  run: TrialRunState;
}

export type TrialConsoleEvent =
  | { type: 'run_requested'; atMs: number }
  | { type: 'progress'; progress: TrialProgress }
  | { type: 'succeeded'; report: FleetTrialReport; atMs: number }
  | { type: 'failed'; kind: TrialFailureKind; message: string };

export function initialTrialConsoleState(report: FleetTrialReport | null): TrialConsoleState {
  return { report, origin: 'stored', run: { status: 'idle' } };
}

/** The failure kinds, mapped onto the run states that describe them. */
const FAILURE_STATUS: Record<TrialFailureKind, TrialRunState['status']> = {
  failed: 'failed',
  unreachable: 'unreachable',
  circuit_open: 'circuit_open',
  timed_out: 'timed_out',
  already_running: 'already_running',
};

export function trialConsoleReducer(
  state: TrialConsoleState,
  event: TrialConsoleEvent,
): TrialConsoleState {
  switch (event.type) {
    case 'run_requested': {
      // ─── THE DOUBLE CLICK ────────────────────────────────────────────
      //
      // Returned UNCHANGED - the same object, so a render is not even
      // scheduled. The button is disabled too, but that covers one tab and
      // this covers the case at all. Restarting the clock would be its own
      // harm: elapsed time is the only true thing on screen before the first
      // progress arrives, and a second click would reset a 29-second run to
      // zero and make it look new.
      if (state.run.status === 'running') return state;
      return { ...state, run: { status: 'running', startedAtMs: event.atMs, progress: null } };
    }

    case 'progress': {
      // A poll that was in flight when the run ended must not put a finished
      // console back into "running" and hide the report it waited for.
      if (state.run.status !== 'running') return state;
      return {
        ...state,
        run: {
          ...state.run,
          progress: {
            ...event.progress,
            // A count past its own denominator proves the denominator was
            // wrong. Clamped rather than rendered, so the console reads
            // "nearly done" instead of "500 of 437" - and the control
            // service's own test fails if the two ever actually drift.
            done: Math.min(event.progress.done, event.progress.total),
          },
        },
      };
    }

    case 'succeeded': {
      // ONE transition from running to shown. There is no intermediate state
      // in which the progress has gone and the report has not arrived, which
      // is what a flash of empty is made of.
      return { report: event.report, origin: 'this-session', run: { status: 'succeeded' } };
    }

    case 'failed': {
      // The report and its origin are untouched, deliberately. Whatever the
      // reader was looking at is still exactly what they were looking at, and
      // a stored report must not be relabelled as this session's own by a run
      // that produced nothing.
      return {
        ...state,
        run: { status: FAILURE_STATUS[event.kind], message: event.message } as TrialRunState,
      };
    }
  }
}

/**
 * How long a run has been going, in words.
 *
 * Seconds up to a minute, then minutes and seconds. Never negative: the clock
 * is read in the browser and a machine that steps its clock back mid-run would
 * otherwise render a run that started in the future.
 */
export function elapsedLabel(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}
