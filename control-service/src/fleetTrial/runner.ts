// Who owns the trial that is running right now.
//
// ─── WHY A TRIAL CANNOT SIMPLY BE CALLED ON THE REQUEST ──────────────────
//
// `runFleetTrial` is SYNCHRONOUS and, on the inter-city preset at 1,000 buses
// per phase, takes about thirty seconds. Called on the Express request it
// blocks the event loop for all of them: this process answers nothing at all
// while a trial runs - not the progress it is being asked for, not `/healthz`,
// not another console's read. So the interesting question is not "how do we
// report progress" but "how does anything get a word in", and the answer has
// to move the work off this thread before any reporting is possible.
//
// A worker thread is the smallest thing that does it. The trial is a pure
// computation over a plain-object spec that returns a plain-object report -
// no database handle, no socket, no shared memory - so it is exactly the shape
// `postMessage` can carry, and it runs in the worker byte-for-byte as it runs
// here. `runFleetTrial` itself is untouched by this file.
//
// ─── ONE AT A TIME, AND WHY REFUSING IS KINDER THAN QUEUEING ─────────────
//
// A second trial started while one is in flight is almost always a double
// click on a console that looked dead. Running it would put two CPU-bound
// thirty-second jobs on one box, and - worse - the second would take over the
// progress the first was reporting, so the operator would watch a count that
// belongs to a run they did not knowingly start. Queueing it is no better: it
// makes them wait a minute for a result they asked for by accident.
//
// So a second start is REFUSED, loudly, and the caller is told a trial is
// already running. That is a state the console can render honestly.
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { FleetTrialSpec, FleetTrialReportWithLifecycle } from './run.js';
import type { FleetTrialProgress, FleetTrialProgressReporter } from './progress.js';

/** Raised when a trial is asked for while one is already running. */
export class TrialAlreadyRunningError extends Error {
  constructor() {
    super('A fleet trial is already running in this process.');
    this.name = 'TrialAlreadyRunningError';
  }
}

/**
 * What a caller can be told about the trial running right now.
 *
 * `total` is nullable and that is the point: between "the worker has started"
 * and "the worker has finished its first run" the total is not yet known here,
 * and reporting `0 of 0` would be a made-up denominator - the one thing this
 * whole path exists to avoid. Null means "not yet said", which the console
 * renders as elapsed time alone.
 */
export interface TrialProgressSnapshot {
  runId: string;
  done: number;
  total: number | null;
  stage: FleetTrialProgress['stage'] | null;
  label: string | null;
  /** Epoch milliseconds. The caller computes elapsed against its own clock. */
  startedAtMs: number;
}

/**
 * How a trial is actually run. Substituted in tests.
 *
 * The default spawns a worker; a test that spawned one could not produce a
 * trial that fails, or one that is still running, on demand - and those are
 * the two states this module exists to get right.
 */
export type TrialJobFactory = (
  spec: FleetTrialSpec,
  onProgress: FleetTrialProgressReporter,
) => Promise<FleetTrialReportWithLifecycle>;

/**
 * Where the worker's entry file is, in whichever way this service is running.
 *
 * `new Worker(path)` is given a real path by Node and gets none of the
 * module resolution the rest of this file enjoys, so the usual `./worker.js`
 * specifier - which `tsx` and the TypeScript compiler both understand to mean
 * the `.ts` beside it - resolves to a file that does not exist when running
 * from source. Both forms are looked for, nearest first: `dist/` has only the
 * compiled `.js`, a source tree has only the `.ts`, so exactly one is present
 * either way and the choice is not ambiguous.
 */
function workerEntry(): { path: string; needsTypeScriptLoader: boolean } {
  const compiled = fileURLToPath(new URL('./worker.js', import.meta.url));
  if (existsSync(compiled)) return { path: compiled, needsTypeScriptLoader: false };
  return {
    path: fileURLToPath(new URL('./worker.ts', import.meta.url)),
    needsTypeScriptLoader: true,
  };
}

const spawnWorker: TrialJobFactory = (spec, onProgress) =>
  new Promise((resolve, reject) => {
    const entry = workerEntry();
    const worker = new Worker(entry.path, {
      workerData: spec,
      // A worker gets a bare Node, not this process's module hooks, so one
      // started on a `.ts` entry needs the loader registered again to resolve
      // the `.js` specifiers TypeScript sources are written with. `tsx` is a
      // devDependency and is only ever reached on this branch, which is the
      // branch that cannot happen in a deployed `dist/`.
      ...(entry.needsTypeScriptLoader ? { execArgv: ['--import', 'tsx'] } : {}),
    });
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
      void worker.terminate();
    };

    worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'progress') onProgress(message.progress);
      else if (message.type === 'done') settle(() => resolve(message.report));
      else settle(() => reject(new Error(message.message)));
    });
    // A worker that dies without saying why - an out-of-memory kill, most
    // likely, a trial being the largest allocation this service makes. Silence
    // here would leave the caller waiting on a promise nothing will settle.
    worker.on('error', (error) => settle(() => reject(error)));
    worker.on('exit', (code) =>
      settle(() =>
        reject(new Error(`The trial stopped unexpectedly before finishing (exit code ${code}).`)),
      ),
    );
  });

export type WorkerMessage =
  | { type: 'progress'; progress: FleetTrialProgress }
  | { type: 'done'; report: FleetTrialReportWithLifecycle }
  | { type: 'error'; message: string };

let jobFactory: TrialJobFactory = spawnWorker;
let inFlight: TrialProgressSnapshot | null = null;

export function isTrialRunning(): boolean {
  return inFlight !== null;
}

/** The trial running right now, or null when none is. */
export function currentProgress(): TrialProgressSnapshot | null {
  return inFlight === null ? null : { ...inFlight };
}

export function startTrial(spec: FleetTrialSpec): {
  runId: string;
  done: Promise<FleetTrialReportWithLifecycle>;
} {
  if (inFlight !== null) throw new TrialAlreadyRunningError();

  const runId = randomUUID();
  const snapshot: TrialProgressSnapshot = {
    runId,
    done: 0,
    total: null,
    stage: null,
    label: null,
    startedAtMs: Date.now(),
  };
  inFlight = snapshot;

  // Cleared on BOTH outcomes. A failed trial that left the runner latched
  // would need a restart to clear, so one bad run would cost everybody the
  // console until somebody noticed.
  const clear = () => {
    if (inFlight === snapshot) inFlight = null;
  };

  const done = jobFactory(spec, (progress) => {
    // Guarded against a late message from a run that is no longer the current
    // one: a terminated worker can still have a message in flight.
    if (inFlight !== snapshot) return;
    snapshot.done = progress.done;
    snapshot.total = progress.total;
    snapshot.stage = progress.stage;
    snapshot.label = progress.label;
  }).then(
    (report) => {
      clear();
      return report;
    },
    (error: unknown) => {
      clear();
      throw error;
    },
  );

  return { runId, done };
}

/** Exported for tests, which must run neither a worker nor a real trial. */
export function _setTrialJobFactoryForTests(factory: TrialJobFactory): void {
  jobFactory = factory;
}

/** Exported for tests, which must not inherit a run an earlier test started. */
export function _resetTrialRunnerForTests(): void {
  inFlight = null;
  jobFactory = spawnWorker;
}
