// Algorithm E - alighting-only: let people off, take nobody on, because the
// bus behind is right there.
//
// ─── WHY THIS LEVER IS DIFFERENT FROM EVERY OTHER ONE HERE ───────────────
//
// Every other law in this directory fixes spacing by ADDING delay. A hold
// makes a bus later on purpose, and buys even headways with punctuality. That
// trade is real and sometimes worth it, but it is a trade, and on a network
// whose operator's stated priorities are "fix bunching AND fix the delay
// bunching causes" it is only ever half a solution.
//
// Alighting-only is the exception. It fixes spacing by REMOVING delay:
//
//   In a bunched pair the leader is doing all the work. It arrives after a
//   normal gap, finds a full stop of waiting passengers, and spends a long
//   dwell loading them. That dwell makes it later, which lets the follower -
//   arriving moments later at an empty stop, with nobody to pick up - close
//   the gap further. The leader's own success at collecting passengers is
//   what drives the pair together. This is the amplification loop, and its
//   engine is boarding demand, not driver behaviour.
//
//   Telling the LEADER to let people off and take nobody on cuts its dwell to
//   the alighting time alone. It pulls away sooner, starts recovering the
//   time it lost, and the passengers it left standing are collected by the
//   follower a minute or two behind - which gains the dwell the leader shed,
//   slows slightly, and drops back. Both buses move toward where they should
//   be, and the leader gets EARLIER rather than later.
//
// So this is the only lever here that improves spacing and punctuality at the
// same time by acting on a stop, and the only one whose cost falls on people
// at the roadside rather than on the timetable.
//
// ─── WHO PAYS, AND WHY THE BOUND IS ABSOLUTE ─────────────────────────────
//
// The cost is real and it is concentrated: the people waiting at that stop
// watch a bus with room on it go past them. That is the single most visible
// thing a control system can do to a passenger, and it is the reason this law
// refuses far more often than it fires.
//
// The bound that matters is `boardingLimitMaxWaitSeconds` - how long those
// passengers will wait for the follower - and it is an ABSOLUTE bound in
// seconds, not a ratio of the planned headway. A ratio would scale the harm
// with the corridor: on a 1,800 s headway, "the follower is at 25% of target"
// is a 450 s wait for somebody who just watched a bus refuse them, which is
// not acceptable merely because the arithmetic says the buses are bunched.
// Harm to a person is measured in minutes of their life, so the bound is too.
//
// ─── WHY IT IS PROPOSED AND NOT AUTO-SELECTED ────────────────────────────
//
// Its benefit - the dwell the leader sheds - is the number this deployment
// cannot yet compute. It equals roughly `beta_h x h_fwd(leader)` from a
// fitted dwell model (src/calibration/dwell.ts), and no corridor has one yet:
// the fit needs a run of `stop_visits` at a single stop, which the GPS feed
// only started accumulating recently. Its COST is computable, but only
// through the same lambda proxy that is wrong by orders of magnitude
// (see `arrivalRatePaxPerSecond`).
//
// Ranking an action by a cost we can estimate against a benefit we cannot
// would put it last on every list, every time, which is not neutrality - it
// is a confident wrong answer. So the law generates the candidate whenever
// the STRUCTURAL conditions hold, states its trade in words, and leaves the
// choice to the operator. `dwellSavingSeconds` on the estimate is where the
// number goes once a dwell model exists, and at that point this can be ranked
// against the holds on one scale and selected like any other candidate.
//
// ─── AND WHY IT IS OFF ON EVERY CORRIDOR ─────────────────────────────────
//
// Measured, this law is not merely unpriced, it is negative on the corridor
// shape it was supposed to suit. Three independent investigations agree; the
// most recent is 16 paired phase-seeds on the urban preset:
//
//   excess wait                +3.6 points   16/16 seeds
//   total passenger time       +0.24 points  14/16 seeds
//   refused boardings          +1,295        16/16 seeds
//
// (Total passenger time is a GUARDRAIL here and positive means passengers
// SAVED time, so +0.24 is the arm WITHOUT this law doing better.) That is
// within a point of Delgado, Munoz & Giesen (2012) - 7.1% here against their
// 6.3% incremental - which is the strongest thing that can be said for the
// simulator and the worst thing that can be said for the lever. On suburban
// and inter-city it costs passenger time outright.
//
// So `boardingLimitAvailability` below is not a feature flag waiting to be
// flipped. It exists so that the day an operator decides the trade IS
// acceptable on one route - a service-policy decision about real riders,
// which no measurement in this repository can make for them - saying yes is
// one row of `route_policies`, bounded, visible and reversible, instead of a
// code change. It ships disabled on every corridor including urban.
//
// ─── WHAT THE TRIPWIRE CAN AND CANNOT DO ─────────────────────────────────
//
// State it plainly, because a safety control that is believed to do more than
// it does is worse than none.
//
// It CAN bound how many alighting-only INSTRUCTIONS a corridor issues in a
// rolling window, and it does so BEFORE the next one: once the count reaches
// the bound the law stops offering, so no operator can approve a proposal
// that is not on the screen. That is prevention, not just observation, and it
// is what makes switching one corridor on a bounded experiment.
//
// It CANNOT bound the harm. The unit it counts is "one bus told to take
// nobody on at one stop"; the harm is the number of people at that stop and
// how long each of them then waits, and this deployment measures neither.
// `leftBehindPassengers` is null for want of a fitted lambda, and
// `headway/deniedBoarding.ts` answers "cannot say" on every visit for want of
// an occupancy feed. One tripped instruction at a busy interchange can cost
// more than six at a quiet kerb, and nothing here can tell those apart.
//
// It is also NECESSARILY late by one: the count only reaches the bound
// because the bound-th instruction was already issued. So the honest
// description is a circuit breaker on the ACTION COUNT, evaluated before each
// offer, sizing an unmeasured harm by a measured proxy - and the reason the
// default bound is small.
import { canExecuteHold } from './eligibility.js';
import { arrivalRatePaxPerSecond } from './objective.js';
import type { CandidateAction } from './types.js';
import type { HeadwayStateRow, RoutePolicyRow, VehicleStateRow } from '../state/store.js';

