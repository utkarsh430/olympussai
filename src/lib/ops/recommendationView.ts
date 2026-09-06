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
 * SUBTRACTS what the engine reports it works out from the nine dispatchable
 * command types, so if the solver ever learns a new action the console stops
 * calling it human-originated on its own, with no edit here. It subtracts two
 * sets, not one — see that function for why an advisory the engine computes
 * but never ranks needed its own category rather than joining the candidates.
 */
import {
  type BoardingLimitAvailability,
  COMMAND_ACTION_TYPES,
  ENGINE_ADVISORY_ACTION_TYPES,
  type CommandActionType,
  type EngineActionType,
  type EngineAdvisoryActionType,
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
  /**
   * What the engine works out but never ranks — pace guidance today.
   *
   * Optional so a response from a control service or an app build that
   * predates the field still satisfies this type; `humanOriginatedActions`
   * falls back to the compiled-in set rather than silently re-asserting that
   * nothing generates speed guidance.
   */
  engineAdvisoryActionTypes?: EngineAdvisoryActionType[];
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
  /**
   * Alighting-only proposals that passed the safety filter — "let people off,
   * take nobody on, the bus behind is right there".
   *
   * Kept apart from `safeCandidates` in the UI's model even though the engine
   * includes them there, because these are the one action it proposes without
   * choosing: the cost (passengers left standing) is estimable, the benefit
   * (the dwell the leader sheds) is not, so a human decides.
   *
   * Optional so a response from a control service that predates the field
   * still satisfies this type during a rolling deploy.
   */
  boardingLimitCandidates?: (EngineCandidateAction & {
    estimate: {
      /** Null while the arrival rate is a placeholder — see the Zod schema for why it is not a number. */
      leftBehindPassengers: number | null;
      /** Seconds. The one figure here that is measured rather than inferred. */
      leftBehindWaitSeconds: number;
      imposedWaitPassengerSeconds: number | null;
      dwellSavingSeconds: number | null;
      lambdaIsProxy: boolean;
    };
  })[];
  /**
   * Why `boardingLimitCandidates` is the length it is.
   *
   * Optional and nullable: a control service that predates the per-corridor
   * gate sends nothing, and null means "this service cannot say" — never
   * "available", never "no refusals".
   */
  boardingLimitAvailability?: BoardingLimitAvailability | null;
  /**
   * Buses that should ease off rather than be held — the only lever that
   * improves punctuality and spacing at the same time, because it spends
   * slack a bus already has instead of adding delay.
   */
  paceAdvisories?: {
    vehicleId: string;
    routeDirectionId: string;
    action: 'reduce_pace';
    currentSpeedKmph: number;
    targetSpeedKmph: number;
    scheduleSlackSeconds: number | null;
    rationale: string;
  }[];
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
  // Named for what it optimises rather than for the maths behind it. An
  // operator does not need "closed-form minimiser of the passenger-cost
  // objective"; they need to know this hold was chosen by weighing waiting
  // against lateness and load, which is what "balanced" says.
  cost_optimal_hold: 'Balanced hold',
  speed_guidance: 'Speed guidance',
  stop_skip: 'Stop skip',
  short_turn: 'Short turn',
  deadhead: 'Deadhead',
  // The control room's own label. Says what happens rather than naming the
  // policy: an operator deciding whether to authorise this needs to picture
  // the bus going past people, not parse "boarding limit".
  boarding_limit: 'Drop off only',
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
 *
 * ─── WHY TWO SETS ARE SUBTRACTED AND NOT ONE ─────────────────────────────
 *
 * The derivation was built for one shape of drift — the engine learning a new
 * CANDIDATE — and `boarding_limit` moved across it with no edit here, which is
 * what it was for. `speed_guidance` is a different shape and the derivation
 * did NOT absorb it: the engine works out a pace advisory on every solve, but
 * it is not a candidate and must never become one, so it never entered
 * `engineActionTypes` and this function kept calling it human-originated while
 * the control room rendered it two panels away.
 *
 * Subtracting `engineAdvisoryActionTypes` as well is what makes the claim true
 * again without widening the candidate type that keeps a speed instruction out
 * of the ranking. The set is passed in, defaulted rather than hardcoded, for
 * the same reason the first one is: a console states this from data.
 */
export function humanOriginatedActions(
  engineActionTypes: readonly string[],
  engineAdvisoryActionTypes: readonly string[] = ENGINE_ADVISORY_ACTION_TYPES,
): CommandActionType[] {
  const worked = new Set([...engineActionTypes, ...engineAdvisoryActionTypes]);
  return COMMAND_ACTION_TYPES.filter((type) => !worked.has(type));
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
        headline: 'Holding at the start terminal comes first',
        detail:
          'Holding a bus that is already standing at the terminal upsets the fewest passengers, so the engine prefers it over holding a bus part-way along the route even when the mid-route option scores better.',
      };
    case 'lowest_cost_mid_route':
      return {
        tone: 'info',
        headline: 'Least disruptive hold part-way along the route',
        detail:
          'No bus was standing at the terminal to hold, so the engine picked the least disruptive of the holds that passed the safety checks.',
      };
    case 'all_candidates_rejected':
      return {
        tone: 'critical',
        headline: 'The engine wanted to act and the safety checks refused every option',
        detail: `This is not a quiet corridor. ${rejectedCount} ${rejectedCount === 1 ? 'option was' : 'options were'} worked out and then refused, on the evidence below — read the reasons before deciding to do nothing.`,
      };
    case 'no_candidates':
      return {
        tone: 'good',
        headline: 'Nothing needs correcting',
        detail:
          'The automatic spacing rules found nothing to do. On a corridor with a planned gap, that means the buses are at or beyond their planned spacing.',
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
        return `Out-of-date reading — ${candidate.vehicleId}'s own position is older than the safety checks allow, so the engine will not vouch for the hold.`;
      }
      // "At least one of", not "the readings ... are": the filter rejects the
      // candidate if ANY vehicle it depends on has gone quiet, and it does not
      // report which. Naming the set and being precise about the quantifier is
      // the difference between an operator checking two buses and an operator
      // wrongly concluding both have failed.
      return `Out-of-date reading — at least one of the buses this depends on (${candidate.involvedVehicleIds.join(', ')}) has a position older than the safety checks allow, so the engine will not vouch for the hold. It is often the bus in front, not ${candidate.vehicleId}, that stopped reporting.`;
    }
    case 'max_hold_cap_breach': {
      const cap =
        typeof constraints.maxHoldSeconds === 'number'
          ? `${constraints.maxHoldSeconds}s`
          : 'the limit set for it';
      return `The hold this would need is longer than ${cap}, the most this corridor allows.`;
    }
    case 'conflicting_active_command':
      return `${candidate.vehicleId} already has an instruction it has not finished; a second one would clash with it.`;
    case 'max_lateness_breach': {
      const bound =
        typeof constraints.maxLatenessSeconds === 'number'
          ? `${constraints.maxLatenessSeconds}s`
          : 'the limit set for it';
      const late =
        candidate.scheduleDeviationSeconds !== null &&
        candidate.scheduleDeviationSeconds !== undefined
          ? ` ${candidate.vehicleId} is already ${Math.round(candidate.scheduleDeviationSeconds)}s behind.`
          : '';
      // Deliberately not phrased as a hold-length problem: the hold is within
      // the cap. What fails is what it would do to the timetable, and an
      // operator who reads this as "the hold was too long" will reach for the
      // wrong lever.
      return `This hold would leave ${candidate.vehicleId} more than ${bound} behind schedule, which this corridor does not allow.${late}`;
    }
    case 'cooldown_active':
      return `${candidate.vehicleId} was given an instruction too recently. Repeated instructions to the same driver get ignored, so the engine waits.`;
    case 'below_minimum_action': {
      const minimum =
        typeof constraints.minimumActionSeconds === 'number'
          ? `${constraints.minimumActionSeconds}s`
          : 'the minimum set for it';
      return `The hold this needs is under ${minimum} — too short to be worth asking a driver for.`;
    }
  }
}

