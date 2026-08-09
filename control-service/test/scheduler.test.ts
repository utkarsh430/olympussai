// The four properties startScheduler() gives every job. None of these is
// defensive garnish - each is a way this process dies without it:
//
//  - OVERLAP SUPPRESSION. An 11.7 MB GPS poll can outlast its own 30 s
//    interval. setInterval does not care: it stacks another run on top,
//    then another, until the pool is starved and the process is out of
//    memory. The `running` flag is what makes a slow job late rather than
//    fatal.
//  - ERROR CONTAINMENT. An unhandled promise rejection terminates modern
//    Node. One failing sweep must not take the HTTP server with it.
//  - STARTUP JITTER. Without it every replica of a multi-instance deploy
//    hits the database on the same tick forever.
//  - unref(). A pending timer must not keep the process alive at shutdown.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startScheduler, type ScheduledJob } from '../src/scheduler/index.js';

/** A job whose completion the test controls. */
function controllableJob(overrides: Partial<ScheduledJob> = {}) {
  const releases: (() => void)[] = [];
  let starts = 0;
  const job: ScheduledJob = {
    name: 'test-job',
    intervalMs: 1000,
    run: () => {
      starts += 1;
      return new Promise<void>((resolve) => releases.push(resolve));
    },
    ...overrides,
  };
  return {
    job,
    get starts() {
      return starts;
    },
    releaseAll: () => {
      for (const release of releases.splice(0)) release();
    },
  };
}

describe('startScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Jitter is the first delay, so pin Math.random to make the first tick
    // land at a known time rather than somewhere in [0, intervalMs).
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('SKIPS a tick while the previous run is still in flight', async () => {
    const controllable = controllableJob({ intervalMs: 1000 });
    const stop = startScheduler([controllable.job]);

    await vi.advanceTimersByTimeAsync(0); // jittered first run
    expect(controllable.starts).toBe(1);

    // Three intervals pass while run #1 is still hanging.
    await vi.advanceTimersByTimeAsync(3000);
    expect(controllable.starts).toBe(1);

    // Once it finishes, the next tick runs normally - suppression must not
    // wedge the job permanently.
    controllable.releaseAll();
    await vi.advanceTimersByTimeAsync(1000);
    expect(controllable.starts).toBe(2);

    stop();
  });

  it('runs on every tick when the job finishes inside its interval', async () => {
    let starts = 0;
    const stop = startScheduler([
      { name: 'fast', intervalMs: 1000, run: () => { starts += 1; return Promise.resolve(); } },
    ]);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(starts).toBe(4); // first run + 3 intervals

    stop();
  });

  it('contains a rejected job: the failure does not escape and the job keeps running', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    let starts = 0;
    const stop = startScheduler([
      {
        name: 'always-fails',
        intervalMs: 1000,
        run: () => {
          starts += 1;
          return Promise.reject(new Error('sweep exploded'));
        },
      },
    ]);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);

    expect(starts).toBe(3);
    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);

    stop();
  });

  it('releases the overlap flag after a FAILED run, not just a successful one', async () => {
    // A `running` flag cleared only on success would permanently wedge a
    // job after its first error - the most insidious version of this bug,
    // because the job silently stops instead of crashing.
    let starts = 0;
    let shouldFail = true;
    const stop = startScheduler([
      {
        name: 'flaky',
        intervalMs: 1000,
        run: () => {
          starts += 1;
          return shouldFail ? Promise.reject(new Error('boom')) : Promise.resolve();
        },
      },
    ]);

    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toBe(1);
    shouldFail = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(starts).toBe(3);

    stop();
  });

  it('jitters the FIRST run inside the interval so replicas de-synchronise', async () => {
    vi.mocked(Math.random).mockReturnValue(0.5);
    let starts = 0;
    const stop = startScheduler([
      { name: 'jittered', intervalMs: 1000, run: () => { starts += 1; return Promise.resolve(); } },
    ]);

    await vi.advanceTimersByTimeAsync(499);
    expect(starts).toBe(0); // still waiting out the jitter
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toBe(1);

    // Subsequent runs follow the fixed interval - the cadence itself is
    // not randomised, only the phase.
    await vi.advanceTimersByTimeAsync(1000);
    expect(starts).toBe(2);

    stop();
  });

  it('isolates jobs from each other: one failing job does not stop the others', async () => {
    let good = 0;
    const stop = startScheduler([
      { name: 'bad', intervalMs: 1000, run: () => Promise.reject(new Error('nope')) },
      { name: 'good', intervalMs: 1000, run: () => { good += 1; return Promise.resolve(); } },
    ]);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(good).toBe(3);

    stop();
  });

  it('stop() halts every job and is idempotent', async () => {
    let starts = 0;
    const stop = startScheduler([
      { name: 'a', intervalMs: 1000, run: () => { starts += 1; return Promise.resolve(); } },
      { name: 'b', intervalMs: 1000, run: () => { starts += 1; return Promise.resolve(); } },
    ]);

    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toBe(2);

    stop();
    stop(); // shutdown() may run twice on SIGTERM+SIGINT
    await vi.advanceTimersByTimeAsync(10_000);
    expect(starts).toBe(2);
  });

  it('stop() before the jittered first run cancels it (no work after shutdown begins)', async () => {
    vi.mocked(Math.random).mockReturnValue(0.9);
    let starts = 0;
    const stop = startScheduler([
      { name: 'late', intervalMs: 1000, run: () => { starts += 1; return Promise.resolve(); } },
    ]);

    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(starts).toBe(0);
  });
});