/**
 * Longest a passenger left standing may be asked to wait for the next bus.
 *
 * Four minutes. Chosen as what a person waiting at a stop will accept having
 * watched a bus go by - not as a fraction of anything. Above it the honest
 * description of this action stops being "the next bus is right behind" and
 * becomes "we made you wait", and no spacing benefit is worth buying with
 * that.
 */
export const DEFAULT_MAX_LEFT_BEHIND_WAIT_SECONDS = 240;

/**
 * Shortest follower gap this will act on, seconds.
 *
 * Below this the two buses are not a leader and a follower, they are one
 * position reported twice. A live solve produced a 0.675 s gap - the follower
 * two thirds of a second behind - which is a map-matching artefact, a pair
 * mid-reorder, or two vehicles sharing a fix, and never a real headway.
 *
 * Acting on it is worse than useless: alighting-only at a sub-second gap
 * achieves no separation (the buses are already at the same place), while
 * still refusing passengers. The reactive detector will report a pair like
 * this as bunched, which is correct and is where it should be dealt with;
 * this law declining is not a gap in coverage.
 *
 * Thirty seconds is chosen as the shortest gap at which "the next bus is
 * right behind you" is a statement about two buses rather than about one.
 */
export const MIN_FOLLOWER_GAP_SECONDS = 30;

/**
 * How bunched the pair must be before this is even considered.
 *
 * The corridor's OWN `bunchedThresholdRatio`, not a constant. Two reasons,
 * and the second is why an earlier hardcoded 0.35 was wrong:
 *
 *  - Every other threshold in this system is config-not-code, read from
 *    `route_policies`. A literal here would mean one corridor could be tuned
 *    to call a pair bunched at 0.2 while this law acted on it at 0.35,
 *    silently disagreeing with the detection the operator configured.
 *
 *  - A constant above the policy threshold is LOOSER, not stricter. At 0.35
 *    against a default 0.25 this fired on pairs the corridor does not
 *    consider bunched at all - imposing a cost on waiting passengers to fix a
 *    problem the system had not declared. The bar for making passengers pay
 *    must be at least as high as the bar for reporting the problem, never
 *    lower.
 *
 * The absolute wait cap below is the second, independent bound, and on a long
 * corridor it is the one that binds: at H* = 1800 s the policy threshold
 * permits a 450 s gap, and nobody left standing should wait that long.
 */
