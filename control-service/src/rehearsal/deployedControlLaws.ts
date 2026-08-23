// A simulator `Controller` that runs the DEPLOYED control laws, not a
// reimplementation of them.
//
// ─── WHY THIS FILE IS HERE AND NOT IN simulation/ ────────────────────────
//
// `control-service/src/simulation/**` may not import `../mpc/*` or
// `../headway/*` - that isolation is the acceptance criterion behind the
// mesoscopic simulator ("simulator runs write no production data and never
// touch the live command path"), and it is what lets the engine be a pure
// in-memory computation. This module is the adapter that sits OUTSIDE that
// boundary and depends on both, so the boundary itself is unchanged:
// nothing new points from `simulation/` into the live tree.
//
// The direction of the dependency is the whole design. `simulation/`
// produces plain data. This module hands that plain data to the same pure
// functions the live decision cycle calls, and hands their answer back. It
// still reaches no database, issues no command and writes no row.
//
// ─── WHAT IS ACTUALLY REUSED ─────────────────────────────────────────────
//
// Every one of these is imported from the module the production decision
// cycle imports it from, not copied:
//
//   headway/metrics.ts#computePairHeadways      h_fwd / h_bwd from one gap
//   mpc/terminalDispatch.ts#compute...Candidates  Algorithm A (blueprint 8.2)
//   mpc/twoWayHold.ts#computeTwoWayCandidates   Algorithm B (blueprint 8.3)
//   mpc/selfEqualizing.ts#compute...Candidates  Algorithm C (blueprint 8.4)
//   mpc/costOptimalHold.ts#compute...Candidates the closed-form argmin
//   mpc/boardingLimit.ts#compute...Candidates   alighting-only
//   mpc/safety.ts#applyHardSafetyFilter         the hard guardrail (9.1 §5)
//   mpc/solver.ts#selectActions                 the selection rule itself
//   mpc/occupancyMpc.ts#computePredictiveAdvisory   Algorithm E (8.6)
//
// The selection rule is not re-stated here, it is CALLED. It used to be
// re-stated - "safe terminal first, then the first safe mid-route candidate"
// - and that quietly diverged from production the day `mpc/solver.ts` began
// sorting the mid-route pool by `objectiveCost` before choosing. A rehearsal
// that picks a different candidate from the one the deployed solver would
// pick is not a rehearsal of the deployed solver.
//
// ─── WHAT IS NOT REHEARSED, SAID PLAINLY ─────────────────────────────────
//
//   * COMMAND LIFECYCLE, and therefore ACHIEVABLE RATE. `policy.cooldownSeconds`,
//     `minimumActionSeconds`, `maxConcurrentActions`, acknowledgement and TTL
//     live in the command path, which this deliberately does not touch. Two
//     consequences a reader must hold on to: a rehearsal shows the control
//     law's INTENT, not the rate at which commands would actually reach a
//     driver; and because the simulator's `Controller` interface decides one
//     vehicle at a time at a stop, the per-corridor per-cycle concurrency cap
//     has nothing to bite on - `selectActions` is called with a cap of one,
//     which is the correct projection of the deployed rule onto a
//     single-vehicle decision, not an approximation of it.
//   * THE STATE ESTIMATOR. Production derives distance-along-route by map-
//     matching a GPS fix and filtering it, and excludes low-confidence
//     vehicles from the leader/follower chain before any headway is
//     computed. The simulator knows its own world exactly, so it reports
//     full confidence and that exclusion path never fires.
import { computePairHeadways, STATIONARY_SPEED_KMPH } from '../headway/metrics.js';
import {
  computeTerminalDispatchCandidates,
  departureHeadwaySeconds,
  isAtTerminal,
} from '../mpc/terminalDispatch.js';
import { computeTwoWayCandidates } from '../mpc/twoWayHold.js';
import { computeSelfEqualizingCandidates } from '../mpc/selfEqualizing.js';
import { computeCostOptimalCandidates } from '../mpc/costOptimalHold.js';
import { computeBoardingLimitCandidates, isBoardingLimitCandidate } from '../mpc/boardingLimit.js';
import { canExecuteHold } from '../mpc/eligibility.js';
import { applyHardSafetyFilter, DEFAULT_STATE_STALE_SECONDS } from '../mpc/safety.js';
import { computePredictiveAdvisory } from '../mpc/occupancyMpc.js';
import { selectActions } from '../mpc/solver.js';
import { loadEnv } from '../config/env.js';
import type {
  CandidateAction,
  PredictiveAdvisory,
  SafetyRejection,
  SafetyRejectionReason,
} from '../mpc/types.js';
import type { RoutePolicyRow, HeadwayStateRow, VehicleStateRow } from '../state/store.js';
import type { OrderedVehicle } from '../state-estimation/types.js';
import type {
  Controller,
  ControllerContext,
  ControllerDecision,
  CorridorKinematicState,
} from '../simulation/types.js';

