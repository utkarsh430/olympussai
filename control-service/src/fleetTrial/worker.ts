// The trial, on a thread of its own.
//
// This file exists so the service can answer while a trial runs - see
// `runner.ts` for why that is not possible on the request thread. It is
// deliberately the thinnest possible wrapper: it receives a spec, calls
// `runFleetTrial` with it, and posts what comes back. Nothing about the trial
// is configured, adapted or re-derived here, because anything this file
// decided would be a difference between what the console measures and what
// `pnpm sim:fleet` measures.
//
// The trial reads no database, opens no socket and holds no handle, so the
// worker needs none of the service's environment. That is what makes running
// it here safe rather than merely convenient.
import { parentPort, workerData } from 'node:worker_threads';
import { runFleetTrial } from './run.js';
import type { FleetTrialSpec } from './run.js';
import type { WorkerMessage } from './runner.js';

const port = parentPort;
if (!port) throw new Error('fleetTrial worker was started outside a worker thread');

const post = (message: WorkerMessage) => port.postMessage(message);

try {
  const report = runFleetTrial(workerData as FleetTrialSpec, (progress) =>
    post({ type: 'progress', progress }),
  );
  post({ type: 'done', report });
} catch (error) {
  // The spec is validated at the route before it reaches here, so a throw is
  // a genuine failure of the trial rather than a bad request. It is reported
  // as a message rather than left to the 'error' event so the operator gets
  // the trial's own words - "1,000 buses across 19 scenarios leaves fewer than
  // 2 per run" is actionable; "worker exited" is not.
  post({
    type: 'error',
    message: error instanceof Error ? error.message : 'The trial failed for an unknown reason.',
  });
}
