// The periodic jobs this process runs, assembled from env.
//
// Kept separate from index.ts (the runner) so the runner's overlap /
// containment / jitter semantics can be tested against trivial fake jobs,
// and so the set of jobs is one readable list rather than four setInterval
// calls scattered through the process entrypoint.
//
//   commandDeliverySweep  COMMAND_DELIVERY_SWEEP_INTERVAL_MS  15 s
//   commandTtlSweep       COMMAND_TTL_SWEEP_INTERVAL_MS       30 s
//   gpsPoll               GPS_POLL_INTERVAL_MS                30 s   (opt-in)
//   headwayCompute        HEADWAY_COMPUTE_INTERVAL_MS         60 s
//   decisionCycle         DECISION_CYCLE_INTERVAL_MS          90 s   (opt-out)
//   incidentStaleness     INCIDENT_STALENESS_SWEEP_INTERVAL_MS 5 min
//   geometryRefresh       SHAPE_CACHE_TTL_MS                  15 min
//   dailyKpiSnapshot      DAILY_KPI_SNAPSHOT_INTERVAL_MS      15 min (opt-out)
//   retentionSweep        RETENTION_SWEEP_INTERVAL_MS          1 h   (opt-out)
//
// commandDeliverySweep and commandTtlSweep never contend for the same
// command: the former's candidate set is `status = 'authorized' and
// expires_at > now()`, the latter's is everything non-terminal already past
// its TTL - disjoint by construction. Array position here has no effect on
// either: startScheduler (./index.ts) gives every job its own randomised
// first run and its own interval.

import type { Env } from '../config/env.js';
import { sweepExpiredCommands } from '../db/commands.js';
import { refreshNetworkCounts } from '../db/rehydrate.js';
import { logger } from '../lib/logger.js';
import { getNetworkGeometryCache } from '../state-estimation/singleton.js';
import { runCommandDeliverySweep } from './commandDeliverySweep.js';
import { runDailyKpiSnapshotSweep } from './dailyKpiSnapshot.js';
import { runGpsPoll } from './gpsPoll.js';
import { runDecisionCycle } from './decisionCycle.js';
import { runHeadwayComputeSweep } from './headwayCompute.js';
import { runIncidentStalenessSweep } from './incidentStalenessSweep.js';
import { runRetentionSweep } from './retention.js';
import type { ScheduledJob } from './index.js';

export function buildJobs(env: Env): ScheduledJob[] {
  const jobs: ScheduledJob[] = [
    {
      // Backstop for the in-process delivery attempt POST /v1/commands and
      // POST /v1/commands/:id/supersede now make right after their own
      // commit (src/commands/deliverAndNotify.ts) - catches a command left
      // in `authorized` by a crash between that commit and the inline
      // attempt, or an inline attempt that threw.
      name: 'commandDeliverySweep',
      intervalMs: env.COMMAND_DELIVERY_SWEEP_INTERVAL_MS,
      run: async () => {
        await runCommandDeliverySweep();
      },
    },
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
      //
      // Also the bounded backstop for /readyz's own network counts
      // (db/rehydrate.ts's refreshNetworkCounts) - see that module for why
      // they ride this job's cadence instead of being recomputed per
      // /readyz request or left to a restart.
      name: 'geometryRefresh',
      intervalMs: env.SHAPE_CACHE_TTL_MS,
      run: async () => {
        const [snapshot, counts] = await Promise.all([
          getNetworkGeometryCache().warm(),
          refreshNetworkCounts(),
        ]);
        logger.debug(
          { version: snapshot.version, shapeCount: snapshot.shapes.length, network: counts },
          'network geometry refreshed on schedule',
        );
      },
    },
  ];

  // Unconditional, unlike retention: this deletes nothing. It ends incidents
  // whose evidence has gone cold, and an instance that skipped it would serve
  // an ever-growing list of bunching alerts that are no longer true - which is
  // worse than a table that grows, because an operator acts on it.
  jobs.push({
    name: 'incidentStaleness',
    intervalMs: env.INCIDENT_STALENESS_SWEEP_INTERVAL_MS,
    run: async () => {
      await runIncidentStalenessSweep(env);
    },
  });

  // Retention, as a PAIR. The snapshot sweep captures each day's KPIs while
  // its raw rows still exist; the retention sweep deletes raw rows only for
  // days already captured. Registering one without the other is either a slow
  // leak (snapshots, no pruning) or silent data loss (pruning, no snapshots),
  // so they are pushed together and gated on the same flag.
  //
  // Array position buys no ordering - startScheduler jitters every job's first
  // run independently - and it does not need to: retention's `exists` guard
  // means losing the race just prunes nothing this hour.
  if (env.RETENTION_ENABLED) {
    jobs.push(
      {
        name: 'dailyKpiSnapshot',
        intervalMs: env.DAILY_KPI_SNAPSHOT_INTERVAL_MS,
        run: async () => {
          await runDailyKpiSnapshotSweep();
        },
      },
      {
        name: 'retentionSweep',
        intervalMs: env.RETENTION_SWEEP_INTERVAL_MS,
        run: async () => {
          await runRetentionSweep(env);
        },
      },
    );
  } else {
    logger.warn(
      'RETENTION_ENABLED is false; observation tables will grow without bound on this instance',
    );
  }

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

  // Opt-out. This is the job that makes the controller answer on its own
  // rather than only when a dispatcher opens the console, so the default is
  // on; the switch exists to return an instance to the previous behaviour.
  //
  // MULTI-REPLICA CAVEAT, stated rather than hidden: the duplicate guard
  // (src/db/recommendations.ts#isMateriallyNewRecommendation) reads the
  // standing proposal and then inserts, so two replicas ticking together can
  // both decide the advice is new and both write it. The consequence is a
  // duplicated row in an operator's history, never a duplicated instruction
  // - this job writes proposals and issues no commands, and every command
  // still needs its own unconsumed dispatcher approval. Run it on one
  // instance, or accept the occasional repeat.
  if (env.DECISION_CYCLE_ENABLED) {
    jobs.push({
      // Closes the loop headwayCompute leaves open. That sweep DETECTS and
      // stops; before this job existed, the only thing that ever asked the
      // controller what to do about it was a dispatcher opening the console
      // on that particular corridor.
      name: 'decisionCycle',
      intervalMs: env.DECISION_CYCLE_INTERVAL_MS,
      run: async () => {
        await runDecisionCycle(env);
      },
    });
  } else {
    logger.info(
      'DECISION_CYCLE_ENABLED is false; recommendations will only exist for a corridor a dispatcher is looking at',
    );
  }

  return jobs;
}