/**
 * Reading of `objectiveCost`, which is not a score and must not be shown as
 * one.
 *
 * It is passenger-seconds: the waiting this hold removes downstream, less
 * the delay it imposes on the people already aboard, less operator cost.
 * Negative means the hold is worth making. A dispatcher deciding whether to
 * approve needs the direction and the size of that trade, so both are said
 * in words rather than left as a signed number to interpret.
 *
 * Until this value existed the console reported the clamp residual here,
 * described as "distance from the ideal hold" — which explained the
 * controller's own rounding to an operator who has no use for it. That
 * number is still available as `clampResidualSeconds` and now reads as what
 * it is: evidence the hold cap shaped this recommendation.
 */
export function describeObjectiveCost(cost: number): string {
  const magnitude = Math.abs(Math.round(cost));
  if (magnitude === 0) {
    return 'this hold is projected to break even — it removes about as much waiting as it adds';
  }
  return cost < 0
    ? `this hold is projected to save about ${magnitude} passenger-seconds of waiting, after charging the delay to everyone already on board`
    : `this hold is projected to COST about ${magnitude} passenger-seconds — it adds more delay than the waiting it removes`;
}

/** Reading of `clampResidualSeconds` — how far the hold cap and rounding pulled the applied hold from what the control law asked for. */
export function describeClampResidual(seconds: number): string {
  return seconds === 0
    ? 'exactly the hold the formula asked for — nothing rounded it or capped it'
    : `${Math.round(seconds)}s shorter than the formula asked for, because the hold cap or rounding pulled it back`;
}

