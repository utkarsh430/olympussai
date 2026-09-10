// The thing that owns a running trial: one at a time, what it is doing now,
// and what happens when it fails.
//
// Every test here injects its own job instead of spawning the real worker.
// That is not only for speed - it is the only way to exercise the paths that
// matter. A trial that THROWS and a trial that is still running are both
// states an operator meets and neither can be produced on demand by running
// the real thing.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  startTrial,
  currentProgress,
  isTrialRunning,
  TrialAlreadyRunningError,
  _setTrialJobFactoryForTests,
  _resetTrialRunnerForTests,
} from '../../src/fleetTrial/runner.js';
import { DEFAULT_FLEET_TRIAL_SPEC } from '../../src/fleetTrial/run.js';
import type { FleetTrialProgressReporter } from '../../src/fleetTrial/progress.js';
import type { FleetTrialReportWithLifecycle } from '../../src/fleetTrial/run.js';

const SPEC = { ...DEFAULT_FLEET_TRIAL_SPEC, vehiclesPerPhase: 12 };

/** A stand-in report. Nothing here reads its contents; identity is enough. */
const REPORT = { generatedAt: 'x', durationMs: 1 } as unknown as FleetTrialReportWithLifecycle;

/**
 * A job the test drives by hand: it reports what the test tells it to and
 * finishes when the test says so.
 */
function controllableJob() {
  let report!: FleetTrialProgressReporter;
  let settle!: (outcome: { ok: true } | { ok: false; error: Error }) => void;
  const factory = (_spec: unknown, onProgress: FleetTrialProgressReporter) => {
    report = onProgress;
    return new Promise<FleetTrialReportWithLifecycle>((resolve, reject) => {
      settle = (outcome) => (outcome.ok ? resolve(REPORT) : reject(outcome.error));
    });
  };
  return {
    factory,
    progress: (done: number, total: number, label = 'a run') =>
      report({ done, total, stage: 'phases', label }),
    finish: () => settle({ ok: true }),
    fail: (message: string) => settle({ ok: false, error: new Error(message) }),
  };
}

beforeEach(() => {
  _resetTrialRunnerForTests();
});

describe('one trial at a time', () => {
  it('refuses a second trial while one is in flight, rather than starting it', async () => {
    // THE double-click. Two 30-second CPU-bound trials on one box is the
    // lesser harm; the greater one is that the second would overwrite the
    // first's progress and the operator would watch a bar that belongs to a
    // run they did not start.
    const job = controllableJob();
    _setTrialJobFactoryForTests(job.factory);

    const first = startTrial(SPEC);
    expect(() => startTrial(SPEC)).toThrow(TrialAlreadyRunningError);

    job.finish();
    await expect(first.done).resolves.toBe(REPORT);
  });

  it('starts exactly one trial no matter how many times Run is pressed', async () => {
    let started = 0;
    const job = controllableJob();
    _setTrialJobFactoryForTests((spec, onProgress) => {
      started++;
      return job.factory(spec, onProgress);
    });

    const first = startTrial(SPEC);
    for (let i = 0; i < 5; i++) expect(() => startTrial(SPEC)).toThrow(TrialAlreadyRunningError);
    expect(started).toBe(1);

    job.finish();
    await first.done;
  });

  it('accepts a new trial once the last one finished', async () => {
    const first = controllableJob();
    _setTrialJobFactoryForTests(first.factory);
    const a = startTrial(SPEC);
    first.finish();
    await a.done;

    const second = controllableJob();
    _setTrialJobFactoryForTests(second.factory);
    expect(() => startTrial(SPEC)).not.toThrow();
    second.finish();
  });

  it('accepts a new trial once the last one FAILED', async () => {
    // A failed trial that left the runner latched busy would need a service
    // restart to clear - the failure mode where one bad run costs everybody
    // the console until somebody notices.
    const first = controllableJob();
    _setTrialJobFactoryForTests(first.factory);
    const a = startTrial(SPEC);
    first.fail('the corridor came apart');
    await expect(a.done).rejects.toThrow('the corridor came apart');

    const second = controllableJob();
    _setTrialJobFactoryForTests(second.factory);
    expect(() => startTrial(SPEC)).not.toThrow();
    second.finish();
  });
});

