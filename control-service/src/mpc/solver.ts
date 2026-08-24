// Decision engine entry point: computes a hold/skip recommendation for
// one route-direction cycle from the rehydrated state (blueprint 8.x
// control hierarchy, 9.1 decision cycle). Orchestrates, in priority
// order:
//   1. Terminal dispatch regulation (terminalDispatch.ts) - default first
//      line, blueprint 8.1/8.2.
//   2. Two-way holding (twoWayHold.ts), falling back per-pair to
//      self-equalizing (selfEqualizing.ts) where two-way's inputs are
//      unavailable - blueprint 8.3/8.4.
//   3. The hard safety filter (safety.ts) - stale state, max-hold cap
//      breach, conflicting active commands - blueprint 9.1 step 5.
//   4. The occupancy-weighted MPC advisory (occupancyMpc.ts), labelled
//      PREDICTIVE - blueprint 8.6.
// Every call is wrapped in the `mpc.solve` Sentry span the deployment
// dashboards are built against.
import { withSpan } from '../telemetry/sentry.js';
import { stateStore, type VehicleStateRow } from '../state/store.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { listActiveVehicleIds, listRecentlyCommandedVehicleIds } from '../db/commands.js';
import {
  computeTerminalDispatchCandidates,
  departureHeadwaySeconds,
  isAtTerminal,
} from './terminalDispatch.js';
import { computeTwoWayCandidates } from './twoWayHold.js';
import { computeCostOptimalCandidates } from './costOptimalHold.js';
import {
  computeBoardingLimitCandidates,
  isBoardingLimitCandidate,
  type BoardingLimitCandidate,
} from './boardingLimit.js';
import { readControlSettings } from '../db/settings.js';
import { loadEnv } from '../config/env.js';
import { computeSelfEqualizingCandidates } from './selfEqualizing.js';
import { computePredictiveAdvisory } from './occupancyMpc.js';
import { computePaceAdvisories, type PaceAdvisory } from './paceGuidance.js';
import { applyHardSafetyFilter, DEFAULT_STATE_STALE_SECONDS } from './safety.js';
import { loadScheduleCurves } from '../schedule/repository.js';
import { loadLastStopDeparture } from '../headway/repository.js';
import { computeScheduleDeviationSeconds } from '../schedule/deviation.js';
import { isHoldAction } from './types.js';
import type { CandidateAction, PredictiveAdvisory, SafetyRejection } from './types.js';

export type { CandidateAction, PredictiveAdvisory, PredictiveAdvisoryCandidate, SafetyRejection } from './types.js';
export type { PaceAdvisory } from './paceGuidance.js';

