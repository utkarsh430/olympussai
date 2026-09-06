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
//
// ─── WHERE THESE ROWS GO ─────────────────────────────────────────────────
//
// For most of this file's life: nowhere. The rows it wrote were read by this
// cycle's own dedupe fingerprint and by nothing else - no route served the
// table and no console fetched it - so the loop above closed the DECISION gap
// and left the DELIVERY gap wide open, and everything a dispatcher saw still
// came from the synchronous solve they took by opening a corridor themselves.
//
// `GET /v1/recommendations` (src/routes/recommendations.ts, behind
// RECOMMENDATION_FEED_ENABLED) is the reader that closes it. Two consequences
// for anything changed here. What this cycle writes is now something a person
// can see, so a row written for a corridor is a row an operator may act on the
// existence of - though never the CONTENT of, because the feed serves a
// summary and not the approvable candidates. And the feed's window is
// DECISION_CYCLE_REPEAT_AFTER_SECONDS, the same value
// `isMateriallyNewRecommendation` uses below: changing how often unchanged
// advice is re-written also changes how long a proposal is treated as
// standing.
import { loadEnv, type Env } from '../config/env.js';
import {
  listOpenIncidentPairsForRouteDirection,
  listRouteDirectionsWithLiveHeadwayPairs,
} from '../headway/repository.js';
import {
  findLatestRecommendation,
  insertRecommendation,
  isMateriallyNewRecommendation,
  paceSignature,
} from '../db/recommendations.js';
import { logger } from '../lib/logger.js';
import { solve } from '../mpc/solver.js';
import { loadInBandRouteDirectionIds } from '../evaluation/eligibilityRepository.js';
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
  /** Corridors the cycle would solve for - AFTER the eligibility gate, when it is on. */
  eligible: number;
  attempted: number;
  /** Corridors where the solver produced a safe, selectable action. */
  withAction: number;
  /**
   * Corridors carrying pace advice on the row written for them.
   *
   * Counted separately from `withAction` because easing a bus off is not a
   * selectable action and never competes with one - a corridor can have both,
   * either, or neither. Always 0 while
   * PACE_GUIDANCE_ON_DECISION_CYCLE_ENABLED is false.
   */
  withPaceAdvisory: number;
  /**
   * Proposals actually written, minus the ones that repeated standing advice.
   *
   * Not simply `withAction` minus repeats: a corridor with no hold worth
   * making but a bus worth easing off writes a row and is counted here
   * without ever being counted in `withAction`.
   */
  proposed: number;
  failed: number;
  /**
   * Corridors the eligibility gate removed before the batch was cut. Always 0
   * with the gate off, and 0 when the band lookup failed - the gate fails OPEN.
   */
  gateExcluded: number;
  durationMs: number;
}