export const REHEARSAL_CONTROLLER_NAME = 'deployed-control-laws';

/**
 * The five candidate families the deployed solver generates, named so a
 * rehearsal can report which of them ever actually ran.
 *
 * COVERAGE IS A FINDING, NOT A FOOTNOTE. Before the engine advanced every
 * vehicle on one clock, `two_way` generated nothing on any run ever
 * performed, because h_bwd was structurally unavailable - and nothing said
 * so. A KPI table from that state looks like a verdict on the controller
 * when it is a verdict on one of its laws. A law at 0% is the first thing a
 * reader of an evaluation needs to know.
 */
export type ControlLaw =
  | 'terminal_dispatch'
  | 'two_way'
  | 'self_equalizing'
  | 'cost_optimal'
  | 'boarding_limit';

export const CONTROL_LAWS: readonly ControlLaw[] = [
  'terminal_dispatch',
  'two_way',
  'self_equalizing',
  'cost_optimal',
  'boarding_limit',
];

/**
 * Why a law produced no candidate at this decision point.
 *
 * Derived from the same preconditions the laws document and test, not from
 * instrumenting their internals - a copy of their branching would be one more
 * thing that can drift from them. Where a precondition is a shared function
 * (`canExecuteHold`) it is called here rather than re-implemented, and where
 * the law simply decided no hold was warranted, that is reported as exactly
 * that rather than guessed at more precisely.
 */
export type DeclineReason =
  | 'no_leader_on_corridor'
  | 'not_at_terminal'
  | 'no_measured_terminal_departure'
  | 'suppressed_by_terminal_regulation'
  | 'gains_unset'
  | 'self_equalizing_gain_unset'
  | 'h_fwd_unavailable'
  | 'h_bwd_unavailable'
  | 'two_way_covers_pair'
  | 'not_eligible_to_hold'
  /** Alighting-only acts on the LEADER, and the leader was not at a stop it could act at. */
  | 'leader_not_at_stop'
  | 'no_hold_indicated';

export interface DecisionCoverage {
  /** How many candidates each law produced here. */
  generated: Record<ControlLaw, number>;
  /** For each law that produced none, why. Null when it produced at least one. */
  declined: Record<ControlLaw, DeclineReason | null>;
  /** Every distinct reason the hard safety filter gave for throwing a candidate out here. */
  safetyRejectionReasons: SafetyRejectionReason[];
  /** True when this decision point is the origin terminal. */
  atTerminal: boolean;
  /** Whether the corridor gave this vehicle a bus ahead / a bus behind at this instant. */
  hasLeader: boolean;
  hasTrailer: boolean;
}

/**
 * One control-point decision, with the evidence behind it.
 *
 * Kept in full rather than reduced to a hold length because the surface
 * this feeds exists to let a planner see WHY the engine would act, and
 * because a rejected candidate is the single most useful thing a rehearsal
 * can show: it is the guardrail doing its job.
 */
export interface RehearsalDecisionRecord {
  atSeconds: number;
  stopId: string;
  vehicleId: string;
  leaderVehicleId: string | null;
  /** Metres between leader and follower at this instant, as the deployed gap computation measures it. */
  gapMeters: number | null;
  hFwdSeconds: number | null;
  hBwdSeconds: number | null;
  candidates: CandidateAction[];
  rejected: SafetyRejection[];
  selectedActionType: ControllerDecision['actionType'];
  holdSeconds: number;
  /** Modelled passengers aboard the deciding vehicle on arrival. Modelled, never observed - see `occupancy` below. */
  onboardCount: number | null;
  occupancy: {
    /**
     * The occupancy-weighted MPC tier run exactly as production runs it
     * today: no occupancy reading and, on every seeded corridor, no
     * configured capacity either, so it falls back to its fixed mid-load
     * assumption. `occupancyEstimated` is true on every candidate.
     */
    asDeployedToday: PredictiveAdvisory;
    /**
     * The same real function, given the simulator's MODELLED onboard count
     * and a MODELLED capacity. This is the only way this tier has ever run
     * on a real number in this system, and it is a number the simulator
     * invented. Present so a planner can see what occupancy data would
     * change - never as evidence about any actual bus.
     */
    withModelledOccupancy: PredictiveAdvisory;
  } | null;
  /** Which of the deployed laws ran here, which declined and why. See `DecisionCoverage`. */
  coverage: DecisionCoverage;
}

