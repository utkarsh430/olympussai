/**
 * How the control room talks about the decision engine.
 *
 * Everything here is pure, and it is a module rather than JSX for one reason:
 * almost every sentence the console says about a recommendation is a claim
 * that can be wrong in a way an operator cannot detect. "No action needed"
 * when the safety filter refused everything. "This bus is stale" when it was
 * the LEADER whose reading expired. A ranked list that quietly blends the
 * committing solver with the advisory re-score. Each of those is one careless
 * line of JSX away, and none of them would fail a render test. They are
 * therefore decided here, once, against the contract in
 * src/app/api/ops/control-room/recommendations/route.ts, and asserted in
 * src/tests/unit/controlRoomConsole.test.ts.
 *
 * The engine's own limits are derived, never restated. `humanOriginatedActions`
 * SUBTRACTS what the engine reports it can propose from the nine dispatchable
 * command types, so if the solver ever learns a fourth action the console
 * stops calling it human-originated on its own, with no edit here.
 */
import {
  COMMAND_ACTION_TYPES,
  type CommandActionType,
  type EngineActionType,
  type EngineCandidateAction,
  type EngineSafetyRejection,
  type SafetyRejectionReason,
} from '@/models/control';

/** Selection bases, mirroring `selectionBasisFor` in src/lib/controlService/recommendations.ts. */
export type SelectionBasis =
  | 'terminal_dispatch_priority'
  | 'lowest_cost_mid_route'
  | 'all_candidates_rejected'
  | 'no_candidates';

/** The response body of POST /api/ops/control-room/recommendations. */
export interface RecommendationResult {
  routeDirectionId: string;
  solvedAt: string;
  controllerVersion: string;
  engineActionTypes: EngineActionType[];
  selectedAction: EngineCandidateAction | null;
  selectionBasis: SelectionBasis;
  objectiveCost: number | null;
  expectedRecoverySeconds: number | null;
  candidateActions: EngineCandidateAction[];
  safeCandidates: EngineCandidateAction[];
  rejectedCandidates: EngineSafetyRejection[];
  predictiveAdvisory: {
    label: 'PREDICTIVE';
    horizonControlPoints: number;
    candidates: {
      actionType: EngineActionType;
      vehicleId: string;
      holdSeconds: number;
      waitCost: number;
      onboardCost: number;
      mpcObjectiveCost: number;
      occupancyEstimated: boolean;
    }[];
    controllerVersion: string;
  };
  constraints: Record<string, unknown>;
  commandsBlockedBy: {
    scope: 'network' | 'route';
    routeDirectionId: string | null;
    reason: string;
    engagedAt: string;
  } | null;
  persistence: 'none';
}

/** Operator-facing names for the nine dispatchable instructions. */
export const ACTION_LABEL: Record<CommandActionType, string> = {
  terminal_dispatch_hold: 'Terminal dispatch hold',
  two_way_hold: 'Two-way hold',
  self_equalizing_hold: 'Self-equalizing hold',
  speed_guidance: 'Speed guidance',
  stop_skip: 'Stop skip',
  short_turn: 'Short turn',
  deadhead: 'Deadhead',
  boarding_limit: 'Boarding limit',
  standby_injection: 'Standby injection',
};

export function actionLabel(actionType: string): string {
  return ACTION_LABEL[actionType as CommandActionType] ?? actionType.replace(/_/g, ' ');
}

/**
 * The instructions no model in this system generates, derived by subtraction.
 *
 * The console shows these as available levers and says plainly that nothing
 * proposes them. Hardcoding the six would let the UI keep making that claim
 * after the engine grew a seventh; subtracting the engine's own reported
 * vocabulary means the claim cannot outlive its truth.
 */
export function humanOriginatedActions(engineActionTypes: readonly string[]): CommandActionType[] {
  const engine = new Set(engineActionTypes);
  return COMMAND_ACTION_TYPES.filter((type) => !engine.has(type));
}

