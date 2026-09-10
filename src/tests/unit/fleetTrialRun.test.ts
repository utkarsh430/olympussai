// The states an operator meets while running a trial, and the transitions
// between them.
//
// ─── WHY THIS IS A REDUCER AND NOT JUST useState IN THE CONSOLE ──────────
//
// Three of the five outcomes below cannot be produced by hand on a working
// system. A trial that FAILS needs a spec the route refuses before the trial
// sees it; a request that EXCEEDS ITS OWN BUDGET needs a 32-second run and a
// 30-second deadline; a service that DISAPPEARS mid-run needs the control
// service restarted at the right moment - which is how the captain met it, by
// accident, once. They were therefore the paths nobody ever exercised, and
// they are the ones an operator most needs to be right. Pulling the state out
// of the component is what makes them ordinary to test.
import { describe, it, expect } from 'vitest';
import {
  initialTrialConsoleState,
  trialConsoleReducer,
  elapsedLabel,
  type TrialConsoleState,
} from '@/lib/ops/fleetTrialRun';
import type { FleetTrialReport } from '@/models/fleetTrial';

const REPORT_A = { generatedAt: '2026-09-01T10:00:00.000Z' } as unknown as FleetTrialReport;
const REPORT_B = { generatedAt: '2026-09-02T10:00:00.000Z' } as unknown as FleetTrialReport;

const idle = (report: FleetTrialReport | null = null): TrialConsoleState =>
  initialTrialConsoleState(report);

const running = (report: FleetTrialReport | null = null) =>
  trialConsoleReducer(idle(report), { type: 'run_requested', atMs: 1_000 });

describe('starting a run', () => {
  it('goes from idle to running, and says when it started', () => {
    const state = running();
    expect(state.run.status).toBe('running');
    expect(state.run.status === 'running' && state.run.startedAtMs).toBe(1_000);
  });

  it('keeps the previous report on screen while the next run is in flight', () => {
    // "No flash of empty" starts here, not at the finish: the report a reader
    // was looking at stays until there is a new one to replace it.
    const state = running(REPORT_A);
    expect(state.report).toBe(REPORT_A);
  });

  it('has no progress yet, and does not invent a zero', () => {
    const state = running();
    expect(state.run.status === 'running' && state.run.progress).toBeNull();
  });
});

describe('the double click', () => {
  it('ignores a second Run while one is in flight', () => {
    // THE reported behaviour: thirty seconds of a dead-looking page is long
    // enough that a reasonable person clicks again.
    const first = running(REPORT_A);
    const second = trialConsoleReducer(first, { type: 'run_requested', atMs: 9_999 });
    expect(second).toBe(first);
  });

  it('does not restart the clock when Run is pressed again', () => {
    // A restarted clock is the specific harm: the elapsed time is the only
    // honest thing on screen while a run has reported no progress yet, and a
    // second click would reset it to zero and make a 29-second run look new.
    const first = running();
    const second = trialConsoleReducer(first, { type: 'run_requested', atMs: 9_999 });
    expect(second.run.status === 'running' && second.run.startedAtMs).toBe(1_000);
  });

  it('accepts a new run once the last one finished', () => {
    const done = trialConsoleReducer(running(), {
      type: 'succeeded',
      report: REPORT_A,
      atMs: 5_000,
    });
    const again = trialConsoleReducer(done, { type: 'run_requested', atMs: 6_000 });
    expect(again.run.status).toBe('running');
  });

  it('accepts a new run once the last one failed', () => {
    const failed = trialConsoleReducer(running(), {
      type: 'failed',
      kind: 'failed',
      message: 'the corridor came apart',
    });
    const again = trialConsoleReducer(failed, { type: 'run_requested', atMs: 6_000 });
    expect(again.run.status).toBe('running');
  });
});

describe('progress', () => {
  it('records what the trial says it is doing', () => {
    const state = trialConsoleReducer(running(), {
      type: 'progress',
      progress: { done: 12, total: 437, stage: 'phases', label: 'Phase 1 - Ordinary day' },
    });
    expect(state.run.status === 'running' && state.run.progress).toEqual({
      done: 12,
      total: 437,
      stage: 'phases',
      label: 'Phase 1 - Ordinary day',
    });
  });

  it('IGNORES progress that arrives after the run finished', () => {
    // A poll in flight when the result lands would otherwise put a finished
    // console back into "running" and hide the report the operator waited for.
    const done = trialConsoleReducer(running(), {
      type: 'succeeded',
      report: REPORT_A,
      atMs: 5_000,
    });
    const late = trialConsoleReducer(done, {
      type: 'progress',
      progress: { done: 400, total: 437, stage: 'policy_study', label: 'late' },
    });
    expect(late).toBe(done);
    expect(late.run.status).toBe('succeeded');
  });

  it('ignores progress when nothing was ever started', () => {
    const state = trialConsoleReducer(idle(), {
      type: 'progress',
      progress: { done: 1, total: 2, stage: 'phases', label: 'x' },
    });
    expect(state.run.status).toBe('idle');
  });

  it('never lets the count exceed the total it is counted against', () => {
    // A count past its own denominator is the clearest possible proof the
    // denominator was wrong, and it must not be rendered as though it were
    // fine. Clamped, and the console reads the clamp as "nearly done".
    const state = trialConsoleReducer(running(), {
      type: 'progress',
      progress: { done: 500, total: 437, stage: 'policy_study', label: 'x' },
    });
    expect(state.run.status === 'running' && state.run.progress?.done).toBe(437);
  });
});