/**
 * How far AHEAD of now a reading may be stamped before it is reported as
 * future-dated rather than as an age.
 *
 * The browser clock and the clock that stamped the reading are different
 * clocks, so a few seconds either way is skew and not news. Matches
 * control-service's own FUTURE_STATE_TOLERANCE_SECONDS (src/mpc/safety.ts) and
 * its ingestion tolerance, so the two ends of this number agree on what
 * counts as impossible.
 */
export const FUTURE_READING_TOLERANCE_SECONDS = 120;

/**
 * The age of the sample a candidate was computed from — the freshness the
 * safety filter graded — as one of three genuinely different answers.
 *
 * ─── WHY 'future' IS A STATE AND NOT A CLAMPED ZERO ──────────────────────
 *
 * This used to be `Math.max(0, ...)`, which turned a reading stamped in the
 * future into "Reading age 0s" — the most reassuring readout on the panel,
 * shown for the least trustworthy data there is. A read-only query on the
 * live control database found a `vehicle_states` row with
 * `observed_at = 2046-03-27`, about 19.6 years ahead; under the clamp that
 * vehicle reads as perfectly fresh forever, and the operator has no way to
 * tell from the screen.
 *
 * The clamp existed to avoid rendering a negative age, which is a real
 * concern — a bare "-618000000s" is worse than useless. The answer is to name
 * the condition, not to hide it. `ageSeconds` is now only ever a real elapsed
 * time, and a reading from the future is its own state that the panel draws
 * in the alert tone.
 *
 * See control-service/src/mpc/safety.ts for the same two-sided judgement
 * applied where it decides whether a hold may be issued at all.
 */
export type SampleAge =
  | { state: 'aged'; ageSeconds: number }
  /** The reading claims to have been taken later than now, beyond any plausible clock skew. Its true age is unknown. */
  | { state: 'future'; secondsAhead: number }
  /** The timestamp could not be read at all. */
  | { state: 'unreadable' };

export function sampleAge(stateAsOf: string, now: number): SampleAge {
  const at = Date.parse(stateAsOf);
  if (Number.isNaN(at)) return { state: 'unreadable' };
  const seconds = Math.round((now - at) / 1000);
  if (seconds < -FUTURE_READING_TOLERANCE_SECONDS)
    return { state: 'future', secondsAhead: -seconds };
  // Inside the tolerance the difference is clock skew between two machines,
  // not a data defect, and an operator reading "-3s" would learn nothing.
  return { state: 'aged', ageSeconds: Math.max(0, seconds) };
}

/**
 * The sample age as an operator reads it, with the emphasis it has earned.
 *
 * `critical` for a future-dated reading is deliberate: it is not a slightly
 * worse version of stale, it is a reading whose age cannot be established at
 * all, and the engine's own safety filter refuses to act on it.
 */
export function describeSampleAge(age: SampleAge): {
  label: string;
  tone: 'default' | 'warn' | 'critical';
} {
  switch (age.state) {
    case 'aged':
      return { label: `${age.ageSeconds}s`, tone: age.ageSeconds > 60 ? 'warn' : 'default' };
    case 'future':
      return {
        label: `dated ${formatDuration(age.secondsAhead)} into the future`,
        tone: 'critical',
      };
    case 'unreadable':
      return { label: 'unknown', tone: 'warn' };
  }
}

/** A span an operator can size at a glance. Coarsens as it grows, because "618,000,000s" is not a duration anybody reads. */
function formatDuration(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5_400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172_800) return `${Math.round(seconds / 3_600)}h`;
  if (seconds < 31_557_600) return `${Math.round(seconds / 86_400)}d`;
  return `${(seconds / 31_557_600).toFixed(1)} years`;
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