export function maxFollowerGapSeconds(policy: {
  targetHeadwaySeconds: number;
  bunchedThresholdRatio: number;
}): number {
  return policy.bunchedThresholdRatio * policy.targetHeadwaySeconds;
}

/**
 * Refusal bound applied when a policy row carries none.
 *
 * NOT FITTED, and recorded as unfitted. No measurement supports any particular
 * number of refusals as acceptable, because nothing in this deployment counts
 * the people a bus refuses. It is small so that the first corridor switched on
 * trips the wire and comes back for a decision, rather than running a season on
 * a number nobody chose. Matches the column default in
 * `db/migrations/20260821100000__alighting_only_per_corridor.sql`, so a policy
 * row predating that column behaves like one written after it.
 */
export const DEFAULT_MAX_REFUSALS_PER_WINDOW = 6;

/**
 * Rolling window the refusal bound is counted over, seconds. One hour.
 *
 * Rolling rather than cumulative so the wire stays ARMED after it trips: a
 * corridor that stops refusing recovers on its own an hour later, instead of
 * being latched off until somebody notices and resets it. A latched breaker
 * turns a bounded experiment into an outage nobody is watching for.
 */
export const DEFAULT_REFUSAL_WINDOW_SECONDS = 3600;

/**
 * Why alighting-only proposals are not being offered on a corridor.
 *
 * An enum and not a sentence. The operator-facing wording for each of these
 * belongs in the web app's `src/lib/ops/recommendationView.ts`, which is where
 * this codebase decides what the console SAYS about a solve and where those
 * claims are tested; a sentence composed here would be a second copy of that
 * copy, out of reach of those tests. What crosses the wire is the fact.
 */
export type BoardingLimitWithheldReason =
  /** `route_policies.alighting_only_enabled` is false. The shipped state of every corridor. */
  | 'disabled_for_corridor'
  /** The corridor has issued as many alighting-only instructions in the window as its policy allows. */
  | 'refusal_tripwire';

/**
 * Whether this corridor may be shown alighting-only proposals, and the refusal
 * budget behind that answer.
 *
 * Returned on every solve whether or not anything was proposed, because the
 * two states a bare empty list collapses are the ones an operator most needs
 * apart: "the law looked and found nothing" and "the law found something and
 * is not allowed to tell you". The second is a fact about the corridor's
 * configuration and its recent refusals, and it has to arrive as one.
 */
export interface BoardingLimitAvailability {
  /** True only when the corridor is enabled AND under its refusal bound. */
  offered: boolean;
  /** Null when `offered`. */
  withheldReason: BoardingLimitWithheldReason | null;
  /**
   * Alighting-only instructions ISSUED on this corridor inside `windowSeconds`.
   *
   * Null means the meter was not read, which is the case on every disabled
   * corridor - reading it would be a database query per solve to inform a
   * decision already made. Null is "not read", never "zero".
   */
  refusalsInWindow: number | null;
  /** The bound `refusalsInWindow` is tested against. */
  maxRefusals: number;
  windowSeconds: number;
  /** `maxRefusals - refusalsInWindow`, floored at 0. Null whenever `refusalsInWindow` is. */
  remainingRefusals: number | null;
  /**
   * Proposals this decision withheld - what the operator is NOT being shown.
   *
   * Reported rather than silently dropped: a withheld count of zero and a
   * withheld count of four are the difference between a quiet corridor and a
   * suppressed one, and an operator deciding whether to raise the bound is
   * deciding about exactly this number.
   */
  withheldCandidateCount: number;
}

/** The corridor's alighting-only configuration, with the module defaults filled in. */
export function boardingLimitPolicy(policy: RoutePolicyRow): {
  enabled: boolean;
  maxRefusals: number;
  windowSeconds: number;
} {
  return {
    // Absent is OFF. See RoutePolicyRow.alightingOnlyEnabled for why this one
    // field does not fall back to a module default the way the others do.
    enabled: policy.alightingOnlyEnabled === true,
    maxRefusals: policy.alightingOnlyMaxRefusals ?? DEFAULT_MAX_REFUSALS_PER_WINDOW,
    windowSeconds: policy.alightingOnlyRefusalWindowSeconds ?? DEFAULT_REFUSAL_WINDOW_SECONDS,
  };
}

