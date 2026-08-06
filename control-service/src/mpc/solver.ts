// MPC solver: computes a hold/skip recommendation for one route-direction
// cycle from the rehydrated headway state and the active route policy
// (blueprint 8.x control hierarchy). Implements the self-equalizing
// headway control law (policy.selfEqualizingK against the deviation from
// target headway) as the initial controller - richer objective terms
// (occupancy cost, passenger-weighted recovery time, multi-stop horizon)
// are a follow-up, not required to stand up the runtime/API surface this
// ticket delivers. Every call is wrapped in the `mpc.solve` Sentry span
// the deployment dashboards are built against.
import { withSpan } from '../telemetry/sentry.js';
import { stateStore } from '../state/store.js';
import { AppError } from '../lib/errors.js';
import type { HeadwayStateRow, RoutePolicyRow } from '../state/store.js';

export interface CandidateAction {
  actionType: 'terminal_dispatch_hold' | 'two_way_hold' | 'self_equalizing_hold' | 'speed_guidance';
  vehicleId: string;
  holdSeconds?: number;
  speedAdjustmentPercent?: number;
  objectiveCost: number;
}

export interface MpcSolveResult {
  routeDirectionId: string;
  candidateActions: CandidateAction[];
  selectedActionType: CandidateAction['actionType'] | null;
  objectiveCost: number | null;
  expectedRecoverySeconds: number | null;
  constraints: Record<string, unknown>;
  controllerVersion: string;
}

export const CONTROLLER_VERSION = 'self-equalizing-v1';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** One candidate action per follower vehicle behind its leader, scored by how much deviation it removes per second of hold (lower cost = better). */
function computeCandidates(
  headwayStates: HeadwayStateRow[],
  policy: RoutePolicyRow,
): CandidateAction[] {
  return headwayStates
    .filter((h) => h.deviationSeconds !== null && Math.abs(h.deviationSeconds) > 0)
    .map((h) => {
      const deviation = h.deviationSeconds as number;
      const gain = policy.selfEqualizingK ?? 0.5;
      const rawHold = Math.abs(deviation) * gain;
      const holdSeconds = Math.round(clamp(rawHold, 0, policy.maxHoldSeconds));
      // Objective cost: unrecovered deviation after applying the hold,
      // penalized so a hold that overshoots (holds longer than the
      // deviation itself) is never preferred to one that matches it.
      const residual = Math.abs(Math.abs(deviation) - holdSeconds);
      const overshoot = Math.max(0, holdSeconds - Math.abs(deviation));
      const objectiveCost = residual + overshoot * 0.25;
      return {
        actionType: 'self_equalizing_hold' as const,
        vehicleId: deviation > 0 ? h.followerVehicleId : h.leaderVehicleId,
        holdSeconds,
        objectiveCost,
      };
    })
    .sort((a, b) => a.objectiveCost - b.objectiveCost);
}

function solveInner(routeDirectionId: string): MpcSolveResult {
  const policy = stateStore.getActivePolicy(routeDirectionId);
  if (!policy) {
    throw new AppError(
      'no_active_policy',
      `No active route policy for route-direction ${routeDirectionId}`,
      404,
    );
  }

  const headwayStates = stateStore.getHeadwayStates(routeDirectionId);
  const candidateActions = computeCandidates(headwayStates, policy);
  const selected = candidateActions[0] ?? null;

  return {
    routeDirectionId,
    candidateActions,
    selectedActionType: selected?.actionType ?? null,
    objectiveCost: selected?.objectiveCost ?? null,
    expectedRecoverySeconds: selected?.holdSeconds ?? null,
    constraints: {
      maxHoldSeconds: policy.maxHoldSeconds,
      cooldownSeconds: policy.cooldownSeconds,
    },
    controllerVersion: CONTROLLER_VERSION,
  };
}

/** Public entry point: always wrapped in the `mpc.solve` span so solve latency is visible on the Sentry "Control Service Latency" dashboard. */
export async function solve(routeDirectionId: string): Promise<MpcSolveResult> {
  return withSpan('mpc.solve', 'mpc.solve', () => Promise.resolve(solveInner(routeDirectionId)));
}