export interface MpcSolveResult {
  routeDirectionId: string;
  candidateActions: CandidateAction[];
  /**
   * The subset of `candidateActions` that survived the hard safety filter,
   * in the solver's own priority order. Emitted rather than left to the
   * caller to derive as `candidateActions - rejectedCandidates`: that
   * subtraction needs a candidate identity the wire shape does not carry,
   * and getting it subtly wrong in a consumer would mis-label an unsafe
   * candidate as eligible on a control surface. One producer, no matching
   * heuristics.
   */
  safeCandidates: CandidateAction[];
  /**
   * The candidate the selection policy picked, in full - not just its type.
   * `selectedActionType` alone names WHAT would be done but not to WHICH
   * vehicle or for how long, so any consumer wanting to propose the action
   * to a human had to re-implement the selection rule to recover the
   * vehicle. Re-implementing it is exactly the drift a safety-relevant path
   * must not have: a second copy of the rule could name a different bus
   * than the one this solver logged. Null whenever `selectedActionType` is.
   */
  selectedAction: CandidateAction | null;
  /**
   * Every action the selection policy picked this cycle, best first.
   *
   * `selectedAction` is `selectedActions[0]` and is kept because every
   * existing consumer reads it; this is the whole set.
   *
   * ─── WHY MORE THAN ONE ───────────────────────────────────────────────
   *
   * The solver used to return exactly one action per corridor per cycle.
   * That is correct on a corridor with one problem and wrong on a corridor
   * with several: three bunched pairs got one instruction, and the other two
   * waited a full decision cycle each for their turn. On an unstable plant
   * that wait is not neutral - the deviations those pairs are carrying grow
   * while they queue, so the cheap early correction this system exists to
   * make is exactly what the queue spends.
   *
   * The cap is `route_policies.max_concurrent_actions`, because how many
   * simultaneous instructions a control room can absorb is an operational
   * fact about that control room, not a property of the algorithm.
   *
   * `cost_optimal_hold` candidates appear in `candidateActions` and
   * `safeCandidates` but are excluded from here unless
   * COST_OPTIMAL_SELECTION_ENABLED is set - see that knob for why the argmin
   * of the ranking function is not automatically the right thing to do.
   */
  selectedActions: CandidateAction[];
  /**
   * Alighting-only proposals - "let people off, take nobody on, the bus behind
   * is right there" - that passed the safety filter.
   *
   * Returned SEPARATELY from `selectedActions` rather than mixed into it,
   * because this is the one action the engine proposes that it will not choose
   * for you. Its cost (passengers left standing) is estimable through the
   * lambda proxy; its benefit (the dwell the leader sheds) needs a fitted
   * dwell model no corridor has yet. Ranking a priced cost against an unpriced
   * benefit would sort it last on every list forever, which reads as "the
   * engine considered it and rejected it" when the truth is "nobody has
   * measured the upside".
   *
   * So it goes to the operator as an alternative with its trade stated, and
   * this field is where a UI finds it. See mpc/boardingLimit.ts.
   */
  boardingLimitCandidates: BoardingLimitCandidate[];
  selectedActionType: CandidateAction['actionType'] | null;
  objectiveCost: number | null;
  expectedRecoverySeconds: number | null;
  constraints: Record<string, unknown>;
  controllerVersion: string;
  /** Candidates the hard safety filter rejected, and why - kept for explainability/audit (blueprint 9.1 step 6 "explain(selected, evidence, ...)"). */
  rejectedCandidates: SafetyRejection[];
  /** Occupancy-weighted MPC re-scoring of the safety-filtered candidates. Always present, always `label: 'PREDICTIVE'` - advisory only, never the source of `selectedActionType`. */
  predictiveAdvisory: PredictiveAdvisory;
  /**
   * Vehicles that could ease their pace instead of being held, and by how
   * much.
   *
   * NOT candidates, and deliberately a separate field rather than an entry
   * in `candidateActions`. The selection rule ranks candidates in
   * passenger-seconds and would happily pick a speed instruction, but no
   * delivery path can carry one - a hold is executed at a stop where the
   * driver is already stationary, while a pace target only means something
   * on a driver-facing display this system does not have. Keeping it off
   * the candidate list is what makes dispatching one impossible rather than
   * merely discouraged. See mpc/paceGuidance.ts.
   *
   * Its value today is that a dispatcher with a radio can act on it, and
   * that it is the only lever here that improves punctuality and spacing at
   * the same time.
   */
  paceAdvisories: PaceAdvisory[];
}

export const CONTROLLER_VERSION = 'terminal-two-way-self-equalizing-v1';

/**
 * Seconds each vehicle is behind its timetable, keyed by vehicle id.
 *
 * A vehicle with no `trip_id` is absent from the map, as is one whose trip
 * has no usable schedule - both mean "not knowable", which is the reading
 * every consumer treats as no schedule term and no lateness bound.
 *
 * One query per solve, for the trips actually on the corridor. Skipped
 * entirely when no vehicle carries a trip id, which is the case on every
 * corridor today, so the cost of having this wired is a `Map` allocation
 * until a timetable is loaded.
 */
async function loadScheduleDeviations(
  vehicleStates: readonly VehicleStateRow[],
  now: Date,
): Promise<Map<string, number | null>> {
  const deviations = new Map<string, number | null>();
  const tripIds = vehicleStates
    .map((v) => v.tripId)
    .filter((id): id is string => id !== null);
  if (tripIds.length === 0) return deviations;

  const curves = await loadScheduleCurves(tripIds);
  for (const vehicle of vehicleStates) {
    const curve = vehicle.tripId ? (curves.get(vehicle.tripId) ?? null) : null;
    deviations.set(
      vehicle.vehicleId,
      computeScheduleDeviationSeconds(curve, vehicle.distanceAlongRouteMeters, now),
    );
  }
  return deviations;
}