export interface DecisionCycleDeps {
  listEligible?: (freshnessSeconds: number) => Promise<string[]>;
  /** Of the corridors offered, the ones inside `CONTROLLABLE_BAND`. Only consulted when the gate is on. */
  listInBand?: (routeDirectionIds: readonly string[]) => Promise<Set<string>>;
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
 * WHERE the controller is allowed to run, when the operator has asked for the
 * question to be asked at all.
 *
 * Three properties, each of which the gate is worthless without:
 *
 *   OFF IS A TRUE NO-OP. With `DECISION_CYCLE_ELIGIBILITY_GATE_ENABLED` unset
 *   this returns the offered list untouched and never issues the query. A gate
 *   that costs a round trip per sweep while claiming to be off is not off.
 *
 *   IT FAILS OPEN. A database hiccup must not silence the controller
 *   network-wide; the failure is logged and the sweep runs on everything, which
 *   is exactly today's behaviour.
 *
 *   IT DECIDES NOTHING ABOUT HOW. The band comes from `lib/controllability.ts`
 *   and no control law is consulted, changed, or aware of this.
 */
async function applyEligibilityGate(
  env: Env,
  offered: readonly string[],
  listInBand: DecisionCycleDeps['listInBand'],
): Promise<{ eligible: string[]; gateExcluded: number }> {
  if (!env.DECISION_CYCLE_ELIGIBILITY_GATE_ENABLED) {
    return { eligible: [...offered], gateExcluded: 0 };
  }

  const lookup =
    listInBand ??
    ((ids: readonly string[]) =>
      loadInBandRouteDirectionIds(
        ids,
        {
          cruiseSpeedKmph: env.ELIGIBILITY_CRUISE_SPEED_KMPH,
          travelTimeVariation: env.ELIGIBILITY_TRAVEL_TIME_VARIATION,
          provenance: 'modelled',
        },
        env.HEADWAY_VEHICLE_FRESHNESS_SECONDS,
      ));

  try {
    const inBand = await lookup(offered);
    const eligible = offered.filter((id) => inBand.has(id));
    return { eligible, gateExcluded: offered.length - eligible.length };
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), offered: offered.length },
      'eligibility gate could not read the controllability band; running on every eligible corridor',
    );
    return { eligible: [...offered], gateExcluded: 0 };
  }
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
  const offered = await listEligible(env.HEADWAY_VEHICLE_FRESHNESS_SECONDS);
  const { eligible, gateExcluded } = await applyEligibilityGate(env, offered, deps.listInBand);

  // The gate runs BEFORE the batch is cut, which is the whole point of it.
  // Filtering afterwards would still spend the batch's slots on corridors
  // holding cannot help, and the corridors it can help would keep waiting.
  const { batch, nextCursor } = selectBatch(eligible, cursor, env.DECISION_CYCLE_BATCH_SIZE);
  cursor = nextCursor;

  let withAction = 0;
  let withPaceAdvisory = 0;
  let proposed = 0;
  let failed = 0;

  await mapWithConcurrency(batch, env.DECISION_CYCLE_CONCURRENCY, async (routeDirectionId) => {
    try {
      const result = await solveRouteDirection(routeDirectionId);
      const selected = result.selectedAction;

      // Pace advice is carried only when the flag says so. With it off this
      // is always empty, every predicate below reduces to what it was
      // before, and the sweep writes exactly the rows it wrote before.
      //
      // It is READ from a solve that computed it either way: paceGuidance
      // runs on every solve and the control room already renders it for the
      // corridor a dispatcher is looking at. The flag governs whether this
      // automatic sweep writes it down, not whether it is worked out.
      const paceAdvisories = env.PACE_GUIDANCE_ON_DECISION_CYCLE_ENABLED
        ? (result.paceAdvisories ?? [])
        : [];

      // No safe candidate is the ordinary, healthy answer: the corridor is
      // evenly spaced, or every candidate was rejected by the hard safety
      // filter. Either way there is nothing to propose, and writing a row
      // saying so would fill the operator's history with non-events.
      //
      // Pace advice is the one exception, and it is the case this sweep was
      // most blind to. A bus running EARLY and closing on its leader is
      // routinely refused a hold - holding it would breach the lateness
      // bound, or the cap makes the hold pointless - and is exactly the bus
      // that should ease off. Returning here whenever no hold was selected
      // threw away the only advice that corridor had, every 90 seconds,
      // forever.
      if (!selected && paceAdvisories.length === 0) return;
      if (selected) withAction += 1;

      const latest = await findLatest(routeDirectionId);
      const isNew = isMateriallyNewRecommendation(
        latest,
        {
          selectedActionType: result.selectedActionType,
          vehicleId: selected?.vehicleId ?? null,
          holdSeconds: selected?.holdSeconds ?? null,
          paceSignature: paceSignature(paceAdvisories),
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
      // For a pace-only row there is no selected vehicle to attach by, so
      // fall back to the bus the advice is about. Same rule either way:
      // attach to the incident about THIS vehicle or to none at all, never
      // to whichever incident on the corridor happened to be open.
      const subjectVehicleId = selected?.vehicleId ?? paceAdvisories[0]?.vehicleId ?? null;
      const incidentId =
        subjectVehicleId === null
          ? null
          : (openPairs.find((pair) => pair.followerVehicleId === subjectVehicleId)?.id ?? null);

      await insert({
        routeDirectionId,
        incidentId,
        // `safeCandidates` regardless: on a pace-only row this is the empty
        // list the solver returned, and the advisory goes in its own field.
        // Putting it here instead would disguise it as a hold and would be
        // read back as the selected action by findLatestRecommendation.
        candidateActions: result.safeCandidates,
        selectedActionType: result.selectedActionType,
        objectiveCost: result.objectiveCost,
        expectedRecoverySeconds: result.expectedRecoverySeconds,
        constraints: result.constraints,
        controllerVersion: result.controllerVersion,
        paceAdvisories,
      });
      proposed += 1;
      if (paceAdvisories.length > 0) withPaceAdvisory += 1;
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
    withPaceAdvisory,
    proposed,
    failed,
    gateExcluded,
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