export interface BasisCopy {
  tone: 'good' | 'warn' | 'critical' | 'info';
  headline: string;
  detail: string;
}

/**
 * What the engine's answer MEANS, which is not what it looks like.
 *
 * The trap this exists to close: `selectedAction === null` reads as "all
 * quiet" and is the truth in one case and its opposite in the other. When the
 * control laws produced candidates and the hard safety filter refused every
 * one, the engine is telling the control room it wanted to intervene and could
 * not vouch for any option — a state that must arrive as a warning with the
 * rejections attached, never as silence.
 */
export function describeBasis(basis: SelectionBasis, rejectedCount: number): BasisCopy {
  switch (basis) {
    case 'terminal_dispatch_priority':
      return {
        tone: 'info',
        headline: 'Terminal dispatch takes priority',
        detail:
          'Holding a bus that is already stationary at the origin is the least disruptive lever available, so the engine prefers it over any mid-route hold even when a mid-route option scores lower.',
      };
    case 'lowest_cost_mid_route':
      return {
        tone: 'info',
        headline: 'Cheapest safe mid-route hold',
        detail:
          'No terminal-dispatch candidate was available, so the engine picked the lowest-cost hold that survived the safety filter.',
      };
    case 'all_candidates_rejected':
      return {
        tone: 'critical',
        headline: 'The engine wanted to act and the safety filter refused every option',
        detail: `This is not a quiet corridor. ${rejectedCount} ${rejectedCount === 1 ? 'candidate was' : 'candidates were'} generated and then rejected on the evidence below — read the reasons before deciding to do nothing.`,
      };
    case 'no_candidates':
      return {
        tone: 'good',
        headline: 'Nothing to regulate',
        detail:
          'No control law produced a candidate, which on a headway-managed corridor means the service is spaced at or beyond its target headway.',
      };
  }
}

/**
 * Why the safety filter refused a candidate, in words that point at the right
 * bus.
 *
 * `stale_state` is graded against every vehicle the computation depended on —
 * the held bus AND its leader or follower — so the common case is a perfectly
 * healthy bus rejected because the vehicle in front of it stopped reporting.
 * "UP25FT7777 is stale" would send an operator to inspect the wrong vehicle,
 * so the copy names the dependency set instead.
 */
export function describeRejection(
  reason: SafetyRejectionReason,
  candidate: EngineCandidateAction,
  constraints: Record<string, unknown>,
): string {
  switch (reason) {
    case 'stale_state': {
      const others = candidate.involvedVehicleIds.filter((id) => id !== candidate.vehicleId);
      if (others.length === 0) {
        return `The data this depends on is stale — ${candidate.vehicleId}'s own reading is older than the safety filter allows, so the engine will not vouch for the hold.`;
      }
      // "At least one of", not "the readings ... are": the filter rejects the
      // candidate if ANY vehicle it depends on has gone quiet, and it does not
      // report which. Naming the set and being precise about the quantifier is
      // the difference between an operator checking two buses and an operator
      // wrongly concluding both have failed.
      return `The data this depends on is stale — at least one of the readings this depends on (${candidate.involvedVehicleIds.join(', ')}) is older than the safety filter allows, so the engine will not vouch for the hold. It is often the leader, not ${candidate.vehicleId}, that stopped reporting.`;
    }
    case 'max_hold_cap_breach': {
      const cap = typeof constraints.maxHoldSeconds === 'number' ? `${constraints.maxHoldSeconds}s` : 'the policy cap';
      return `The hold this would need exceeds ${cap}, the maximum this corridor's policy permits.`;
    }
    case 'conflicting_active_command':
      return `${candidate.vehicleId} already has an instruction in flight; a second one would conflict with it.`;
  }
}

