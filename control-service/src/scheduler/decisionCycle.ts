// The decision cycle: asks the controller what should be done, on a timer,
// for every corridor that currently has buses close enough together to
// reason about.
//
// ─── THE GAP THIS CLOSES ─────────────────────────────────────────────────
//
// Detection was automatic and the decision was not. `headwayCompute` sweeps
// every 60 s, computes headway, opens `bunching_incidents` - and stops.
// `mpc/solve` was reachable from exactly one place: a dispatcher opening the
// control room, which calls it for the one corridor on screen. A corridor
// coming apart at 03:00, or simply one nobody happened to be looking at,
// generated an incident that no controller ever answered.
//
// That is fatal for the strategy this system is built on. Bunching is a
// geometric instability - h_next ~= (1 + beta x lambda) x h - so a 30 s
// correction at the third stop prevents a ten-minute gap at the twentieth.
// The total delay spent across a trip is far LOWER when the correction comes
// early, which is why acting early improves punctuality and even spacing at
// the same time instead of trading one for the other. A loop that waits for
// a human to go looking can only ever act late, and a late correction is a
// large one.
//
// ─── WHAT IT DOES NOT DO ─────────────────────────────────────────────────
//
// It does not issue commands. Every row it writes is `status = 'proposed'`
// and reaches a bus only if a dispatcher approves it through the existing
// approval path. See src/db/recommendations.ts's header. Nothing here
// imports the command or webhook modules, and that should stay true.
import { loadEnv, type Env } from '../config/env.js';
import {
  listOpenIncidentPairsForRouteDirection,
  listRouteDirectionsWithLiveHeadwayPairs,
} from '../headway/repository.js';
import {
  findLatestRecommendation,
  insertRecommendation,
  isMateriallyNewRecommendation,
} from '../db/recommendations.js';
import { logger } from '../lib/logger.js';
import { solve } from '../mpc/solver.js';
import { selectBatch } from './headwayCompute.js';

/**
 * Round-robin cursor, module-level for the same reason `headwayCompute`'s
 * is: consecutive sweeps must advance through the eligible set rather than
 * re-solving the head of the list forever while the tail is never visited.
 * Kept separate from that sweep's cursor on purpose - the two run at
 * different intervals over sets that only mostly overlap, and sharing one
 * would make each one's coverage depend on the other's timing.
 */
let cursor: string | null = null;

/** Test-only: rewind the round-robin cursor. */
export function _resetDecisionCursorForTests(): void {
  cursor = null;
}

export interface DecisionCycleResult {
  eligible: number;
  attempted: number;
  /** Corridors where the solver produced a safe, selectable action. */
  withAction: number;
  /** Proposals actually written - `withAction` minus the ones that repeated standing advice. */
  proposed: number;
  failed: number;
  durationMs: number;
}

export interface DecisionCycleDeps {
  listEligible?: (freshnessSeconds: number) => Promise<string[]>;
  solveRouteDirection?: typeof solve;
  listOpenIncidentPairs?: typeof listOpenIncidentPairsForRouteDirection;
  findLatest?: typeof findLatestRecommendation;
  insert?: typeof insertRecommendation;
  now?: () => number;
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await worker(items[index]!);
    }
  });
  await Promise.all(runners);
}

/**
 * One decision sweep.
 *
 * Never rejects for a single corridor's failure, for the same reason the
 * headway sweep does not: a corridor with no active policy throws a 404, and
 * one unconfigured route must not stop the controller answering for the rest.
 */
export async function runDecisionCycle(
  env: Env = loadEnv(),
  deps: DecisionCycleDeps = {},
): Promise<DecisionCycleResult> {
  const now = deps.now ?? Date.now;
  const listEligible = deps.listEligible ?? listRouteDirectionsWithLiveHeadwayPairs;
  const solveRouteDirection = deps.solveRouteDirection ?? solve;
  const listOpenIncidentPairs = deps.listOpenIncidentPairs ?? listOpenIncidentPairsForRouteDirection;
  const findLatest = deps.findLatest ?? findLatestRecommendation;
  const insert = deps.insert ?? insertRecommendation;

  const startedAt = now();
  // The same eligibility predicate the headway sweep uses: corridors with at
  // least two fresh, map-matched vehicles. Anything else cannot produce a
  // leader/follower pair, so the solver would have nothing to reason from.
  const eligible = await listEligible(env.HEADWAY_VEHICLE_FRESHNESS_SECONDS);
  const { batch, nextCursor } = selectBatch(eligible, cursor, env.DECISION_CYCLE_BATCH_SIZE);
  cursor = nextCursor;

  let withAction = 0;
  let proposed = 0;
  let failed = 0;

  await mapWithConcurrency(batch, env.DECISION_CYCLE_CONCURRENCY, async (routeDirectionId) => {
    try {
      const result = await solveRouteDirection(routeDirectionId);
      const selected = result.selectedAction;

      // No safe candidate is the ordinary, healthy answer: the corridor is
      // evenly spaced, or every candidate was rejected by the hard safety
      // filter. Either way there is nothing to propose, and writing a row
      // saying so would fill the operator's history with non-events.
      if (!selected) return;
      withAction += 1;

      const latest = await findLatest(routeDirectionId);
      const isNew = isMateriallyNewRecommendation(
        latest,
        {
          selectedActionType: result.selectedActionType,
          vehicleId: selected.vehicleId,
          holdSeconds: selected.holdSeconds,
        },
        new Date(now()),
        env.DECISION_CYCLE_REPEAT_AFTER_SECONDS,
      );
      if (!isNew) return;

      // Attach to the open incident about THIS vehicle, not merely one on
      // the same corridor. A busy corridor can have several open at once,
      // and a proposal filed against the wrong one would put the right
      // advice next to the wrong evidence in an incident review.
      //
      // Null is normal, and is the EARLY case this sweep exists for: drift
      // the controller can still correct cheaply has not yet crossed the
      // detection thresholds, so no incident exists to attach to.
      const openPairs = await listOpenIncidentPairs(routeDirectionId);
      const incidentId =
        openPairs.find((pair) => pair.followerVehicleId === selected.vehicleId)?.id ?? null;

      await insert({
        routeDirectionId,
        incidentId,
        candidateActions: result.safeCandidates,
        selectedActionType: result.selectedActionType,
        objectiveCost: result.objectiveCost,
        expectedRecoverySeconds: result.expectedRecoverySeconds,
        constraints: result.constraints,
        controllerVersion: result.controllerVersion,
      });
      proposed += 1;
    } catch (error) {
      failed += 1;
      logger.warn(
        { routeDirectionId, error: error instanceof Error ? error.message : String(error) },
        'decision cycle failed for one route-direction; sweep continues',
      );
    }
  });

  const result: DecisionCycleResult = {
    eligible: eligible.length,
    attempted: batch.length,
    withAction,
    proposed,
    failed,
    durationMs: now() - startedAt,
  };

  if (eligible.length > env.DECISION_CYCLE_BATCH_SIZE) {
    logger.warn(
      { ...result, batchSize: env.DECISION_CYCLE_BATCH_SIZE },
      'decision cycle batch smaller than the eligible set; some corridors wait extra cycles for a decision',
    );
  } else if (proposed > 0) {
    logger.info(result, 'decision cycle wrote recommendations');
  }

  return result;
}