/**
 * The per-corridor gate and the refusal tripwire, in one decision.
 *
 * Pure: the caller reads the meter (`db/commands.ts#countBoardingLimitCommands`)
 * and hands the count in, or hands in null when it did not read it. Keeping the
 * query out of here is what lets a disabled corridor - every corridor today -
 * cost nothing extra per solve, and what lets this rule be tested without a
 * database.
 *
 * ─── THE COMPARISON IS `>=`, NOT `>` ───────────────────────────────────────
 *
 * `maxRefusals` is the most this corridor may have issued, so at exactly the
 * bound the next proposal is the one too many and is withheld. Reading it as
 * strictly-greater would let every corridor issue `maxRefusals + 1`, which is
 * the wrong direction to be wrong in for a control whose whole job is to bound
 * a harm nobody is counting.
 */
export function boardingLimitAvailability(
  policy: RoutePolicyRow,
  refusalsInWindow: number | null,
  candidateCount: number,
): BoardingLimitAvailability {
  const { enabled, maxRefusals, windowSeconds } = boardingLimitPolicy(policy);

  if (!enabled) {
    return {
      offered: false,
      withheldReason: 'disabled_for_corridor',
      refusalsInWindow: null,
      maxRefusals,
      windowSeconds,
      remainingRefusals: null,
      withheldCandidateCount: candidateCount,
    };
  }

  // Read the meter or refuse to guess. A null count on an ENABLED corridor
  // means the caller could not answer "how many refusals already?", and a
  // tripwire that cannot read its own meter must fail closed - the alternative
  // is that a database hiccup silently removes the bound at the moment the law
  // is live.
  if (refusalsInWindow === null) {
    return {
      offered: false,
      withheldReason: 'refusal_tripwire',
      refusalsInWindow: null,
      maxRefusals,
      windowSeconds,
      remainingRefusals: null,
      withheldCandidateCount: candidateCount,
    };
  }

  const remainingRefusals = Math.max(0, maxRefusals - refusalsInWindow);

  if (refusalsInWindow >= maxRefusals) {
    return {
      offered: false,
      withheldReason: 'refusal_tripwire',
      refusalsInWindow,
      maxRefusals,
      windowSeconds,
      remainingRefusals: 0,
      withheldCandidateCount: candidateCount,
    };
  }

  return {
    offered: true,
    withheldReason: null,
    refusalsInWindow,
    maxRefusals,
    windowSeconds,
    remainingRefusals,
    withheldCandidateCount: 0,
  };
}

export interface BoardingLimitEstimate {
  /**
   * Passengers estimated to be left standing, or NULL while lambda is a proxy.
   *
   * ─── WHY NULL AND NOT A NUMBER ─────────────────────────────────────────
   *
   * With lambda proxied as 1/H*, the estimate is `(1/H*) x gap_ahead_of_leader`,
   * which for any real gap lands between roughly 0 and 1 REGARDLESS of the
   * corridor, the time of day, or how busy the stop is. It is not an
   * imprecise passenger count; it is an artefact of the placeholder, and a
   * live solve produced 0.0007.
   *
   * Rendered, it becomes "about 1 passenger" on a stop where forty people are
   * waiting - a specific, confident, quotable number that is wrong by orders
   * of magnitude, attached to the one decision in this system that visibly
   * inconveniences passengers. Null is the honest value, and being null makes
   * it impossible for a surface to show it wrongly rather than merely
   * inadvisable.
   *
   * Becomes a real number when `fitDemandModel` has boardings to fit lambda
   * from; nothing else about this module needs to change then.
   */
  leftBehindPassengers: number | null;
  /** How long each of them waits for the follower, seconds. MEASURED - the one number here that means what it says. */
  leftBehindWaitSeconds: number;
  /** Their total extra waiting, passenger-seconds. Null for the same reason `leftBehindPassengers` is. */
  imposedWaitPassengerSeconds: number | null;
  /**
   * Dwell the leader would shed, seconds. NULL until a dwell model exists for
   * the stop - this is the benefit side, and it is not estimated from a
   * constant because a fabricated benefit is exactly what would make this
   * action look worth taking when nobody has checked.
   */
  dwellSavingSeconds: number | null;
  /** True while lambda is the 1/H* proxy, so `leftBehindPassengers` is an order-of-magnitude guess and must be shown as one. */
  lambdaIsProxy: boolean;
}