/**
 * What the console says about alighting-only on this corridor.
 *
 * ─── WHY THIS IS NOT JUST A COUNT ────────────────────────────────────────
 *
 * "Let people off, take nobody on" is the one instruction here whose cost is
 * paid, visibly, by somebody who is not on the bus: a person stands at a stop
 * and watches a bus with room on it decline them. Every other lever spends the
 * timetable. So the console's job when it shows one of these is to put the
 * cost beside the benefit, and its job when it does NOT show one is to say
 * whether that is because there was nothing to show or because the corridor is
 * not allowed to be offered it. Those are different facts and a bare empty
 * list is the same shape for both.
 *
 * Three states, and the copy for each says what it is and what to do:
 *
 *  - `offered`   — proposals are being shown, with how much of the corridor's
 *                  refusal budget they have already spent.
 *  - `disabled`  — the corridor has not switched this on. The shipped state of
 *                  every corridor on the network.
 *  - `tripped`   — the corridor has issued as many of these instructions as its
 *                  policy allows, so it has stopped proposing.
 *
 * Null (a control service that predates the gate) returns null, and the panel
 * renders nothing: an absent field must never be dressed as a known state. So
 * does the disabled state when it withheld nothing — see the branch for why.
 *
 * ─── THE COUNT IS INSTRUCTIONS, NOT PEOPLE ───────────────────────────────
 *
 * Said in the copy every time, because the number is small enough to be
 * mistaken for a headcount and the difference matters enormously: six
 * instructions at a busy interchange is not six people, and nothing in this
 * system counts the people. Same rule as `leftBehindPassengers` being null —
 * a quotable wrong number about refused passengers is the worst thing this
 * page could carry.
 */
export interface BoardingLimitAvailabilityCopy {
  tone: 'info' | 'warn';
  headline: string;
  detail: string;
}

export function describeBoardingLimitAvailability(
  availability: BoardingLimitAvailability | null | undefined,
): BoardingLimitAvailabilityCopy | null {
  if (!availability) return null;

  const minutes = Math.max(1, Math.round(availability.windowSeconds / 60));
  const window = minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
  const instructions = (n: number) => `${n} ${n === 1 ? 'instruction' : 'instructions'}`;

  if (availability.offered) {
    const used = availability.refusalsInWindow ?? 0;
    return {
      tone: 'info',
      headline: `${used} of ${availability.maxRefusals} drop-off-only instructions used in the last ${window}`,
      detail: `${availability.remainingRefusals ?? 0} left before this corridor stops proposing them. That counts instructions sent to drivers, not the people refused — how many people a bus leaves behind is not measured.`,
    };
  }

  if (availability.withheldReason === 'disabled_for_corridor') {
    // ─── SILENT WHEN THERE WAS NOTHING TO WITHHOLD ─────────────────────
    //
    // Every corridor on this network has alighting-only switched off, so a
    // notice shown unconditionally here would appear on every solve of every
    // corridor forever. Copy that is always on screen is copy nobody reads,
    // and it would be sitting directly above the two states that must be read
    // — a suppressed proposal and a tripped wire.
    //
    // So the disabled state speaks only when it actually cost something: the
    // engine worked out a proposal here and was not allowed to offer it. That
    // number is precisely what an operator being asked whether to switch this
    // on for their corridor is being asked about.
    const withheld = availability.withheldCandidateCount;
    if (withheld === 0) return null;

    return {
      tone: 'info',
      headline: 'Drop-off only is switched off for this corridor',
      detail:
        `The engine worked out ${withheld} of ${withheld === 1 ? 'this instruction' : 'these instructions'} here and is not offering ${withheld === 1 ? 'it' : 'them'}. ` +
        'Measured on this network it makes waiting worse and leaves more people behind, and its cost falls on passengers watching a bus with room on it go past. Turning it on for one corridor is a service decision, not something the engine can settle.',
    };
  }

  // The tripwire. A warning and not an error: the corridor did what it was
  // configured to allow, and the bound then did its job.
  if (availability.refusalsInWindow === null) {
    return {
      tone: 'warn',
      headline: 'Drop-off only is paused — its refusal limit could not be checked',
      detail:
        'How many of these instructions this corridor has already issued could not be read, so none are being proposed. Nothing else about this recommendation is affected.',
    };
  }

  return {
    tone: 'warn',
    headline: `Drop-off only has stopped on this corridor — ${instructions(availability.refusalsInWindow)} in the last ${window}`,
    detail:
      `That is its limit of ${availability.maxRefusals}. ` +
      (availability.withheldCandidateCount > 0
        ? `${availability.withheldCandidateCount} ${availability.withheldCandidateCount === 1 ? 'proposal is' : 'proposals are'} being withheld. `
        : '') +
      'It starts proposing again on its own as those instructions age out of the window. This counts instructions, not the people refused, which is not measured.',
  };
}