export interface DeployedControlLawsOptions {
  /** The corridor's own `route_policies` row, loaded by the same reader the live path uses. */
  policy: RoutePolicyRow;
  /** Wall-clock instant that simulated second 0 maps to. Only its differences matter, but the deployed staleness filter compares real Dates. */
  epochMs: number;
  /** Modelled seat capacity, used solely to give the occupancy-weighted tier a denominator. See `RehearsalDecisionRecord.occupancy`. */
  modelledCapacity: number;
  /**
   * Whether `cost_optimal_hold` may be SELECTED, not merely generated and
   * scored. Defaults to the deployed switch (`COST_OPTIMAL_SELECTION_ENABLED`)
   * so a rehearsal reproduces today's behaviour; overridable so an evaluation
   * run can measure what flipping it would do before anyone flips it.
   */
  costOptimalSelectable?: boolean;
  /**
   * Where the follower's reported SPEED comes from, which decides what h_fwd
   * the deployed laws are handed at the one instant they can act.
   *
   * ─── WHY THIS IS AN OPTION AND NOT A DETAIL ────────────────────────────
   *
   * `computePairHeadways` derives h_fwd as `gap / follower speed`. The engine
   * asks for a decision when a bus ARRIVES at a stop, and supplies the pace it
   * averaged over the link it just finished - the finest resolution the engine
   * has. Production reads `vehicle_states.speed_kmph`, and a bus at a stop
   * reports ~0 there, which `computePairHeadways` floors at MIN_SPEED_KMPH = 1
   * and turns into an h_fwd of hours.
   *
   * Those two inputs describe the same bus and disagree by a factor of sixty.
   * MEASURED on a 4 km gap where the corridor's nominal gap is 30 km: the link
   * pace reports h_fwd 240 s (ratio 0.13, bunched, hold 600 s) and the vehicle
   * state reports 14,400 s (ratio 8.0, "fine", no candidate at all).
   *
   *   'link_average'  the engine's pace. The optimistic end of the range, and
   *                   the historical default, kept so existing rehearsals do
   *                   not change underneath their readers.
   *   'vehicle_state' 0 km/h while the bus is at the stop, which is what
   *                   production's own row says. The pessimistic end.
   *
   * Production sits between the two: its headway states are up to one sweep
   * (60 s) old, so whether the last sweep caught the bus moving or standing is
   * a lottery. An evaluation that wants to know what the deployed system
   * really does must run both ends and report the range.
   */
  followerSpeedSource?: 'link_average' | 'vehicle_state';
  /**
   * The corridor's stations, so a NEIGHBOUR can be given a vehicle state too.
   *
   * ─── WHY THIS EXISTS ───────────────────────────────────────────────────
   *
   * This adapter used to build exactly one `VehicleStateRow`, for the vehicle
   * being decided about. Every deployed law that asks a question about a
   * DIFFERENT bus therefore got `undefined` and silently declined.
   *
   * `mpc/boardingLimit.ts` - the alighting-only law, and the only lever in the
   * system that improves spacing by REMOVING delay rather than adding it -
   * acts on the LEADER of a bunched pair and checks `canExecuteHold(leader)`
   * before proposing anything. With no leader row that check could never pass,
   * so Algorithm D generated zero candidates on every rehearsal and every
   * evaluation ever run, and the coverage report attributed it to
   * `no_hold_indicated` - "the law looked and decided not to act" - when the
   * truth was that the law was never given the input it needed. A law reported
   * at 0% for a reason that belongs to the harness is worse than no coverage
   * number at all.
   *
   * Omit it and the behaviour is exactly what it was: neighbours carry no
   * state and the laws that need one decline.
   */
  corridorStops?: readonly { stopId: string; cumulativeDistanceMeters: number }[];
  /**
   * Whether the objective weighs the in-vehicle term
   * (`control_settings.weigh_occupancy`).
   *
   * Defaults TRUE, which is what every generator defaults to for a direct
   * caller and therefore what this rehearsal has always done - not what the
   * live network runs, which is OFF. Left as it was rather than quietly
   * re-pointed at the live setting, because that would change every existing
   * rehearsal's numbers as a side effect of a different change; an evaluation
   * run that wants the deployed setting passes it.
   */
  weighOccupancy?: boolean;
}

/**
 * How old a vehicle's last reading is made to look when the scenario has
 * knocked its feed out.
 *
 * One second past the deployed freshness bound, rather than an arbitrary
 * large age: it puts the reading exactly on the wrong side of the real
 * threshold, so the rejection that follows is that threshold's doing and
 * not a margin chosen here.
 */
const STALE_READING_AGE_SECONDS = DEFAULT_STATE_STALE_SECONDS + 1;

/**
 * Below this a neighbouring vehicle is treated as standing at a station.
 *
 * Matches `headway/metrics.ts#STATIONARY_SPEED_KMPH`, and for the same reason:
 * the two modules must agree about which buses are moving, or one of them will
 * measure a pace against a vehicle the other calls stopped.
 */