/** Everything the UI needs to state the trade, carried on the candidate. */
export interface BoardingLimitCandidate extends CandidateAction {
  actionType: 'boarding_limit';
  estimate: BoardingLimitEstimate;
}

export function isBoardingLimitCandidate(
  candidate: CandidateAction,
): candidate is BoardingLimitCandidate {
  return candidate.actionType === 'boarding_limit';
}

/**
 * Alighting-only candidates for every pair where the follower is close enough
 * to collect what the leader leaves.
 *
 * NOTE the inversion that runs through this whole file: every other law acts
 * on the FOLLOWER of a pair (the bus that is too close to the one ahead). This
 * one acts on the LEADER - the bus with another right behind it. Getting that
 * backwards would tell the empty bus to stop picking up while the full one
 * kept absorbing demand, which accelerates the bunch instead of breaking it.
 */
export function computeBoardingLimitCandidates(
  headwayStates: HeadwayStateRow[],
  policy: RoutePolicyRow,
  vehicleStatesByVehicleId: ReadonlyMap<string, VehicleStateRow> = new Map(),
  scheduleDeviationByVehicleId: ReadonlyMap<string, number | null> = new Map(),
  controlPointStopIds: ReadonlySet<string> = new Set(),
  terminalStopId: string | undefined = undefined,
  maxLeftBehindWaitSeconds: number = DEFAULT_MAX_LEFT_BEHIND_WAIT_SECONDS,
): BoardingLimitCandidate[] {
  const candidates: BoardingLimitCandidate[] = [];

  // The leader's OWN forward gap - how long the stop has been accumulating
  // passengers - comes from the row where the leader is itself a follower.
  const gapAheadOfVehicle = new Map<string, number>();
  for (const h of headwayStates) {
    if (h.hFwdSeconds !== null) gapAheadOfVehicle.set(h.followerVehicleId, h.hFwdSeconds);
  }

  for (const h of headwayStates) {
    const followerGapSeconds = h.hFwdSeconds;
    if (followerGapSeconds === null) continue;

    // 1. At least as bunched as THIS corridor calls bunched. Never looser -
    //    see maxFollowerGapSeconds.
    if (followerGapSeconds > maxFollowerGapSeconds(policy)) continue;

    // 1b. ...and far enough apart to be two buses at all. See
    //     MIN_FOLLOWER_GAP_SECONDS: below this it is one position reported
    //     twice, and separating a bus from itself refuses passengers for
    //     nothing.
    if (followerGapSeconds < MIN_FOLLOWER_GAP_SECONDS) continue;

    // 2. The people left standing must not wait long. Absolute, not a ratio.
    if (followerGapSeconds > maxLeftBehindWaitSeconds) continue;

    // 3. The LEADER is the bus we act on, and it must be somewhere it could
    //    act - at or approaching a stop. `canExecuteHold` names holds, but the
    //    question it answers is "is this bus at a stop it could do something
    //    about?", which is exactly the question here.
    const leaderState = vehicleStatesByVehicleId.get(h.leaderVehicleId);
    if (!canExecuteHold(leaderState, controlPointStopIds)) continue;

    // 4. Never at a terminal. People START journeys there, so there is no
    //    "you can take the next one in two minutes" - there is a queue of
    //    passengers whose trip has not begun, and refusing them is refusing
    //    the service itself rather than rebalancing it.
    if (terminalStopId && leaderState?.currentStopId === terminalStopId) continue;

    // 5. THE LEADER MUST BE AT THE FRONT OF THE BUNCH.
    //
    //    This is the assumption the whole action rests on, made explicit. The
    //    justification in the header is that the leader "arrives after a
    //    normal gap, finds a full stop of waiting passengers, and spends a
    //    long dwell loading them". A leader that is ITSELF bunched behind
    //    another bus did not arrive after a normal gap: the bus ahead of it
    //    cleared that stop moments ago, so few passengers are waiting, its
    //    dwell is not what is dragging it late, and stripping its boarding
    //    achieves nothing while pushing it closer to the bus in front.
    //
    //    Without this check a platoon of four (A B C D, pairs AB/BC/CD) told
    //    B and C to hold - correct, they are too close to the bus ahead - AND
    //    to take nobody on, which is the opposite instruction to the same
    //    driver at the same stop. Only A, the bus at the head of the bunch
    //    with a normal gap in front of it, has anything to gain.
    //
    //    A leader with NO measured gap ahead is the front-most bus on the
    //    corridor and passes: there is nothing in front of it to be bunched
    //    behind.
    const leaderOwnGapSeconds = gapAheadOfVehicle.get(h.leaderVehicleId);
    if (leaderOwnGapSeconds !== undefined && leaderOwnGapSeconds <= maxFollowerGapSeconds(policy)) {
      continue;
    }

    // 6. An EARLY leader must not do this. The whole justification is that the
    //    leader is losing time it needs to recover; a bus running ahead of its
    //    timetable has time in hand and should be spending it at the stop, not
    //    leaving people behind to build up a lead it will then have to be held
    //    to give back. Unknown deviation (no timetable) is permitted - the
    //    bunching evidence stands on its own.
    const leaderDeviation = scheduleDeviationByVehicleId.get(h.leaderVehicleId) ?? null;
    if (leaderDeviation !== null && leaderDeviation <= 0) continue;

    // lambda is still the 1/H* placeholder everywhere in this deployment, so
    // both passenger figures below are null. The arithmetic is written out
    // rather than deleted because it is correct the moment lambda is fitted -
    // `fitDemandModel` returning a real rate is the only change needed.
    const lambdaIsProxy = true;
    // Front-most bus: no measured gap ahead, so assume it arrived on a normal
    // headway. Guard 5 above has already established this leader is not
    // bunched behind anyone.
    const gapAheadOfLeader = leaderOwnGapSeconds ?? h.targetHeadwaySeconds;
    const leftBehindPassengers = lambdaIsProxy
      ? null
      : arrivalRatePaxPerSecond(h.targetHeadwaySeconds) * gapAheadOfLeader;

    const estimate: BoardingLimitEstimate = {
      leftBehindPassengers,
      // ─── A LOWER BOUND, AND MEASURED TO BE A LOOSE ONE ─────────────────
      //
      // This is how long until the follower REACHES this stop, and it is the
      // number an operator is shown as the cost of the action. It assumes the
      // follower then absorbs the whole queue at once.
      //
      // MEASURED in the fleet trial (docs/FLEET_TRIAL.md) on an urban corridor
      // where this reported ~90 s: the 415 passengers actually left behind
      // waited 103 extra hours between them, about 15 MINUTES each - roughly
      // ten times this figure - and 150 more people were denied a seat
      // entirely. The follower arrives carrying its own load, cannot fit a
      // double queue, and the overflow rolls forward to the bus after it. On a
      // corridor with no overtaking it is also stuck behind whatever delayed
      // the leader in the first place.
      //
      // So this number must never be presented as the cost of the action. It
      // is the best bound available without an occupancy feed on the follower,
      // and it is the reason this candidate is proposed and never auto-selected.
      leftBehindWaitSeconds: followerGapSeconds,
      imposedWaitPassengerSeconds:
        leftBehindPassengers === null ? null : leftBehindPassengers * followerGapSeconds,
      // Not estimated from a boarding-time constant on purpose: see the file
      // header. A benefit invented here is the number that would make this
      // look worth doing.
      dwellSavingSeconds: null,
      lambdaIsProxy,
    };

    candidates.push({
      actionType: 'boarding_limit',
      vehicleId: h.leaderVehicleId,
      involvedVehicleIds: [h.leaderVehicleId, h.followerVehicleId],
      // Not a hold. Zero is the honest length of an action that asks a driver
      // to spend LESS time at a stop, and mpc/safety.ts exempts non-hold
      // actions from the hold-length and minimum-action checks rather than
      // reading this as a no-op.
      holdSeconds: 0,
      // ─── DELIBERATELY UNPRICED, NOT FREE ────────────────────────────────
      //
      // Zero because NEITHER side of this action's trade can be priced today:
      // the cost needs lambda (proxied) and the benefit needs a dwell model
      // (unfitted). A number here would have to be one of the two, and either
      // would be a fiction that then competed on a ranking.
      //
      // Zero is safe to publish only BECAUSE this candidate is excluded from
      // every ranking in the solver - see mpc/solver.ts, where it is filtered
      // out of `safeMidRoute`. If it were ever ranked, zero would sort it
      // first and read as "costs nothing", which is the opposite of true.
      // The actionable number is `estimate.leftBehindWaitSeconds`.
      objectiveCost: 0,
      clampResidualSeconds: 0,
      passengerCost: {
        waitPassengerSeconds: 0,
        onboardPassengerSeconds: 0,
        operatorPassengerSeconds: 0,
        latenessPassengerSeconds: 0,
        netPassengerSeconds: 0,
        loadEstimated: true,
        backwardEstimated: h.hBwdSeconds === null,
        scheduleUnknown: leaderDeviation === null,
      },
      rationale: explainBoardingLimit(h, estimate, leaderDeviation),
      scheduleDeviationSeconds: leaderDeviation,
      routeDirectionId: h.routeDirectionId,
      stateAsOf: h.computedAt,
      headwayDeviationSeconds: followerGapSeconds - h.targetHeadwaySeconds,
      targetHeadwaySeconds: h.targetHeadwaySeconds,
      estimate,
    });
  }

  // Most bunched pair first: the tighter the pair, the shorter the wait it
  // imposes and the stronger the case. Note this is the OPPOSITE ordering
  // sense to the holds, which sort ascending on a cost that is negative when
  // beneficial - another reason this action is not thrown onto the same
  // ranking until its benefit can be priced.
  candidates.sort((a, b) => a.estimate.leftBehindWaitSeconds - b.estimate.leftBehindWaitSeconds);

  // ─── ONE PROPOSAL PER BUS ──────────────────────────────────────────────
  //
  // The same leader can appear in several pairs at once. It is not supposed
  // to - a linear ordering gives each bus exactly one follower - but the
  // boot-time rehydrate keeps the latest sample per (leader, follower) across
  // ALL history (`distinct on` in db/rehydrate.ts), so a bus that had a
  // different follower an hour ago is still carrying that pair until the
  // first sweep replaces the direction. A live solve produced three
  // proposals naming one vehicle, with three different waits.
  //
  // Two of those are wrong and a reader cannot tell which. Worse, they are
  // not two options: "drop off only at UP34CT0263" twice, with different
  // justifications, is one instruction that cannot be followed - the same
  // reason mpc/solver.ts#selectActions de-duplicates the holds by vehicle.
  //
  // The survivor is the most urgent, which after the sort above is the first
  // seen: the shortest wait is both the strongest case for acting and the
  // pair most likely to be the current one.
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.vehicleId)) return false;
    seen.add(candidate.vehicleId);
    return true;
  });
}