async function solveInner(routeDirectionId: string): Promise<MpcSolveResult> {
  const policy = stateStore.getActivePolicy(routeDirectionId);
  if (!policy) {
    throw new AppError(
      'no_active_policy',
      `No active route policy for route-direction ${routeDirectionId}`,
      404,
    );
  }

  // One clock reading for the whole cycle. Every law, the safety filter and
  // the advisory are evaluated against the SAME instant, so a solve is
  // reproducible from a recorded state stream (reference architecture Part
  // J, "Deterministic replay") and two candidates can never be graded
  // against clocks a few milliseconds apart.
  const now = new Date();

  // The network-wide switches, read once per solve behind a 10 s cache
  // (src/db/settings.ts). Read here rather than inside each law so that every
  // candidate in one solve is generated under the same setting - a switch
  // flipped mid-solve must not produce a result where two laws disagreed
  // about what the controller is optimising.
  const settings = await readControlSettings();

  const headwayStates = stateStore.getHeadwayStates(routeDirectionId);
  const vehicleStates = stateStore.listVehicleStates(routeDirectionId);
  const vehicleStatesByVehicleId = new Map(vehicleStates.map((v) => [v.vehicleId, v]));
  const terminalStopId = stateStore.getTerminalStopId(routeDirectionId);
  const controlPointStopIds = stateStore.getControlPointStopIds(routeDirectionId);

  // How late each vehicle already is. Empty on every corridor today - the
  // timetable tables hold no rows - so every deviation is null, the schedule
  // term contributes nothing to any law and the lateness bound rejects
  // nothing. Wiring it now rather than later is what makes loading a
  // timetable a data change instead of a code change.
  const scheduleDeviationByVehicleId = await loadScheduleDeviations(vehicleStates, now);

  // How long since the previous bus left the origin. The quantity Algorithm A
  // regulates on, and MEASURED rather than derived from a stationary bus's
  // speed - see mpc/terminalDispatch.ts for the arithmetic that made the
  // derived version incapable of ever proposing a hold. One indexed row, and
  // only when a bus is actually standing at the terminal for it to be about.
  const terminalVehicleId =
    terminalStopId === undefined
      ? undefined
      : headwayStates.find((h) =>
          isAtTerminal(vehicleStatesByVehicleId.get(h.followerVehicleId), terminalStopId),
        )?.followerVehicleId;
  const lastTerminalDepartureAt =
    terminalStopId !== undefined && terminalVehicleId !== undefined
      ? await loadLastStopDeparture(routeDirectionId, terminalStopId, terminalVehicleId)
      : null;

  const terminalCandidates = computeTerminalDispatchCandidates(
    headwayStates,
    vehicleStatesByVehicleId,
    terminalStopId,
    policy,
    now,
    scheduleDeviationByVehicleId,
    settings.weighOccupancy,
    departureHeadwaySeconds(lastTerminalDepartureAt, now),
  );

  // Vehicles dwelling at the terminal are always regulated by terminal
  // dispatch (blueprint 8.1 "default first line"), even when they didn't
  // produce a candidate above (e.g. already spaced at/beyond target - no
  // hold needed right now) - two-way/self-equalizing must not also try to
  // act on them.
  const terminalVehicleIds = new Set(terminalCandidates.map((c) => c.vehicleId));
  for (const h of headwayStates) {
    if (isAtTerminal(vehicleStatesByVehicleId.get(h.followerVehicleId), terminalStopId)) {
      terminalVehicleIds.add(h.followerVehicleId);
    }
  }

  const twoWayCandidates = computeTwoWayCandidates(
    headwayStates,
    terminalVehicleIds,
    policy,
    vehicleStatesByVehicleId,
    now,
    scheduleDeviationByVehicleId,
    controlPointStopIds,
    settings.weighOccupancy,
  );
  const selfEqualizingCandidates = computeSelfEqualizingCandidates(
    headwayStates,
    terminalVehicleIds,
    policy,
    vehicleStatesByVehicleId,
    now,
    scheduleDeviationByVehicleId,
    controlPointStopIds,
    settings.weighOccupancy,
  );
  // The closed-form minimiser of the passenger-cost objective, competing on
  // the same ranking as the tuned-gain laws rather than replacing them - see
  // mpc/costOptimalHold.ts for why both are generated.
  const costOptimalCandidates = computeCostOptimalCandidates(
    headwayStates,
    terminalVehicleIds,
    policy,
    vehicleStatesByVehicleId,
    now,
    scheduleDeviationByVehicleId,
    controlPointStopIds,
    settings.weighOccupancy,
  );

  // Alighting-only. Generated alongside the holds and returned for the
  // operator to weigh, but deliberately NOT eligible for automatic selection
  // - its benefit (the dwell the leader sheds) needs a fitted dwell model
  // that no corridor has yet, so ranking it against the holds would compare a
  // priced cost against an unpriced benefit. See mpc/boardingLimit.ts.
  const boardingLimitCandidates = computeBoardingLimitCandidates(
    headwayStates,
    policy,
    vehicleStatesByVehicleId,
    scheduleDeviationByVehicleId,
    controlPointStopIds,
    terminalStopId,
  );
  const candidateActions = [
    ...terminalCandidates,
    ...twoWayCandidates,
    ...selfEqualizingCandidates,
    ...costOptimalCandidates,
    ...boardingLimitCandidates,
  ];

  const vehicleObservedAtByVehicleId = new Map(vehicleStates.map((v) => [v.vehicleId, v.observedAt]));
  const involvedVehicleIds = Array.from(new Set(candidateActions.flatMap((c) => c.involvedVehicleIds)));
  const candidateVehicleIds = Array.from(new Set(candidateActions.map((c) => c.vehicleId)));
  const [activeCommandVehicleIds, recentlyCommandedVehicleIds] = await Promise.all([
    listActiveVehicleIds(involvedVehicleIds),
    listRecentlyCommandedVehicleIds(candidateVehicleIds, policy.cooldownSeconds),
  ]);

  const { safe, rejected } = applyHardSafetyFilter(candidateActions, {
    now,
    staleAfterSeconds: DEFAULT_STATE_STALE_SECONDS,
    maxHoldSeconds: policy.maxHoldSeconds,
    vehicleObservedAtByVehicleId,
    activeCommandVehicleIds,
    maxLatenessSeconds: policy.maxLatenessSeconds,
    recentlyCommandedVehicleIds,
    minimumActionSeconds: policy.minimumActionSeconds,
  });

  if (rejected.length > 0) {
    // Never silent: a hard-safety rejection is exactly the signal an
    // operator needs to see (blueprint 9.1 step 5 guardrail), so it goes
    // to the structured log stream even though it's also returned on
    // `rejectedCandidates` for the caller.
    logger.warn(
      {
        routeDirectionId,
        rejected: rejected.map((r) => ({
          actionType: r.candidate.actionType,
          vehicleId: r.candidate.vehicleId,
          reasons: r.reasons,
        })),
      },
      'mpc.solve: hard safety filter rejected candidate action(s)',
    );
  }

  // Selection follows the same control-hierarchy priority as candidate
  // generation: a safe terminal-dispatch candidate always wins (least
  // disruptive, default first line, and the highest-return lever in the
  // literature); otherwise the lowest-cost safe mid-route candidate.
  //
  // The mid-route pool is re-sorted rather than left in generation order.
  // `candidateActions` concatenates two independently-sorted lists, so
  // before the passenger-cost objective existed every two-way candidate
  // necessarily outranked every self-equalizing one whatever their costs -
  // group order standing in for merit. The two laws cover disjoint pairs
  // (selfEqualizing.ts only takes pairs two-way could not) and now score on
  // one scale, passenger-seconds, so the comparison is finally meaningful
  // and the cheaper action should win it.
  const safeTerminal = safe.filter((c) => c.actionType === 'terminal_dispatch_hold');
  const safeMidRoute = safe
    // `boarding_limit` is excluded from the RANKED pool, not from `safe`:
    // its objectiveCost is a cost with no benefit term filled in, so it is
    // not commensurable with the holds' net figures and would pollute an
    // ordering that is otherwise "most beneficial first".
    //
    // It stays in `safeCandidates` below, because that field means "passed
    // the safety filter" and this did. Dropping it there would break the
    // invariant `candidateActions === safeCandidates + rejectedCandidates`
    // that consumers are explicitly told they can rely on, and would leave a
    // candidate that is neither safe nor rejected - a third state no reader
    // has a branch for.
    .filter((c) => c.actionType !== 'terminal_dispatch_hold' && !isBoardingLimitCandidate(c))
    .sort((a, b) => a.objectiveCost - b.objectiveCost);

  const safeBoardingLimits = safe.filter(isBoardingLimitCandidate);

  const selectedActions = selectActions(
    safeTerminal,
    safeMidRoute,
    policy.maxConcurrentActions ?? DEFAULT_MAX_CONCURRENT_ACTIONS,
    loadEnv().COST_OPTIMAL_SELECTION_ENABLED,
  );
  const selected = selectedActions[0] ?? null;

  // ─── THE ADVISORY IGNORES THE OCCUPANCY SWITCH, ON PURPOSE ───────────
  //
  // `settings.weighOccupancy` gates the OBJECTIVE, which decides. This
  // advisory decides nothing - it is labelled PREDICTIVE, never sources
  // `selectedActionType`, and exists to show what an occupancy-weighted
  // ranking would say. Silencing it when the switch is off would remove the
  // one view an operator could use to judge whether turning the switch on
  // would change anything, which is the question the switch poses.
  //
  // Holds only. The advisory re-scores a candidate by asking what its HOLD
  // costs the people aboard - `w_v x L x d`, which is identically zero for an
  // action whose d is 0. Feeding alighting-only candidates in would add rows
  // scored at zero in-vehicle cost, reading as "this one is free" when in
  // truth the advisory has no model of its cost at all: the people it affects
  // are at the roadside, not on the bus.
  const predictiveAdvisory = computePredictiveAdvisory(
    safe.filter((c) => isHoldAction(c.actionType)),
    vehicleStatesByVehicleId,
    policy,
    now,
  );

  // Computed over ALL headway states rather than only the ones that produced
  // a hold candidate: a vehicle running early and closing up may be correctly
  // refused a hold (it would breach the lateness bound, or the cap makes the
  // hold pointless) and still be exactly the vehicle that should ease off.
  const speedByVehicleId = new Map(vehicleStates.map((v) => [v.vehicleId, v.speedKmph]));
  const paceAdvisories = computePaceAdvisories(
    headwayStates,
    speedByVehicleId,
    scheduleDeviationByVehicleId,
    policy,
  );

  return {
    routeDirectionId,
    candidateActions,
    // Every candidate that passed the filter, in one list, so that
    // `candidateActions.length === safeCandidates.length + rejectedCandidates.length`
    // holds for every action type including the non-hold one.
    safeCandidates: [...safeTerminal, ...safeMidRoute, ...safeBoardingLimits],
    selectedAction: selected,
    selectedActions,
    boardingLimitCandidates: safeBoardingLimits,
    selectedActionType: selected?.actionType ?? null,
    objectiveCost: selected?.objectiveCost ?? null,
    expectedRecoverySeconds: selected?.holdSeconds ?? null,
    constraints: {
      maxHoldSeconds: policy.maxHoldSeconds,
      cooldownSeconds: policy.cooldownSeconds,
      staleAfterSeconds: DEFAULT_STATE_STALE_SECONDS,
      maxLatenessSeconds: policy.maxLatenessSeconds,
      ks: policy.ks,
      minimumActionSeconds: policy.minimumActionSeconds,
      controlPointCount: controlPointStopIds.size,
    },
    controllerVersion: CONTROLLER_VERSION,
    rejectedCandidates: rejected,
    predictiveAdvisory,
    paceAdvisories,
  };
}