describe('what a running trial says about itself', () => {
  it('has no progress before anything has been started', () => {
    expect(currentProgress()).toBeNull();
    expect(isTrialRunning()).toBe(false);
  });

  it('reports the latest run the trial finished, and its own run id', async () => {
    const job = controllableJob();
    _setTrialJobFactoryForTests(job.factory);
    const started = startTrial(SPEC);

    expect(isTrialRunning()).toBe(true);
    // Started, but nothing has finished a run yet: a real state, and it is
    // NOT "0 of 0" - the total is known, the count is not yet anything.
    expect(currentProgress()).toMatchObject({ runId: started.runId, done: 0, total: null });

    job.progress(7, 437, 'Phase 1 - Ordinary day');
    expect(currentProgress()).toMatchObject({
      runId: started.runId,
      done: 7,
      total: 437,
      label: 'Phase 1 - Ordinary day',
    });

    job.finish();
    await started.done;
  });

  it('says how long it has been running, from a clock the caller can read', async () => {
    const job = controllableJob();
    _setTrialJobFactoryForTests(job.factory);
    const started = startTrial(SPEC);
    const progress = currentProgress();
    expect(progress?.startedAtMs).toBeTypeOf('number');
    expect(progress!.startedAtMs).toBeLessThanOrEqual(Date.now());
    job.finish();
    await started.done;
  });

  it('stops reporting progress once the trial is done', async () => {
    // Progress that outlives its run is progress about nothing, and on this
    // console it would sit under a finished report describing the run that
    // produced it.
    const job = controllableJob();
    _setTrialJobFactoryForTests(job.factory);
    const started = startTrial(SPEC);
    job.progress(7, 437);
    job.finish();
    await started.done;

    expect(currentProgress()).toBeNull();
    expect(isTrialRunning()).toBe(false);
  });

  it('stops reporting progress once the trial FAILED', async () => {
    const job = controllableJob();
    _setTrialJobFactoryForTests(job.factory);
    const started = startTrial(SPEC);
    job.progress(7, 437);
    job.fail('boom');
    await expect(started.done).rejects.toThrow('boom');

    expect(currentProgress()).toBeNull();
    expect(isTrialRunning()).toBe(false);
  });

  it('gives every run a distinct id, so progress cannot be read against the wrong run', async () => {
    const a = controllableJob();
    _setTrialJobFactoryForTests(a.factory);
    const first = startTrial(SPEC);
    a.finish();
    await first.done;

    const b = controllableJob();
    _setTrialJobFactoryForTests(b.factory);
    const second = startTrial(SPEC);
    expect(second.runId).not.toBe(first.runId);
    b.finish();
    await second.done;
  });
});

describe('the real worker', () => {
  // The tests above all inject a fake job, which is the only way to produce a
  // failing or a mid-flight trial on demand - but it means none of them ever
  // loads the worker. This one does, so that "the worker file resolves, starts
  // and posts back" is not a property discovered in production. The spec is
  // the smallest one the trial will accept.
  it('runs a real trial off the request thread and reports its progress', async () => {
    _resetTrialRunnerForTests();
    const tiny = {
      ...DEFAULT_FLEET_TRIAL_SPEC,
      vehiclesPerPhase: 6,
      scenarios: ['steady_variability', 'slow_bus'],
    } as unknown as typeof DEFAULT_FLEET_TRIAL_SPEC;

    const started = startTrial(tiny);
    const report = await started.done;

    expect(report.phases).toHaveLength(2);
    expect(report.vehiclesSimulated).toBe(12);
    // And it let go of the runner afterwards, so the next Run is accepted.
    expect(currentProgress()).toBeNull();
    expect(isTrialRunning()).toBe(false);
  }, 30_000);
});
