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
import { computeTerminalDispatchCandidates, isAtTerminal } from './terminalDispatch.js';
import { computeTwoWayCandidates } from './twoWayHold.js';
import { computeSelfEqualizingCandidates } from './selfEqualizing.js';
import { computePredictiveAdvisory } from './occupancyMpc.js';
import { computePaceAdvisories, type PaceAdvisory } from './paceGuidance.js';
import { applyHardSafetyFilter, DEFAULT_STATE_STALE_SECONDS } from './safety.js';
import { loadScheduleCurves } from '../schedule/repository.js';
import { computeScheduleDeviationSeconds } from '../schedule/deviation.js';
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

  const terminalCandidates = computeTerminalDispatchCandidates(
    headwayStates,
    vehicleStatesByVehicleId,
    terminalStopId,
    policy,
    now,
    scheduleDeviationByVehicleId,
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
  );
  const selfEqualizingCandidates = computeSelfEqualizingCandidates(
    headwayStates,
    terminalVehicleIds,
    policy,
    vehicleStatesByVehicleId,
    now,
    scheduleDeviationByVehicleId,
    controlPointStopIds,
  );
  const candidateActions = [...terminalCandidates, ...twoWayCandidates, ...selfEqualizingCandidates];

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
    .filter((c) => c.actionType !== 'terminal_dispatch_hold')
    .sort((a, b) => a.objectiveCost - b.objectiveCost);
  const selected = safeTerminal[0] ?? safeMidRoute[0] ?? null;

  const predictiveAdvisory = computePredictiveAdvisory(safe, vehicleStatesByVehicleId, policy, now);

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
    safeCandidates: [...safeTerminal, ...safeMidRoute],
    selectedAction: selected,
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

/** Public entry point: always wrapped in the `mpc.solve` span so solve latency is visible on the Sentry "Control Service Latency" dashboard. */
export async function solve(routeDirectionId: string): Promise<MpcSolveResult> {
  return withSpan('mpc.solve', 'mpc.solve', () => solveInner(routeDirectionId));
}