/**
 * Fallback when a corridor's policy sets no concurrency cap.
 *
 * Three, not one and not unbounded. One was the old behaviour and starves
 * every problem after the first. Unbounded would hand a control room twelve
 * simultaneous instructions on a bad morning, which is the same as handing it
 * none - nobody triages twelve, and the compliance cost of instructions that
 * go unactioned falls on the next one that matters.
 */
export const DEFAULT_MAX_CONCURRENT_ACTIONS = 3;

/**
 * Whether this candidate is one the objective's ranking can actually bite on.
 *
 * `safe` holds three families the ranking never orders against anything:
 * a terminal-dispatch hold takes absolute priority whatever it costs,
 * `boarding_limit` is excluded from the ranked pool above, and
 * `cost_optimal_hold` is filtered out of `selectActions` unless the closed
 * form has been made selectable. So a decision with one hold and one of those
 * beside it has TWO candidates and no ranking at all.
 *
 * Exported because two surfaces report whether the occupancy switch had a
 * ranking to change - `fleetTrial/run.ts#occupancyContrast` and
 * `rehearsal/run.ts#occupancyContrast` - and each carried its own
 * approximation of this rule. One of them counted every candidate and
 * answered "yes, comparable" the first time an unpriced alighting-only
 * proposal appeared next to a hold; the other remembered `cost_optimal_hold`
 * and forgot `boarding_limit`. The rule belongs next to the pool it describes.
 */
