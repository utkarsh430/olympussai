// The four periodic jobs this process runs, assembled from env.
//
// Kept separate from index.ts (the runner) so the runner's overlap /
// containment / jitter semantics can be tested against trivial fake jobs,
// and so the set of jobs is one readable list rather than four setInterval
// calls scattered through the process entrypoint.
//
//   commandTtlSweep  COMMAND_TTL_SWEEP_INTERVAL_MS  30 s
//   gpsPoll          GPS_POLL_INTERVAL_MS           30 s   (opt-in)
//   headwayCompute   HEADWAY_COMPUTE_INTERVAL_MS    60 s
//   geometryRefresh  SHAPE_CACHE_TTL_MS             15 min

import type { Env } from '../config/env.js';
import { sweepExpiredCommands } from '../db/commands.js';
import { logger } from '../lib/logger.js';
import { getNetworkGeometryCache } from '../state-estimation/singleton.js';
import { runGpsPoll } from './gpsPoll.js';
import { runHeadwayComputeSweep } from './headwayCompute.js';
import type { ScheduledJob } from './index.js';

export function buildJobs(env: Env): ScheduledJob[] {
  const jobs: ScheduledJob[] = [
    {
      // Backstop TTL sweep (command lifecycle AC: "expired commands never
      // delivered/executed"). deliverCommand/acknowledgeCommand already
      // expire lazily on access; this catches commands nobody happens to
      // touch so they don't sit in an active status indefinitely.
      name: 'commandTtlSweep',
      intervalMs: env.COMMAND_TTL_SWEEP_INTERVAL_MS,
      run: async () => {
        const expired = await sweepExpiredCommands();
        if (expired.length > 0) {
          logger.info(
            { count: expired.length, commandIds: expired.map((c) => c.id) },
            'ttl sweep expired stale commands',
          );
        }
      },
    },
    {
      name: 'headwayCompute',
      intervalMs: env.HEADWAY_COMPUTE_INTERVAL_MS,
      run: async () => {
        await runHeadwayComputeSweep(env);
      },
    },
    {
      // Proactive refresh so the 15-minute TTL is (almost) never the thing
      // that expires a snapshot on the hot path. The cache is still
      // stale-while-revalidate underneath, so a failure here degrades to
      // "serve the old geometry", not "block ingestion".
      name: 'geometryRefresh',
      intervalMs: env.SHAPE_CACHE_TTL_MS,
      run: async () => {
        const snapshot = await getNetworkGeometryCache().warm();
        logger.debug(
          { version: snapshot.version, shapeCount: snapshot.shapes.length },
          'network geometry refreshed on schedule',
        );
      },
    },
  ];

  // Opt-in, because the upstream feed is global: every replica that polls
  // ingests the same ~665 fixes. Exactly one instance should have this on.
  if (env.GPS_POLL_ENABLED) {
    jobs.push({
      name: 'gpsPoll',
      intervalMs: env.GPS_POLL_INTERVAL_MS,
      run: async () => {
        await runGpsPoll(env);
      },
    });
  } else {
    logger.info('GPS_POLL_ENABLED is false; this instance will not poll the upstream GPS feed');
  }

  return jobs;
}