const NEIGHBOUR_MOVING_SPEED_KMPH = STATIONARY_SPEED_KMPH;

function isoAt(epochMs: number, seconds: number): string {
  return new Date(epochMs + seconds * 1000).toISOString();
}

export interface DeployedControlLawsController extends Controller {
  /** Every control-point decision this controller made, in the order it made them. */
  readonly decisions: readonly RehearsalDecisionRecord[];
}

/** An all-laws-zero starting point, so a coverage record always names every law rather than only the ones that happened to run. */
function emptyCoverage(): Pick<DecisionCoverage, 'generated' | 'declined'> {
  const generated = {} as Record<ControlLaw, number>;
  const declined = {} as Record<ControlLaw, DeclineReason | null>;
  for (const law of CONTROL_LAWS) {
    generated[law] = 0;
    declined[law] = null;
  }
  return { generated, declined };
}

export function createDeployedControlLawsController(
  options: DeployedControlLawsOptions,
): DeployedControlLawsController {
  const { policy, epochMs, modelledCapacity } = options;
  const weighOccupancy = options.weighOccupancy ?? true;
  const followerSpeedSource = options.followerSpeedSource ?? 'link_average';
  const corridorStops = options.corridorStops ?? null;

  /**
   * The station a neighbour is standing at, or null when it is between them.
   *
   * A vehicle the engine reports at zero pace is dwelling, and on this corridor
   * a dwelling bus is at a station by construction - the engine only ever stops
   * a vehicle at one. The nearest station at or behind its position is the one
   * it is standing at; a tolerance is not needed because the position is
   * interpolated from that station's own recorded visit.
   */
  const stationAt = (distanceAlongRouteMeters: number): string | null => {
    if (!corridorStops) return null;
    let found: string | null = null;
    for (const stop of corridorStops) {
      if (stop.cumulativeDistanceMeters <= distanceAlongRouteMeters + 1) found = stop.stopId;
      else break;
    }
    return found;
  };

  /**
   * A neighbour's state as `vehicle_states` would carry it.
   *
   * Stationary means `dwelling_at_stop` with the station named, which is the
   * state a hold or a boarding limit can be executed from. Moving means
   * `departed_stop` with no current stop, which is the state in which nothing
   * can be asked of it - the same distinction `mpc/eligibility.ts` draws.
   */
  const neighbourState = (
    state: CorridorKinematicState,
    routeDirectionId: string,
    observedAtIso: string,
  ): VehicleStateRow => {
    const stationary = state.speedKmph !== null && state.speedKmph < NEIGHBOUR_MOVING_SPEED_KMPH;
    const currentStopId = stationary ? stationAt(state.distanceAlongRouteMeters) : null;
    return {
      vehicleId: state.vehicleId,
      tripId: null,
      routeDirectionId,
      position: null,
      distanceAlongRouteMeters: state.distanceAlongRouteMeters,
      speedKmph: state.speedKmph,
      headingDegrees: null,
      stopState: stationary && currentStopId ? 'dwelling_at_stop' : 'departed_stop',
      currentStopId,
      confidence: 1,
      isLowConfidence: false,
      observedAt: observedAtIso,
      // Never modelled for a neighbour. The trial models occupancy for the
      // deciding vehicle only, and inventing one for a bus nobody asked about
      // would put a fabricated number into the objective's load term.
      occupancyCount: null,
      occupancyLoadBand: null,
    };
  };
  const costOptimalSelectable =
    options.costOptimalSelectable ?? loadEnv().COST_OPTIMAL_SELECTION_ENABLED;
  const decisions: RehearsalDecisionRecord[] = [];

  // The occupancy-weighted tier needs a capacity to divide an onboard count
  // by. Every seeded corridor's route_policies row has
  // `occupancy_capacity IS NULL`, because nothing in this system has ever
  // had an occupancy reading to size a capacity against. The MODELLED arm
  // supplies the simulator's own capacity; the AS-DEPLOYED arm keeps the
  // real policy untouched, so it reproduces today's behaviour exactly.
  const modelledOccupancyPolicy: RoutePolicyRow = {
    ...policy,
    occupancyCapacity: modelledCapacity,
    // No configured staleness bound, so a modelled reading is never aged
    // out. The reading is the simulator's own state at this instant; there
    // is no sensor for it to be stale relative to.
    occupancyStaleSeconds: null,
  };

  function decide(context: ControllerContext): ControllerDecision {
    const kinematics = context.kinematics ?? null;
    const atTerminal = context.isTerminal === true;
    const noAction = (record: Partial<RehearsalDecisionRecord> = {}): ControllerDecision => {
      const base = emptyCoverage();
      // No leader means no headway state, so no law had an input to decline
      // on - which is itself the reason, and the one every law shares here.
      for (const law of CONTROL_LAWS) base.declined[law] = 'no_leader_on_corridor';
      decisions.push({
        atSeconds: context.now,
        stopId: context.stopId,
        vehicleId: context.vehicleId,
        leaderVehicleId: kinematics?.leader.vehicleId ?? null,
        gapMeters: null,
        hFwdSeconds: null,
        hBwdSeconds: null,
        candidates: [],
        rejected: [],
        selectedActionType: 'no_control',
        holdSeconds: 0,
        onboardCount: context.onboardCount ?? null,
        occupancy: null,
        coverage: {
          ...base,
          safetyRejectionReasons: [],
          atTerminal,
          hasLeader: kinematics !== null,
          hasTrailer: kinematics?.trailer != null,
        },
        ...record,
      });
      return { holdSeconds: 0, actionType: 'no_control' };
    };

    // No vehicle ahead on the corridor at this instant, or a corridor with
    // no measured geometry. Production's answer to both is the same: no
    // headway state exists for this vehicle, so no candidate is generated.
    if (!kinematics) return noAction();

    const nowIso = isoAt(epochMs, context.now);
    const now = new Date(epochMs + context.now * 1000);

    const followerId = kinematics.follower.vehicleId;
    const leaderId = kinematics.leader.vehicleId;
    // The vehicle behind, when the caller has one. `engine.ts` never does -
    // see `ControllerKinematics.trailer` - so in a scenario run this stays
    // null, h_bwd comes back null from the deployed gap computation, and
    // two-way holding correctly declines the pair in favour of the
    // self-equalizing fallback. That is the deployed degradation path
    // running, not a rehearsal shortcut.
    const trailer = kinematics.trailer ?? null;
    const trailerId = trailer?.vehicleId ?? null;

    const ordered: OrderedVehicle[] = [
      {
        vehicleId: leaderId,
        routeDirectionId: context.routeDirectionId,
        distanceAlongRouteMeters: kinematics.leader.distanceAlongRouteMeters,
        isLowConfidence: false,
        rank: 0,
        leaderVehicleId: null,
        followerVehicleId: followerId,
      },
      {
        vehicleId: followerId,
        routeDirectionId: context.routeDirectionId,
        distanceAlongRouteMeters: kinematics.follower.distanceAlongRouteMeters,
        isLowConfidence: false,
        rank: 1,
        leaderVehicleId: leaderId,
        followerVehicleId: trailerId,
      },
    ];
    if (trailer && trailerId) {
      ordered.push({
        vehicleId: trailerId,
        routeDirectionId: context.routeDirectionId,
        distanceAlongRouteMeters: trailer.distanceAlongRouteMeters,
        isLowConfidence: false,
        rank: 2,
        leaderVehicleId: followerId,
        followerVehicleId: null,
      });
    }

    // The deciding bus is standing at a stop - that is the only state a hold
    // can be executed from (`mpc/eligibility.ts`). Under 'vehicle_state' it
    // therefore reports the zero its own `vehicle_states` row would carry,
    // which is what the deployed h_fwd is actually computed from. See
    // `followerSpeedSource`.
    const followerSpeedKmph =
      followerSpeedSource === 'vehicle_state' ? 0 : kinematics.follower.speedKmph;
    const speedByVehicleId = new Map<string, number | null>([
      [leaderId, kinematics.leader.speedKmph],
      [followerId, followerSpeedKmph],
    ]);
    if (trailerId) speedByVehicleId.set(trailerId, trailer!.speedKmph);
    // Full confidence: the simulator knows its own world exactly. See this
    // file's header - the state estimator's low-confidence exclusion is not
    // rehearsed, and pretending to a fractional confidence here would be
    // inventing an uncertainty the model does not have.
    const confidenceByVehicleId = new Map<string, number>([
      [leaderId, 1],
      [followerId, 1],
    ]);
    if (trailerId) confidenceByVehicleId.set(trailerId, 1);

    const pairs = computePairHeadways(
      ordered,
      speedByVehicleId,
      confidenceByVehicleId,
      { totalDistanceMeters: kinematics.totalDistanceMeters },
      context.routeDirectionId,
      policy.targetHeadwaySeconds,
    );

    // One row per leader/follower link, so a three-vehicle chain yields two.
    // The decision is about `followerId`, and the row that carries its
    // headways is the one where it is the FOLLOWER - selecting by index
    // would silently start deciding about the trailer the day the chain
    // grows again.
    const pair = pairs.find((p) => p.followerVehicleId === followerId);
    if (!pair) return noAction();

    const headwayStates: HeadwayStateRow[] = [
      {
        id: `rehearsal-${followerId}-${context.stopId}-${Math.round(context.now)}`,
        routeDirectionId: context.routeDirectionId,
        leaderVehicleId: pair.leaderVehicleId,
        followerVehicleId: pair.followerVehicleId,
        hFwdSeconds: pair.hFwdSeconds,
        hBwdSeconds: pair.hBwdSeconds,
        targetHeadwaySeconds: pair.targetHeadwaySeconds,
        deviationSeconds: pair.deviationSeconds,
        computedAt: nowIso,
      },
    ];

    // A knocked-out feed does not remove the last known position; it makes
    // its age the reason not to act. Stamping it past the deployed bound is
    // what turns this into a real `stale_state` rejection rather than an
    // engine-side veto.
    const readingAgeSeconds = context.isStateStale ? STALE_READING_AGE_SECONDS : 0;
    const followerObservedAt = isoAt(epochMs, context.now - readingAgeSeconds);
    const vehicleObservedAtByVehicleId = new Map<string, string>([
      [leaderId, nowIso],
      [followerId, followerObservedAt],
    ]);


    const vehicleStates = new Map<string, VehicleStateRow>([
      [
        followerId,
        {
          vehicleId: followerId,
          tripId: null,
          routeDirectionId: context.routeDirectionId,
          position: null,
          distanceAlongRouteMeters: kinematics.follower.distanceAlongRouteMeters,
          speedKmph: followerSpeedKmph,
          headingDegrees: null,
          // `dwelling_at_stop`, not 'at_stop': the latter is not one of the
          // six values `vehicle_states.stop_state` admits, and the deployed
          // hold-eligibility check reads this field. The engine decides at
          // the moment a vehicle is occupying the stop.
          stopState: 'dwelling_at_stop',
          currentStopId: context.stopId,
          confidence: 1,
          isLowConfidence: false,
          observedAt: followerObservedAt,
          occupancyCount: context.onboardCount ?? null,
          occupancyLoadBand: null,
        },
      ],
    ]);
    // The neighbours, when the caller supplied the geometry to place them. See
    // `corridorStops` for the law this was silencing.
    if (corridorStops) {
      vehicleStates.set(leaderId, neighbourState(kinematics.leader, context.routeDirectionId, nowIso));
      if (trailer && trailerId) {
        vehicleStates.set(trailerId, neighbourState(trailer, context.routeDirectionId, nowIso));
      }
    }
    // `route_direction_stops` sequence 0 is the origin terminal, and the
    // engine says when a decision is being made there. Naming it turns on
    // Algorithm A, which was unreachable for as long as this was undefined:
    // `isAtTerminal` compares against it, so an undefined terminal meant no
    // bus was ever at one and the highest-return lever in the blueprint
    // generated nothing on any rehearsal ever run.
    const terminalStopId = atTerminal ? context.stopId : undefined;
    // The vehicle state map is passed through because the deployed laws now
    // decline to propose a hold to a vehicle that could not execute one
    // (mpc/eligibility.ts). The engine only asks for a decision at a stop, so
    // the state above reports `dwelling_at_stop` and every simulated control
    // point is eligible - an EMPTY control-point set means "any stop", which
    // is the right reading for a synthetic corridor that has designated none.
    const controlPointStopIds = new Set<string>();
    const scheduleDeviationByVehicleId = new Map<string, number | null>();

    // The elapsed departure headway, from the engine's own record of when a
    // bus last left this stop - the simulator's equivalent of production
    // reading `stop_visits.departed_at`. Null before any bus has departed the
    // origin, which is the same absence production reads out of an empty
    // table, and it declines rather than substituting anything.
    const previousDepartureSeconds = context.previousDepartureSeconds ?? null;
    // Measured to the RELEASE instant, not to `now`. Production decides while
    // a bus is dwelling, so its `now` already is the release instant and
    // `mpc/solver.ts` passes `now` unchanged; this engine decides on arrival,
    // so it must add the dwell back or the law pays for a gap the dwell was
    // about to close. See `ControllerContext.readyToDepartSeconds`.
    const releaseSeconds = context.readyToDepartSeconds ?? context.now;
    const elapsedSinceTerminalDeparture =
      atTerminal && previousDepartureSeconds !== null
        ? departureHeadwaySeconds(
            new Date(epochMs + previousDepartureSeconds * 1000),
            new Date(epochMs + releaseSeconds * 1000),
          )
        : null;

    const terminalCandidates = computeTerminalDispatchCandidates(
      headwayStates,
      vehicleStates,
      terminalStopId,
      policy,
      now,
      scheduleDeviationByVehicleId,
      weighOccupancy,
      elapsedSinceTerminalDeparture,
    );
    // Exactly `mpc/solver.ts`: a bus dwelling at the terminal is regulated by
    // terminal dispatch WHETHER OR NOT that produced a candidate, so the
    // mid-route laws never compete for it. Deriving this only from the
    // generated candidates would let a bus already spaced beyond target -
    // which correctly yields no terminal candidate - fall through to a
    // mid-route hold it should never be offered.
    const terminalVehicleIds = new Set(terminalCandidates.map((c) => c.vehicleId));
    if (isAtTerminal(vehicleStates.get(followerId), terminalStopId)) {
      terminalVehicleIds.add(followerId);
    }

    const twoWayCandidates = computeTwoWayCandidates(
      headwayStates,
      terminalVehicleIds,
      policy,
      vehicleStates,
      now,
      scheduleDeviationByVehicleId,
      controlPointStopIds,
      weighOccupancy,
    );
    const selfEqualizingCandidates = computeSelfEqualizingCandidates(
      headwayStates,
      terminalVehicleIds,
      policy,
      vehicleStates,
      now,
      scheduleDeviationByVehicleId,
      controlPointStopIds,
      weighOccupancy,
    );
    const costOptimalCandidates = computeCostOptimalCandidates(
      headwayStates,
      terminalVehicleIds,
      policy,
      vehicleStates,
      now,
      scheduleDeviationByVehicleId,
      controlPointStopIds,
      weighOccupancy,
    );
    const boardingLimitCandidates = computeBoardingLimitCandidates(
      headwayStates,
      policy,
      vehicleStates,
      scheduleDeviationByVehicleId,
      controlPointStopIds,
      terminalStopId,
    );

    const candidates: CandidateAction[] = [
      ...terminalCandidates,
      ...twoWayCandidates,
      ...selfEqualizingCandidates,
      ...costOptimalCandidates,
      ...boardingLimitCandidates,
    ];

    const eligibleToHold = canExecuteHold(vehicleStates.get(followerId), controlPointStopIds);
    const twoWayCovers = policy.kf !== null && policy.kb !== null && pair.hBwdSeconds !== null;
    const coverageBase = emptyCoverage();
    coverageBase.generated.terminal_dispatch = terminalCandidates.length;
    coverageBase.generated.two_way = twoWayCandidates.length;
    coverageBase.generated.self_equalizing = selfEqualizingCandidates.length;
    coverageBase.generated.cost_optimal = costOptimalCandidates.length;
    coverageBase.generated.boarding_limit = boardingLimitCandidates.length;

    // Why each empty law was empty, read off the preconditions those laws
    // document - see `DeclineReason`. Ordered as the laws test them, so the
    // FIRST unmet precondition is the one reported, which is the one a reader
    // has to fix to make the law run at all.
    if (terminalCandidates.length === 0) {
      coverageBase.declined.terminal_dispatch = !atTerminal
        ? 'not_at_terminal'
        : elapsedSinceTerminalDeparture === null
          ? 'no_measured_terminal_departure'
          : 'no_hold_indicated';
    }
    if (twoWayCandidates.length === 0) {
      coverageBase.declined.two_way =
        policy.kf === null || policy.kb === null
          ? 'gains_unset'
          : terminalVehicleIds.has(followerId)
            ? 'suppressed_by_terminal_regulation'
            : pair.hFwdSeconds === null
              ? 'h_fwd_unavailable'
              : pair.hBwdSeconds === null
                ? 'h_bwd_unavailable'
                : !eligibleToHold
                  ? 'not_eligible_to_hold'
                  : 'no_hold_indicated';
    }
    if (selfEqualizingCandidates.length === 0) {
      coverageBase.declined.self_equalizing =
        policy.selfEqualizingK === null
          ? 'self_equalizing_gain_unset'
          : terminalVehicleIds.has(followerId)
            ? 'suppressed_by_terminal_regulation'
            : pair.hFwdSeconds === null
              ? 'h_fwd_unavailable'
              : twoWayCovers
                ? 'two_way_covers_pair'
                : !eligibleToHold
                  ? 'not_eligible_to_hold'
                  : 'no_hold_indicated';
    }
    if (costOptimalCandidates.length === 0) {
      coverageBase.declined.cost_optimal = terminalVehicleIds.has(followerId)
        ? 'suppressed_by_terminal_regulation'
        : pair.hFwdSeconds === null
          ? 'h_fwd_unavailable'
          : pair.hBwdSeconds === null
            ? 'h_bwd_unavailable'
            : !eligibleToHold
              ? 'not_eligible_to_hold'
              : 'no_hold_indicated';
    }
    if (boardingLimitCandidates.length === 0) {
      // Reported precisely, because "no_hold_indicated" was hiding two very
      // different findings behind one word. Alighting-only needs the LEADER to
      // be standing at a stop AND the pair to be within an absolute 240 s of
      // each other. On a corridor whose stations are 44 km apart those two
      // conditions cannot both hold - a follower at a station is never four
      // minutes behind a leader that is also at one - so the law is not
      // declining, it is inapplicable to the geometry. Saying so is the
      // difference between "we tried and it wasn't worth it" and "this lever
      // does not exist on this kind of route".
      coverageBase.declined.boarding_limit =
        pair.hFwdSeconds === null
          ? 'h_fwd_unavailable'
          : !canExecuteHold(vehicleStates.get(leaderId), controlPointStopIds)
            ? 'leader_not_at_stop'
            : 'no_hold_indicated';
    }

    const { safe, rejected } = applyHardSafetyFilter(candidates, {
      now,
      staleAfterSeconds: DEFAULT_STATE_STALE_SECONDS,
      maxHoldSeconds: policy.maxHoldSeconds,
      vehicleObservedAtByVehicleId,
      // No command lifecycle in a rehearsal, so nothing is ever in flight.
      activeCommandVehicleIds: new Set<string>(),
      // The engine models no timetable, so every candidate's schedule
      // deviation is null and this bound has nothing to compare against.
      // Passing the policy's own value rather than null keeps the rehearsal
      // honest the day a scheduled scenario exists: the bound will start
      // applying without this file changing.
      maxLatenessSeconds: policy.maxLatenessSeconds,
      // Never enforced in a rehearsal: there is no command lifecycle, so no
      // vehicle has been instructed recently and nothing is rate-limited.
      recentlyCommandedVehicleIds: new Set<string>(),
      // The corridor's OWN value, as `mpc/solver.ts` passes it. This was
      // hardcoded to 0, which is not the same thing as "not modelled": it
      // silently disabled a guardrail production does enforce, and it is the
      // one that decides whether a marginal hold is issued at all. On a
      // 1,000-bus trial, 83% of the holds the laws proposed went to pairs the
      // corridor's own detector would not call even a warning - exactly the
      // population this bound exists to filter - and with it pinned at 0 none
      // of them was ever filtered.
      minimumActionSeconds: policy.minimumActionSeconds,
    });

    // Today's behaviour: no occupancy reading reaches the tier at all.
    const asDeployedStates = new Map<string, VehicleStateRow>([
      [followerId, { ...vehicleStates.get(followerId)!, occupancyCount: null }],
    ]);

    const occupancy = {
      asDeployedToday: computePredictiveAdvisory(safe, asDeployedStates, policy, now),
      withModelledOccupancy: computePredictiveAdvisory(safe, vehicleStates, modelledOccupancyPolicy, now),
    };

    // The deployed selection rule, CALLED rather than restated - including
    // the mid-route sort by `objectiveCost` that a restatement of it here
    // silently lacked, and the `cost_optimal` exclusion. `maxConcurrent` is 1
    // because the simulator asks about one vehicle at a time; see the header
    // for why that is the correct projection and not an approximation.
    const safeTerminal = safe.filter((c) => c.actionType === 'terminal_dispatch_hold');
    const safeMidRoute = safe
      // `boarding_limit` is priced but its benefit is not, so the deployed
      // solver keeps it out of the ranked pool while leaving it in `safe`.
      .filter((c) => c.actionType !== 'terminal_dispatch_hold' && !isBoardingLimitCandidate(c))
      .sort((a, b) => a.objectiveCost - b.objectiveCost);
    const selected = selectActions(safeTerminal, safeMidRoute, 1, costOptimalSelectable)[0] ?? null;

    const safetyRejectionReasons = [...new Set(rejected.flatMap((r) => r.reasons))].sort();

    decisions.push({
      atSeconds: context.now,
      stopId: context.stopId,
      vehicleId: context.vehicleId,
      leaderVehicleId: leaderId,
      gapMeters: pair.gapMeters,
      hFwdSeconds: pair.hFwdSeconds,
      hBwdSeconds: pair.hBwdSeconds,
      candidates,
      rejected,
      selectedActionType: selected?.actionType ?? 'no_control',
      holdSeconds: selected?.holdSeconds ?? 0,
      onboardCount: context.onboardCount ?? null,
      occupancy,
      coverage: {
        ...coverageBase,
        safetyRejectionReasons,
        atTerminal,
        hasLeader: true,
        hasTrailer: trailer !== null,
      },
    });

    if (!selected) return { holdSeconds: 0, actionType: 'no_control' };
    return { holdSeconds: selected.holdSeconds, actionType: selected.actionType };
  }

  return { name: REHEARSAL_CONTROLLER_NAME, decide, decisions };
}