export function isRankedMidRouteCandidate(
  candidate: CandidateAction,
  costOptimalSelectable: boolean,
): boolean {
  if (candidate.actionType === 'terminal_dispatch_hold') return false;
  if (isBoardingLimitCandidate(candidate)) return false;
  if (!costOptimalSelectable && candidate.actionType === 'cost_optimal_hold') return false;
  return true;
}

/**
 * Which safe candidates to actually propose, best first.
 *
 * ─── ONE ACTION PER VEHICLE, ALWAYS ──────────────────────────────────────
 *
 * The de-duplication is the load-bearing part, not the cap. Four laws now
 * generate candidates and three of them (two-way, self-equalising,
 * cost-optimal) key on the same follower vehicle, so the same bus routinely
 * appears two or three times in `safe` with different hold lengths. Taking
 * the top N off a sorted list would hand a dispatcher "hold UP25FT4823 for
 * 90s" and "hold UP25FT4823 for 140s" together, which is not two options - it
 * is one instruction that cannot be followed, and the safety filter's
 * `conflicting_active_command` check would refuse the second the moment the
 * first was issued anyway.
 *
 * Terminal candidates keep absolute priority over mid-route ones, preserving
 * the control hierarchy the single-action selection encoded: a hold at the
 * terminal costs no passenger their seat and no driver their schedule, so it
 * is always the cheapest place to spend a correction.
 */