describe('finishing', () => {
  it('replaces the report and clears the progress in one step', () => {
    // One transition, so there is no render in which the progress is gone and
    // the new report has not arrived - that gap IS the flash of empty.
    const state = trialConsoleReducer(running(REPORT_A), {
      type: 'succeeded',
      report: REPORT_B,
      atMs: 5_000,
    });
    expect(state.report).toBe(REPORT_B);
    expect(state.run.status).toBe('succeeded');
    expect(state.origin).toBe('this-session');
  });

  it('marks the report as this session own, not a stored one', () => {
    const state = trialConsoleReducer(running(), {
      type: 'succeeded',
      report: REPORT_A,
      atMs: 5_000,
    });
    expect(state.origin).toBe('this-session');
  });
});

describe('the trial failed', () => {
  it('keeps the previous result, and says it is still the previous result', () => {
    // The rule the brief is explicit about: a failed run must cost the reader
    // nothing they already had.
    const state = trialConsoleReducer(running(REPORT_A), {
      type: 'failed',
      kind: 'failed',
      message: 'the corridor came apart',
    });
    expect(state.report).toBe(REPORT_A);
    expect(state.run.status).toBe('failed');
    expect(state.run.status === 'failed' && state.run.message).toContain('the corridor came apart');
  });

  it('does not relabel a stored report as this session own', () => {
    const state = trialConsoleReducer(running(REPORT_A), {
      type: 'failed',
      kind: 'failed',
      message: 'x',
    });
    expect(state.origin).toBe('stored');
  });
});

describe('the service could not be reached', () => {
  it('is its own state, not a generic failure', () => {
    const state = trialConsoleReducer(running(REPORT_A), {
      type: 'failed',
      kind: 'unreachable',
      message: 'The simulator service is temporarily unreachable.',
    });
    expect(state.run.status).toBe('unreachable');
    expect(state.report).toBe(REPORT_A);
  });

  it('ends a run that was in flight when the service disappeared', () => {
    // The captain hit exactly this: the control service was restarting
    // mid-run. A console that kept polling would spin forever.
    const inFlight = trialConsoleReducer(running(), {
      type: 'progress',
      progress: { done: 12, total: 437, stage: 'phases', label: 'x' },
    });
    const gone = trialConsoleReducer(inFlight, {
      type: 'failed',
      kind: 'unreachable',
      message: 'gone',
    });
    expect(gone.run.status).toBe('unreachable');
  });
});

describe('the console gave up waiting', () => {
  it('is NOT the same state as the service being unreachable', () => {
    // Measured: the inter-city preset at 1,000 buses takes about 32 seconds
    // against what was a 30-second budget, so this fired on a service that was
    // healthy and answering. Reporting it as "unreachable" sent a supervisor
    // looking at the wrong machine.
    const timedOut = trialConsoleReducer(running(REPORT_A), {
      type: 'failed',
      kind: 'timed_out',
      message: 'x',
    });
    const unreachable = trialConsoleReducer(running(REPORT_A), {
      type: 'failed',
      kind: 'unreachable',
      message: 'x',
    });
    expect(timedOut.run.status).toBe('timed_out');
    expect(unreachable.run.status).toBe('unreachable');
    expect(timedOut.run.status).not.toBe(unreachable.run.status);
  });

  it('keeps the previous result, because nothing was lost', () => {
    const state = trialConsoleReducer(running(REPORT_A), {
      type: 'failed',
      kind: 'timed_out',
      message: 'x',
    });
    expect(state.report).toBe(REPORT_A);
  });
});

describe('the console has stopped calling', () => {
  it('is a THIRD state, distinct from both unreachable and timed out', () => {
    // The client documented one class as meaning "unreachable, timed out, or
    // circuit open". Three diagnoses, three different next moves: look at the
    // service, wait, or escalate. Collapsed into one message an operator
    // cannot tell which they have.
    const base = running(REPORT_A);
    const statuses = (['unreachable', 'timed_out', 'circuit_open'] as const).map(
      (kind) => trialConsoleReducer(base, { type: 'failed', kind, message: 'x' }).run.status,
    );
    expect(new Set(statuses).size).toBe(3);
    expect(statuses).toEqual(['unreachable', 'timed_out', 'circuit_open']);
  });

  it('keeps the previous result, like every other failure', () => {
    const state = trialConsoleReducer(running(REPORT_A), {
      type: 'failed',
      kind: 'circuit_open',
      message: 'x',
    });
    expect(state.report).toBe(REPORT_A);
    expect(state.origin).toBe('stored');
  });
});

describe('a trial was already running', () => {
  it('is its own state - the run is somebody else, not a failure', () => {
    // Two tabs, or a reload mid-run. Nothing is wrong and nothing was lost;
    // the operator is simply waiting on a run they cannot see the start of.
    const state = trialConsoleReducer(running(REPORT_A), {
      type: 'failed',
      kind: 'already_running',
      message: 'A trial is already running.',
    });
    expect(state.run.status).toBe('already_running');
    expect(state.report).toBe(REPORT_A);
  });
});

describe('elapsedLabel', () => {
  it('counts in seconds while a run is short', () => {
    expect(elapsedLabel(0)).toBe('0s');
    expect(elapsedLabel(12_400)).toBe('12s');
    expect(elapsedLabel(59_000)).toBe('59s');
  });

  it('counts in minutes and seconds once past a minute', () => {
    expect(elapsedLabel(60_000)).toBe('1m 00s');
    expect(elapsedLabel(95_000)).toBe('1m 35s');
  });

  it('never renders a negative elapsed time from a clock that stepped back', () => {
    expect(elapsedLabel(-5_000)).toBe('0s');
  });
});
