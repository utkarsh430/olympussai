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
import { stateStore } from '../state/store.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { listActiveVehicleIds } from '../db/commands.js';
import { computeTerminalDispatchCandidates, isAtTerminal } from './terminalDispatch.js';
import { computeTwoWayCandidates } from './twoWayHold.js';
import { computeSelfEqualizingCandidates } from './selfEqualizing.js';
import { computePredictiveAdvisory } from './occupancyMpc.js';
import { applyHardSafetyFilter, DEFAULT_STATE_STALE_SECONDS } from './safety.js';
import type { CandidateAction, PredictiveAdvisory, SafetyRejection } from './types.js';

export type { CandidateAction, PredictiveAdvisory, PredictiveAdvisoryCandidate, SafetyRejection } from './types.js';

export interface MpcSolveResult {
  routeDirectionId: string;
  candidateActions: CandidateAction[];
  selectedActionType: CandidateAction['actionType'] | null;
  objectiveCost: number | null;
  expectedRecoverySeconds: number | null;
  constraints: Record<string, unknown>;
  controllerVersion: string;
  /** Candidates the hard safety filter rejected, and why - kept for explainability/audit (blueprint 9.1 step 6 "explain(selected, evidence, ...)"). */
  rejectedCandidates: SafetyRejection[];
  /** Occupancy-weighted MPC re-scoring of the safety-filtered candidates. Always present, always `label: 'PREDICTIVE'` - advisory only, never the source of `selectedActionType`. */
  predictiveAdvisory: PredictiveAdvisory;
}

export const CONTROLLER_VERSION = 'terminal-two-way-self-equalizing-v1';

async function solveInner(routeDirectionId: string): Promise<MpcSolveResult> {
  const policy = stateStore.getActivePolicy(routeDirectionId);
  if (!policy) {
    throw new AppError(
      'no_active_policy',
      `No active route policy for route-direction ${routeDirectionId}`,
      404,
    );
  }

  const headwayStates = stateStore.getHeadwayStates(routeDirectionId);
  const vehicleStates = stateStore.listVehicleStates(routeDirectionId);
  const vehicleStatesByVehicleId = new Map(vehicleStates.map((v) => [v.vehicleId, v]));
  const terminalStopId = stateStore.getTerminalStopId(routeDirectionId);

  const terminalCandidates = computeTerminalDispatchCandidates(
    headwayStates,
    vehicleStatesByVehicleId,
    terminalStopId,
    policy,
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

  const twoWayCandidates = computeTwoWayCandidates(headwayStates, terminalVehicleIds, policy);
  const selfEqualizingCandidates = computeSelfEqualizingCandidates(headwayStates, terminalVehicleIds, policy);
  const candidateActions = [...terminalCandidates, ...twoWayCandidates, ...selfEqualizingCandidates];

  const vehicleObservedAtByVehicleId = new Map(vehicleStates.map((v) => [v.vehicleId, v.observedAt]));
  const involvedVehicleIds = Array.from(new Set(candidateActions.flatMap((c) => c.involvedVehicleIds)));
  const activeCommandVehicleIds = await listActiveVehicleIds(involvedVehicleIds);

  const { safe, rejected } = applyHardSafetyFilter(candidateActions, {
    now: new Date(),
    staleAfterSeconds: DEFAULT_STATE_STALE_SECONDS,
    maxHoldSeconds: policy.maxHoldSeconds,
    vehicleObservedAtByVehicleId,
    activeCommandVehicleIds,
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
  // disruptive, default first line); otherwise the lowest-cost safe
  // mid-route candidate (two-way, or self-equalizing where two-way's
  // inputs were unavailable) is selected.
  const safeTerminal = safe.filter((c) => c.actionType === 'terminal_dispatch_hold');
  const safeMidRoute = safe.filter((c) => c.actionType !== 'terminal_dispatch_hold');
  const selected = safeTerminal[0] ?? safeMidRoute[0] ?? null;

  const predictiveAdvisory = computePredictiveAdvisory(safe, vehicleStatesByVehicleId, policy);

  return {
    routeDirectionId,
    candidateActions,
    selectedActionType: selected?.actionType ?? null,
    objectiveCost: selected?.objectiveCost ?? null,
    expectedRecoverySeconds: selected?.holdSeconds ?? null,
    constraints: {
      maxHoldSeconds: policy.maxHoldSeconds,
      cooldownSeconds: policy.cooldownSeconds,
      staleAfterSeconds: DEFAULT_STATE_STALE_SECONDS,
    },
    controllerVersion: CONTROLLER_VERSION,
    rejectedCandidates: rejected,
    predictiveAdvisory,
  };
}

/** Public entry point: always wrapped in the `mpc.solve` span so solve latency is visible on the Sentry "Control Service Latency" dashboard. */
export async function solve(routeDirectionId: string): Promise<MpcSolveResult> {
  return withSpan('mpc.solve', 'mpc.solve', () => solveInner(routeDirectionId));
}