export function selectActions(
  safeTerminal: readonly CandidateAction[],
  safeMidRoute: readonly CandidateAction[],
  maxConcurrent: number,
  costOptimalSelectable: boolean,
): CandidateAction[] {
  const selected: CandidateAction[] = [];
  const claimedVehicleIds = new Set<string>();

  const eligible = [...safeTerminal, ...safeMidRoute].filter(
    // Generated and shown always; selectable only once lambda is measured.
    // See COST_OPTIMAL_SELECTION_ENABLED in config/env.ts - the closed form is
    // the argmin of the ranking function, so allowing it to compete IS
    // replacing the controller, not adding to it.
    (c) => costOptimalSelectable || c.actionType !== 'cost_optimal_hold',
  );

  for (const candidate of eligible) {
    if (selected.length >= maxConcurrent) break;
    if (claimedVehicleIds.has(candidate.vehicleId)) continue;
    claimedVehicleIds.add(candidate.vehicleId);
    selected.push(candidate);
  }

  return selected;
}

/** Public entry point: always wrapped in the `mpc.solve` span so solve latency is visible on the Sentry "Control Service Latency" dashboard. */
export async function solve(routeDirectionId: string): Promise<MpcSolveResult> {
  return withSpan('mpc.solve', 'mpc.solve', () => solveInner(routeDirectionId));
}