/**
 * One sentence naming both sides of the trade.
 *
 * The imposed cost is stated FIRST and in people, not passenger-seconds,
 * because that is the part an operator is accountable for and the part a
 * passenger will phone about. An explanation that leads with the benefit and
 * buries the cost is how a control room ends up doing this at a stop where it
 * should not have.
 */
function explainBoardingLimit(
  h: HeadwayStateRow,
  estimate: BoardingLimitEstimate,
  leaderDeviationSeconds: number | null,
): string {
  // Stated in whichever unit is honest for the size of the number. A 40s gap
  // rounded to "about 1 min" overstates it; a 400s gap read out in seconds is
  // arithmetic the operator has to do under time pressure.
  const waitSeconds = Math.round(estimate.leftBehindWaitSeconds);
  const wait = waitSeconds < 90 ? `${waitSeconds}s` : `about ${Math.round(waitSeconds / 60)} min`;

  const lateness =
    leaderDeviationSeconds === null
      ? 'its lateness is not measurable without a timetable'
      : `it is ${Math.round(leaderDeviationSeconds / 60)} min behind schedule`;

  // No passenger count. Under the current lambda placeholder any figure here
  // would be an artefact rather than an estimate - see BoardingLimitEstimate.
  return (
    `Let passengers off ${h.leaderVehicleId} but take none on: ${h.followerVehicleId} is ` +
    `${waitSeconds}s behind, so anyone left standing waits ${wait}. This cuts ` +
    `${h.leaderVehicleId}'s dwell so it can pull away and recover — ${lateness} — while the bus ` +
    `behind picks up the demand it was left. How much time that saves is not yet measurable: ` +
    `no dwell model is fitted for this stop.`
  );
}