/** Reading of `objectiveCost`, which is not a score and must not be shown as one. */
export function describeObjectiveCost(cost: number): string {
  return cost === 0
    ? 'ideal — the cap and rounding did not pull the hold away from the formula'
    : `${Math.round(cost)}s between the ideal hold and the one that can actually be applied`;
}

/** Age of the sample a candidate was computed from, which is the freshness the safety filter graded. */
export function sampleAgeSeconds(stateAsOf: string, now: number): number | null {
  const at = Date.parse(stateAsOf);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.round((now - at) / 1000));
}

/**
 * A pending dispatcher approval, as the approval queue returns it.
 * Structural on purpose: this module must not depend on the repo.
 */
export interface PendingApproval {
  id: string;
  actionType: string;
  vehicleId: string | null;
  routeDirectionId: string | null;
  reason: string;
  createdAt: string;
  decision: 'pending' | 'approved' | 'rejected';
}

/**
 * The approval that authorizes exactly this proposal, or null.
 *
 * The comparison is deliberately the SAME triple, by exact equality including
 * against null, that `POST /api/ops/control-room/commands` re-checks
 * server-side before it dispatches (its APPROVAL_MISMATCH branch). This is a
 * convenience for the operator, never a substitute: the console offers a
 * one-click issue only when it can already see the authorizing approval, and
 * the server independently proves the same thing a moment later. If the two
 * ever disagree the server wins and the command is refused, which is the
 * correct outcome.
 *
 * Only `pending` approvals qualify. A consumed or rejected one has been spent.
 */
export function matchingApproval(
  action: Pick<EngineCandidateAction, 'actionType' | 'vehicleId' | 'routeDirectionId'>,
  approvals: readonly PendingApproval[],
): PendingApproval | null {
  return (
    approvals.find(
      (approval) =>
        approval.decision === 'pending' &&
        approval.actionType === action.actionType &&
        approval.vehicleId === action.vehicleId &&
        approval.routeDirectionId === action.routeDirectionId,
    ) ?? null
  );
}

/**
 * The audit sentence written into `summary` when an engine proposal is issued.
 *
 * `summary` is this app's own record of WHY a command was sent, and it is the
 * only place the engine's authorship survives: the solve itself is not
 * persisted anywhere (`persistence: 'none'`), so without this the command
 * would be indistinguishable from a hand-typed one after the fact. It cites
 * the controller version and the sample the decision rested on, because "which
 * engine, reasoning over how fresh a reading" is the question asked after an
 * incident.
 */
export function engineCommandSummary(
  action: EngineCandidateAction,
  controllerVersion: string,
  solvedAt: string,
): string {
  return [
    `Engine proposal accepted by the control room: ${actionLabel(action.actionType)} on ${action.vehicleId} for ${Math.round(action.holdSeconds)}s.`,
    `Headway deviation ${Math.round(action.headwayDeviationSeconds)}s against a ${Math.round(action.targetHeadwaySeconds)}s target.`,
    `Proposed by ${controllerVersion} at ${solvedAt} from a vehicle state sampled at ${action.stateAsOf}.`,
    'Not auto-issued: a dispatcher approval authorized this action and an operator issued it.',
  ].join(' ');
}

/**
 * How long a displayed solve may still be treated as actionable.
 *
 * The engine grades every candidate's freshness against the wall clock at
 * solve time, so a recommendation left on screen carries a safety verdict that
 * silently expires. The server client refuses to cache for exactly this reason
 * (src/lib/controlService/recommendations.ts); the console has to honour the
 * same rule for the copy already painted on the operator's screen. Past this
 * bound the panel keeps the recommendation visible — an operator mid-decision
 * should not have it vanish — but marks it expired and withdraws the issue
 * control.
 */
export const RECOMMENDATION_ACTIONABLE_MS = 90_000;

export function isRecommendationExpired(solvedAt: string, now: number): boolean {
  const at = Date.parse(solvedAt);
  if (Number.isNaN(at)) return true;
  return now - at > RECOMMENDATION_ACTIONABLE_MS;
}
