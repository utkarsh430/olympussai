// Minimal periodic-job runner. Deliberately no cron dependency: every job
// here is "every N milliseconds", which setInterval already expresses, and
// the existing command-TTL sweep in index.ts was already written this way.
// A cron library would add a dependency, a parser, and a second concept of
// time for zero gain.
//
// Four properties every job gets, each of which is a real failure mode
// rather than defensive garnish:
//
//  - OVERLAP SUPPRESSION. An 11.7 MB GPS poll can take longer than its own
//    30 s interval. Without a per-job `running` flag, setInterval keeps
//    stacking runs on top of each other until the process dies of memory
//    exhaustion or connection-pool starvation.
//  - ERROR CONTAINMENT. A rejected job promise that nobody catches is an
//    unhandled rejection, which on modern Node terminates the process. One
//    failing sweep must never take the HTTP server down with it.
//  - STARTUP JITTER. The first run is scheduled at a random point inside
//    the interval, so a multi-instance deploy doesn't have every replica
//    hitting the database on the same tick.
//  - unref(). A pending timer must not by itself keep the process alive
//    during shutdown.

import { logger } from '../lib/logger.js';
import { Sentry } from '../telemetry/sentry.js';

export interface ScheduledJob {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
}

/**
 * Starts every job and returns a stop function that clears all of their
 * timers. The stop function is idempotent.
 */
export function startScheduler(jobs: readonly ScheduledJob[]): () => void {
  const timers: NodeJS.Timeout[] = [];

  for (const job of jobs) {
    let running = false;

    const tick = (): void => {
      if (running) {
        logger.warn(
          { job: job.name, intervalMs: job.intervalMs },
          'scheduled job still running from the previous tick; skipping this one',
        );
        return;
      }
      running = true;
      const startedAt = Date.now();
      job
        .run()
        .then(() => {
          logger.debug({ job: job.name, durationMs: Date.now() - startedAt }, 'scheduled job completed');
        })
        .catch((err: unknown) => {
          logger.error({ err, job: job.name, durationMs: Date.now() - startedAt }, 'scheduled job failed');
          Sentry.captureException(err);
        })
        .finally(() => {
          running = false;
        });
    };

    // Jitter the FIRST run only; subsequent runs follow the fixed
    // interval. Spreading the first tick is what de-synchronises replicas
    // without making the cadence itself unpredictable.
    const firstDelay = Math.floor(job.intervalMs * Math.random());
    const startTimer = setTimeout(() => {
      tick();
      const interval = setInterval(tick, job.intervalMs);
      interval.unref();
      timers.push(interval);
    }, firstDelay);
    startTimer.unref();
    timers.push(startTimer);

    logger.info({ job: job.name, intervalMs: job.intervalMs, firstRunInMs: firstDelay }, 'scheduled job registered');
  }

  return () => {
    for (const timer of timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    timers.length = 0;
  };
}

export { buildJobs } from './jobs.js';
