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
//   * THE INFORMATION DELAY. Production's laws read a `headway_states` row
//     written by a 60 s sweep and solved against up to 90 s later, so the gap
//     a deployed law acts on was measured before the bus reached the stop.
//     This computes it at the decision instant. SIZED by sampling the corridor
//     state 60 s apart across ten scenarios: h_fwd moves a mean of 34 s on the
//     urban corridor (9.6% of H*) and 24 s on the inter-city one (1.3%), and
//     crosses the mid-route action bar on 5.0% and 0.6% of pairs respectively.
//     A controller on fresher data does better, so this flatters - by about
//     that much.
//   * THE STATE ESTIMATOR. Production derives distance-along-route by map-
//     matching a GPS fix and filtering it, and excludes low-confidence
//     vehicles from the leader/follower chain before any headway is
//     computed. The simulator knows its own world exactly, so it reports
//     full confidence and that exclusion path never fires.
import { computePairHeadways } from '../headway/metrics.js';
import { computeLeaderFollowerOrder } from '../state-estimation/ordering.js';
import { classifyStopState } from '../state-estimation/stopStateClassifier.js';
import type { NearestStop } from '../state-estimation/stopStateClassifier.js';
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
import { isPairActionable } from '../mpc/actionThreshold.js';
import {
  computeBunchingRisk,
  forecastHorizonSeconds,
  type HeadwaySampleObservation,
} from '../headway/riskForecast.js';
import { applyHardSafetyFilter, DEFAULT_STATE_STALE_SECONDS } from '../mpc/safety.js';
import { computePredictiveAdvisory } from '../mpc/occupancyMpc.js';
import { selectActions, isRankedMidRouteCandidate } from '../mpc/solver.js';
import { isHoldAction } from '../mpc/types.js';
import { loadEnv } from '../config/env.js';
import type {
  CandidateAction,
  PredictiveAdvisory,
  SafetyRejection,
  SafetyRejectionReason,
} from '../mpc/types.js';
import type { RoutePolicyRow, HeadwayStateRow, VehicleStateRow } from '../state/store.js';
import type { VehicleOrderingInput } from '../state-estimation/types.js';
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
  /**
   * The pair's forward headway had not fallen far enough to be worth an
   * instruction - `mpc/actionThreshold.ts#isWorthActingOn`, the corridor's own
   * `warning_threshold_ratio`.
   *
   * This ladder had no entry for it at all, and the gate it names refuses
   * roughly four fifths of everything the mid-route laws would otherwise
   * propose. Every one of those decisions was being reported as
   * `not_eligible_to_hold` (untrue - the bus was standing at a stop and could
   * have executed a hold) or as `no_hold_indicated` (untrue - the law returned
   * before it ever computed one). So the single largest decline population in
   * the trial was invisible, and the coverage table - which CLAUDE.md says to
   * read BEFORE the KPI table - was attributing it to two guards that had not
   * fired.
   */
  | 'not_deviant_enough'
  | 'not_eligible_to_hold'
  /**
   * The law computed a hold and then dropped it, because its own objective
   * scored the hold at >= 0 passenger-seconds - `mpc/selfHarmCheck.ts`.
   *
   * Only ever reported when `SELF_HARM_CHECK_ENABLED` is on, which is never on
   * a deployment. It exists because without it every one of those declines
   * lands on `no_hold_indicated`, which is untrue in the way that matters: the
   * law DID indicate a hold, it was the objective that refused it. A reader
   * comparing a checked run against an unchecked one could not otherwise tell
   * the check's declines apart from a corridor that simply went quiet, and
   * telling those apart is the entire point of running the check.
   */
  | 'scored_self_harmful'
  /** Alighting-only acts on the LEADER, and the leader was not at a stop it could act at. */
  | 'leader_not_at_stop'
  /** Alighting-only needs a bus behind to collect the people left standing. There was none. */
  | 'no_trailing_vehicle'
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
  /**
   * How many candidates the solver's ranking could actually order here.
   *
   * `candidates` is everything the five laws GENERATED, before the safety
   * filter and before the three families that are never ranked against
   * anything (see `mpc/solver.ts#isRankedMidRouteCandidate`). Two surfaces
   * report whether the occupancy switch had a ranking to bite on, and both
   * were counting `candidates.length` - so a decision offering one hold plus
   * an unpriced alighting-only proposal, or one hold plus the non-selectable
   * closed-form optimum, was reported as re-rankable when nothing about it
   * could be re-ordered. Counted here, where the safe pool exists.
   */
  rankedCandidateCount: number;
  rejected: SafetyRejection[];
  selectedActionType: ControllerDecision['actionType'];
  holdSeconds: number;
  /** Modelled passengers aboard the deciding vehicle on arrival. Modelled, never observed - see `occupancy` below. */
  onboardCount: number | null;
  /**
   * Seconds this bus is behind its timetable, or null when the scenario booked
   * none. Carried because two deployed guards read it and a reader cannot tell
   * why either fired without it: the objective's lateness term, and
   * `mpc/boardingLimit.ts`'s refusal to let an EARLY bus leave anybody behind.
   */
  scheduleDeviationSeconds: number | null;
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
   * Whether an alighting-only proposal may be ACTED ON when no hold was
   * selected, rather than merely generated and shown.
   *
   * Defaults false, which is deployed behaviour: `mpc/solver.ts` proposes the
   * action to an operator and never issues it itself. An evaluation that wants
   * to know what the lever is worth has to be able to apply it, and this is the
   * switch that lets it - never displacing a hold, only filling a decision that
   * would otherwise have been "do nothing".
   */
  alightingOnlySelectable?: boolean;
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
  corridorStops?: readonly {
    stopId: string;
    cumulativeDistanceMeters: number;
    isControlPoint?: boolean;
  }[];
  /**
   * Whether the objective weighs the in-vehicle term
   * (`control_settings.weigh_occupancy`).
   *
   * Defaults FALSE, which is what the live network runs
   * (`db/settings.ts#DEFAULT_CONTROL_SETTINGS`, and the seeded value) and
   * therefore what a surface claiming to show the deployed controller has to
   * show.
   *
   * It defaulted TRUE - the value every candidate generator uses for a direct
   * caller - on the reasoning that re-pointing it at the live setting would
   * change existing rehearsal numbers as a side effect of an unrelated change.
   * That was a reason to defer it once, not a reason forever: a rehearsal is
   * read by a planner asking what the deployed controller would do on their
   * corridor, and it was answering about a controller with a switch in the
   * other position.
   *
   * It is not a cosmetic difference. With the switch on and a modelled onboard
   * count, `mpc/objective.ts#optimalHoldSeconds` charges a load penalty of
   * `L x H* / 2` - about 39,600 s on the inter-city preset - so the closed-form
   * optimum is zero for every pair and Algorithm D generates NOTHING, which
   * the coverage table then reports as the corridor declining it. That is the
   * loaded gun CLAUDE.md describes, and it was live in every rehearsal.
   *
   * The fleet trial is unaffected: it passes the flag explicitly, one phase
   * each way, which is the whole point of having two phases.
   */
  weighOccupancy?: boolean;
  /**
   * Whether the four laws that have no self-harm check apply one: declining a
   * hold their own objective scores as net harmful, exactly as
   * `mpc/costOptimalHold.ts` always has.
   *
   * Defaults to the deployed switch (`SELF_HARM_CHECK_ENABLED`, off) so a
   * rehearsal reproduces today's behaviour; overridable so the fleet trial can
   * measure what flipping it would do before anyone flips it. It was measured,
   * and the answer is don't - see mpc/selfHarmCheck.ts and
   * docs/SELF_HARM_CHECK.md.
   */
  selfHarmCheckEnabled?: boolean;
  /**
   * Whether the objective's waiting term is summed over the stops a hold's
   * correction is experienced at, rather than only the control point it is
   * issued from.
   *
   * Defaults to the deployed switch (`MULTI_STOP_WAIT_TERM_ENABLED`, off) so
   * a rehearsal reproduces today's behaviour; overridable so an evaluation
   * can measure what flipping it would do before anyone flips it. Needs
   * `corridorStops` to have anything to count - without it there is no stop
   * sequence to read a horizon out of and every candidate stays on the
   * one-stop term, which is the same "null means one stop" rule production
   * follows when a corridor's sequence is not loaded.
   */
  multiStopWaitTerm?: boolean;
  /**
   * Whether the mid-route laws may act on a pair the ordinary action bar
   * declines, because this pair's FORECAST says it is deteriorating toward
   * that bar (`mpc/actionThreshold.ts#isPairActionable`).
   *
   * Defaults to the deployed switch (`FORECAST_ACTION_GATE_ENABLED`, off) so
   * a rehearsal reproduces today's behaviour; overridable so the fleet trial
   * can measure what flipping it would do before anyone flips it.
   *
   * Off is byte-identical here in the strong sense: with this false the
   * forecast is not merely ignored, the sweep below never runs and no risk is
   * ever fitted.
   */
  forecastGateEnabled?: boolean;
  /**
   * How often the forecast's sample history is appended to, seconds.
   *
   * This is NOT a tuning knob, it is a fidelity one. In production the
   * forecast a control law reads was computed by the headway SWEEP
   * (`scheduler/headwayCompute.ts`, 60 s) and stored on the row the law then
   * reads out of `stateStore`, so it is up to one sweep old and it was fitted
   * from samples taken on that cadence. A rehearsal that re-fitted the trend
   * at every decision point would give the laws a forecast production does
   * not have - fresher, and fitted from a denser series than `headway_states`
   * ever contains - which is exactly the way this adapter has flattered the
   * deployed system before.
   */
  forecastSweepIntervalSeconds?: number;
  /** Samples the trend is fitted from, matching `BUNCHING_FORECAST_SAMPLE_WINDOW`. */
  forecastSampleWindow?: number;
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
/**
 * Stop geofence radius for a corridor that carries no measured one.
 *
 * 30 m, the `route_direction_stops.geofence_radius_meters` column default in
 * `db/migrations/20260805190000__core_data_model.sql`. The trial's corridors
 * are arithmetic and have no surveyed geofences, so the schema's own default
 * is the honest stand-in; naming it here keeps the number findable rather than
 * letting a stop-state classification rest on an unlabelled literal.
 */
const DEFAULT_GEOFENCE_RADIUS_METERS = 30;

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
  const weighOccupancy = options.weighOccupancy ?? false;
  const selfHarmCheckEnabled =
    options.selfHarmCheckEnabled ?? loadEnv().SELF_HARM_CHECK_ENABLED;
  const followerSpeedSource = options.followerSpeedSource ?? 'link_average';
  const corridorStops = options.corridorStops ?? null;
  const multiStopWaitTerm =
    options.multiStopWaitTerm ?? loadEnv().MULTI_STOP_WAIT_TERM_ENABLED;
  const forecastGateEnabled =
    options.forecastGateEnabled ?? loadEnv().FORECAST_ACTION_GATE_ENABLED;
  const forecastSweepIntervalSeconds = options.forecastSweepIntervalSeconds ?? 60;
  const forecastSampleWindow = options.forecastSampleWindow ?? 10;
  const forecastHorizon = forecastHorizonSeconds(policy.targetHeadwaySeconds);

  // ─── THE FORECAST THE LAWS READ, ON PRODUCTION'S OWN CADENCE ─────────
  //
  // `headway_states` carries one sample per pair per sweep, and
  // `headway/service.ts` fits the trend from the samples EARLIER sweeps wrote
  // - never including the row it is about to write - then stores the
  // projection on that row. A control law reads the stored value, so what it
  // sees is the forecast as of the last sweep.
  //
  // Both halves of that are reproduced here. `samplesByPair` is the sample
  // history, appended once per sweep interval; `forecastByPair` is the stored
  // projection, which the decision path reads and never recomputes. Fitting
  // at decision time instead would hand the laws a fresher and denser series
  // than production has - see `forecastSweepIntervalSeconds`.
  //
  // Keyed by (leader, follower) with a NUL separator for the same reason
  // `headway/service.ts#pairKey` uses one: both halves are vehicle
  // registrations, so a plain concatenation makes (AB, CD) and (ABC, D) the
  // same pair.
  const samplesByPair = new Map<string, HeadwaySampleObservation[]>();
  const forecastByPair = new Map<string, number | null>();
  let lastForecastSweepSeconds: number | null = null;

  /**
   * stop_id -> stops left to serve from it, counting itself.
   *
   * The rehearsal's stand-in for `stateStore.getDownstreamStopCount`, built
   * from the same thing production builds it from - the route-direction's
   * stop sequence, in order. `corridorStops` is already in sequence order
   * (`fleetTrial/corridor.ts` and `rehearsal/corridor.ts` both build it that
   * way), and `cumulativeDistanceMeters` is carried here anyway, so it is
   * sorted on that rather than trusted, for the same reason the store sorts
   * on `sequence` rather than trusting the query.
   */
  const downstreamStopsByStopId = ((): ReadonlyMap<string, number> => {
    if (!multiStopWaitTerm || !corridorStops || corridorStops.length === 0) return new Map();
    const ordered = [...corridorStops].sort(
      (a, b) => a.cumulativeDistanceMeters - b.cumulativeDistanceMeters,
    );
    return new Map(ordered.map((stop, index) => [stop.stopId, ordered.length - index]));
  })();
  const alightingOnlySelectable = options.alightingOnlySelectable ?? false;

  /**
   * The station nearest a neighbour's position, as production's state
   * estimator finds it (`state-estimation/estimator.ts#findNearestStop`).
   *
   * NEAREST, not "the last one at or behind", which is what this used to do:
   * combined with a 5 km/h threshold it reported a bus whose link average
   * happened to dip below walking pace as standing at whatever station it had
   * last passed, possibly kilometres back, and `mpc/eligibility.ts` then
   * declared it able to execute an instruction there.
   */
  const nearestStopTo = (distanceAlongRouteMeters: number): NearestStop | null => {
    if (!corridorStops || corridorStops.length === 0) return null;
    let nearest = corridorStops[0]!;
    let best = Math.abs(distanceAlongRouteMeters - nearest.cumulativeDistanceMeters);
    for (const stop of corridorStops) {
      const delta = Math.abs(distanceAlongRouteMeters - stop.cumulativeDistanceMeters);
      if (delta < best) {
        nearest = stop;
        best = delta;
      }
    }
    return {
      stopId: nearest.stopId,
      cumulativeDistanceMeters: nearest.cumulativeDistanceMeters,
      geofenceRadiusMeters: DEFAULT_GEOFENCE_RADIUS_METERS,
    };
  };

  /**
   * A neighbour's state as `vehicle_states` would carry it.
   *
   * The stop state is CLASSIFIED by production's own
   * `state-estimation/stopStateClassifier.ts`, not derived here. It used to be
   * derived here, from a 5 km/h threshold and no distance bound at all, and it
   * disagreed with production in both directions: production requires 2 km/h
   * AND the vehicle to be inside the stop's geofence, and it distinguishes
   * `approaching_stop` from `departed_stop`, which `mpc/eligibility.ts` treats
   * differently. Every law that asks "is this bus somewhere it could act?"
   * about a NEIGHBOUR - alighting-only's guard 3, above all - was asking a
   * question this file was answering on production's behalf.
   */
  const neighbourState = (
    state: CorridorKinematicState,
    routeDirectionId: string,
    observedAtIso: string,
  ): VehicleStateRow => {
    const nearestStop = nearestStopTo(state.distanceAlongRouteMeters);
    const { stopState, currentStopId } = classifyStopState({
      speedKmph: state.speedKmph,
      distanceAlongRouteMeters: state.distanceAlongRouteMeters,
      nearestStop,
      // No command lifecycle in a rehearsal, so nothing is under an
      // instruction right now; and the engine keeps every vehicle on its
      // route by construction.
      isHeldByController: false,
      isOffRoute: false,
    });
    return {
      vehicleId: state.vehicleId,
      tripId: null,
      routeDirectionId,
      position: null,
      distanceAlongRouteMeters: state.distanceAlongRouteMeters,
      speedKmph: state.speedKmph,
      headingDegrees: null,
      stopState,
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
        rankedCandidateCount: 0,
        rejected: [],
        selectedActionType: 'no_control',
        holdSeconds: 0,
        onboardCount: context.onboardCount ?? null,
        scheduleDeviationSeconds: context.scheduleDeviationSeconds ?? null,
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

    // ─── THE CHAIN IS RANKED BY PRODUCTION'S OWN FUNCTION ──────────────
    //
    // This used to hand-build a three-row `ordered` array - leader at rank 0,
    // the deciding bus at rank 1, its trailer at rank 2 - and that was wrong
    // in two ways at once.
    //
    // It ASSUMED the order rather than computing it, so any disagreement
    // between the caller's idea of "leader" and the deployed ranking became
    // an unlabelled fabrication rather than a mismatch anyone could see.
    //
    // And a chain of three is not the input production's headway computation
    // is written against. `headway/metrics.ts#corridorPaceKmph` takes the
    // MEDIAN SPEED OF THE MOVING VEHICLES IN THE CHAIN and uses it as the
    // divisor for any vehicle that is standing still - which the deciding bus
    // always is, because standing at a stop is the only state a hold can be
    // executed from. Over a population of three, one of which is stationary
    // by construction, the median is null whenever the other two happen to be
    // dwelling too, and the whole pair then reports h_fwd null. MEASURED on
    // the urban corridor: 9.0% of pairs that HAD a leader came back with no
    // forward headway at all, and Algorithm B declined 8.1% of every decision
    // in the trial as `h_fwd_unavailable` - a silence that belonged to the
    // harness, not to the corridor. `headway/service.ts` ranks every live
    // vehicle on the route-direction, about fifteen of them at any instant on
    // these corridors, and so does `fleetTrial/detection.ts`.
    const orderingInputs: VehicleOrderingInput[] = kinematics.corridor.map((vehicle) => ({
      vehicleId: vehicle.vehicleId,
      routeDirectionId: context.routeDirectionId,
      distanceAlongRouteMeters: vehicle.distanceAlongRouteMeters,
      // Full confidence: the simulator knows its own world exactly. See this
      // file's header - the state estimator's low-confidence exclusion is not
      // rehearsed, and pretending to a fractional confidence here would be
      // inventing an uncertainty the model does not have. A vehicle whose
      // feed has dropped is not in `corridor` at all, which is the same
      // exclusion by a different route.
      isLowConfidence: false,
    }));
    const ordered = computeLeaderFollowerOrder(orderingInputs, {
      isLoop: false,
      totalDistanceMeters: kinematics.totalDistanceMeters,
    });

    // One headway sweep, if one is due. Runs over the WHOLE corridor and with
    // every vehicle's natural speed - a sweep is not about a deciding bus, and
    // `followerSpeedSource`'s forced zero below belongs to the decision path
    // only. Decisions land far more often than every sweep interval on a
    // corridor of this size, so the cadence is set by the clock rather than by
    // how often this function happens to be called.
    if (forecastGateEnabled && (lastForecastSweepSeconds === null || context.now - lastForecastSweepSeconds >= forecastSweepIntervalSeconds)) {
      lastForecastSweepSeconds = context.now;
      const sweepPairs = computePairHeadways(
        ordered,
        new Map<string, number | null>(
          kinematics.corridor.map((vehicle) => [vehicle.vehicleId, vehicle.speedKmph]),
        ),
        new Map<string, number>(kinematics.corridor.map((vehicle) => [vehicle.vehicleId, 1])),
        { totalDistanceMeters: kinematics.totalDistanceMeters },
        context.routeDirectionId,
        policy.targetHeadwaySeconds,
      );
      const seen = new Set<string>();
      for (const sweepPair of sweepPairs) {
        const key = `${sweepPair.leaderVehicleId}\u0000${sweepPair.followerVehicleId}`;
        // Marked seen BEFORE the null check, and the distinction matters. A
        // pair whose forward headway is momentarily unmeasurable is still a
        // pair - production writes its row, keeps its earlier samples in
        // `headway_states` and simply has one fewer point to fit - whereas the
        // pruning below is for a pair that has ceased to exist. Conflating the
        // two would discard the trend history of any pair that ever reported a
        // null h_fwd, which on this corridor is 9% of them, and the forecaster
        // would then refuse far more often here than it does in production.
        seen.add(key);
        if (sweepPair.hFwdSeconds === null) continue;
        const history = samplesByPair.get(key) ?? [];
        // Fitted from EARLIER samples and projected from this sweep's h_fwd,
        // then stored - the exact order `headway/service.ts` uses so a
        // recorded forecast never depends on its own row.
        const risk = computeBunchingRisk({
          samples: history,
          currentHFwdSeconds: sweepPair.hFwdSeconds,
          targetHeadwaySeconds: policy.targetHeadwaySeconds,
          bunchedThresholdRatio: policy.bunchedThresholdRatio,
          horizonSeconds: forecastHorizon,
          // No dwell model, matching production and `fleetTrial/detection.ts`:
          // `fitDwellModel` needs a run of stop visits at one stop and no
          // corridor has ever had one, so the projection stays linear.
          dwellModel: null,
        });
        forecastByPair.set(key, risk?.forecastHFwdSeconds ?? null);
        history.push({
          hFwdSeconds: sweepPair.hFwdSeconds,
          computedAt: isoAt(epochMs, context.now),
        });
        if (history.length > forecastSampleWindow) history.shift();
        samplesByPair.set(key, history);
      }
      // A pair that stopped being a pair - a third bus moved between them, one
      // finished its trip - must not leave a stale forecast behind for the day
      // those two vehicles are adjacent again. Production gets this for free:
      // `upsertHeadwayStates` REPLACES a direction's whole slice per cycle, so
      // a vanished pair's row simply disappears. Keeping it here would be the
      // rehearsal inventing a forecast production does not have.
      for (const key of [...samplesByPair.keys()]) {
        if (seen.has(key)) continue;
        samplesByPair.delete(key);
        forecastByPair.delete(key);
      }
    }

    // The deciding bus is standing at a stop - that is the only state a hold
    // can be executed from (`mpc/eligibility.ts`). Under 'vehicle_state' it
    // therefore reports the zero its own `vehicle_states` row would carry,
    // which is what the deployed h_fwd is actually computed from. See
    // `followerSpeedSource`.
    const followerSpeedKmph =
      followerSpeedSource === 'vehicle_state' ? 0 : kinematics.follower.speedKmph;
    const speedByVehicleId = new Map<string, number | null>(
      kinematics.corridor.map((vehicle) => [vehicle.vehicleId, vehicle.speedKmph]),
    );
    speedByVehicleId.set(followerId, followerSpeedKmph);
    const confidenceByVehicleId = new Map<string, number>(
      kinematics.corridor.map((vehicle) => [vehicle.vehicleId, 1]),
    );

    const pairs = computePairHeadways(
      ordered,
      speedByVehicleId,
      confidenceByVehicleId,
      { totalDistanceMeters: kinematics.totalDistanceMeters },
      context.routeDirectionId,
      policy.targetHeadwaySeconds,
    );

    // One row per leader/follower link. The decision is about `followerId`,
    // and the row that carries its headways is the one where it is the
    // FOLLOWER - selecting by index would silently start deciding about
    // somebody else the moment the chain changed length.
    const pair = pairs.find((p) => p.followerVehicleId === followerId);
    if (!pair) return noAction();

    // Leader and trailer as the DEPLOYED ranking names them, not as the
    // caller guessed. They agree whenever the caller ranked by position too,
    // and when they do not, the deployed answer is the one the laws are about
    // to be scored against.
    const leaderId = pair.leaderVehicleId;
    const selfRank = ordered.find((v) => v.vehicleId === followerId);
    const trailerId = selfRank?.followerVehicleId ?? null;
    const byVehicleId = new Map(kinematics.corridor.map((v) => [v.vehicleId, v]));
    const trailer = trailerId ? (byVehicleId.get(trailerId) ?? null) : null;

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
        // What the last sweep recorded for this pair, not a fresh fit - see
        // the sweep above. Null whenever the gate is off, the pair is new, or
        // the forecaster declined to speak, and `isPairActionable` refuses to
        // act on any of the three.
        forecastHFwdSeconds:
          forecastByPair.get(`${pair.leaderVehicleId}\u0000${pair.followerVehicleId}`) ?? null,
        computedAt: nowIso,
      },
    ];

    // A knocked-out feed does not remove the last known position; it makes
    // its age the reason not to act. Stamping it past the deployed bound is
    // what turns this into a real `stale_state` rejection rather than an
    // engine-side veto.
    const readingAgeSeconds = context.isStateStale ? STALE_READING_AGE_SECONDS : 0;
    const followerObservedAt = isoAt(epochMs, context.now - readingAgeSeconds);
    //
    // Every vehicle a candidate could INVOLVE needs a reading, and an absence
    // is not harmless: `mpc/safety.ts` ages every involved vehicle and treats
    // a missing timestamp as infinitely old. Alighting-only involves the bus
    // behind by construction - it is the one that collects the people left
    // standing - and while that bus had no reading here, every candidate
    // Algorithm E produced was rejected `stale_state` on a corridor where
    // nothing was stale. Fresh for everyone but the deciding bus: the engine
    // knows exactly where they all are, and it is only the deciding bus whose
    // feed a scenario can knock out.
    const vehicleObservedAtByVehicleId = new Map<string, string>(
      kinematics.corridor.map((vehicle) => [vehicle.vehicleId, nowIso]),
    );
    vehicleObservedAtByVehicleId.set(followerId, followerObservedAt);


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
    // EVERY other vehicle on the corridor, when the caller supplied the
    // geometry to place them. See `corridorStops` for the law this was
    // silencing, and `boardingLimitStates` for why the chain rather than the
    // two adjacent buses: alighting-only asks `canExecuteHold` about the
    // LEADER of each pair it is offered, and a leader with no state row is
    // read as one that cannot act - which is the same answer as "it is
    // mid-link", from a completely different cause. Production's solver
    // carries a row for every vehicle on the route-direction.
    if (corridorStops) {
      for (const vehicle of kinematics.corridor) {
        if (vehicle.vehicleId === followerId) continue;
        vehicleStates.set(
          vehicle.vehicleId,
          neighbourState(vehicle, context.routeDirectionId, nowIso),
        );
      }
    }
    // The objective's waiting horizon, per vehicle, built exactly as
    // `mpc/solver.ts` builds it: off each vehicle's own `currentStopId`,
    // through the corridor's stop sequence, empty when the switch is off.
    const downstreamStopsByVehicleId = new Map<string, number | null>();
    if (downstreamStopsByStopId.size > 0) {
      for (const [vehicleId, state] of vehicleStates) {
        downstreamStopsByVehicleId.set(
          vehicleId,
          state.currentStopId === null
            ? null
            : (downstreamStopsByStopId.get(state.currentStopId) ?? null),
        );
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
    // The corridor's OWN designated holding points, when the caller supplied
    // them. This was unconditionally EMPTY, which `mpc/eligibility.ts` reads as
    // "hold at any stop" - the right default for a synthetic corridor that has
    // designated none, and silently wrong for one that has. It decides where a
    // hold may be executed AND, for alighting-only, where the leader must be
    // standing, so a corridor that had chosen three holding points was being
    // rehearsed as though it had chosen all of them.
    const controlPointStopIds = new Set<string>(
      (corridorStops ?? [])
        .filter((stop) => stop.isControlPoint === true)
        .map((stop) => stop.stopId),
    );
    // The deciding vehicle's lateness against its timetable, when the scenario
    // supplied one. This map was unconditionally EMPTY, which meant every
    // candidate carried a null deviation - so the objective's punctuality term
    // contributed nothing and `mpc/safety.ts`'s max-lateness bound had nothing
    // to compare against and rejected nothing. That is the live network's state
    // and was correct to reproduce while no scenario had a timetable; it is
    // silently wrong for one that does.
    const scheduleDeviationByVehicleId = new Map<string, number | null>([
      [followerId, context.scheduleDeviationSeconds ?? null],
    ]);

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
      selfHarmCheckEnabled,
      downstreamStopsByVehicleId,
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

    // ─── WHAT THE LAWS WOULD HAVE SAID WITHOUT THE CHECK ──────────────
    //
    // Attribution only, and computed ONLY while the check is on - which is
    // never on a deployment, so this costs a production solve nothing. A law
    // that generated nothing under the check looks identical, from the outside,
    // to a law whose preconditions were unmet; the coverage table is the half
    // CLAUDE.md says to read before the KPIs, and it would be reporting the
    // check's work as `no_hold_indicated` on every one of those decisions.
    const uncheckedTerminal = selfHarmCheckEnabled
      ? computeTerminalDispatchCandidates(
          headwayStates,
          vehicleStates,
          terminalStopId,
          policy,
          now,
          scheduleDeviationByVehicleId,
          weighOccupancy,
          elapsedSinceTerminalDeparture,
          false,
          downstreamStopsByVehicleId,
        )
      : terminalCandidates;

    const twoWayCandidates = computeTwoWayCandidates(
      headwayStates,
      terminalVehicleIds,
      policy,
      vehicleStates,
      now,
      scheduleDeviationByVehicleId,
      controlPointStopIds,
      weighOccupancy,
      selfHarmCheckEnabled,
      downstreamStopsByVehicleId,
      forecastGateEnabled,
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
      selfHarmCheckEnabled,
      downstreamStopsByVehicleId,
      forecastGateEnabled,
    );
    const uncheckedTwoWay = selfHarmCheckEnabled
      ? computeTwoWayCandidates(
          headwayStates,
          terminalVehicleIds,
          policy,
          vehicleStates,
          now,
          scheduleDeviationByVehicleId,
          controlPointStopIds,
          weighOccupancy,
          false,
          downstreamStopsByVehicleId,
          forecastGateEnabled,
        )
      : twoWayCandidates;
    const uncheckedSelfEqualizing = selfHarmCheckEnabled
      ? computeSelfEqualizingCandidates(
          headwayStates,
          terminalVehicleIds,
          policy,
          vehicleStates,
          now,
          scheduleDeviationByVehicleId,
          controlPointStopIds,
          weighOccupancy,
          false,
          downstreamStopsByVehicleId,
          forecastGateEnabled,
        )
      : selfEqualizingCandidates;

    const costOptimalCandidates = computeCostOptimalCandidates(
      headwayStates,
      terminalVehicleIds,
      policy,
      vehicleStates,
      now,
      scheduleDeviationByVehicleId,
      controlPointStopIds,
      weighOccupancy,
      downstreamStopsByVehicleId,
      forecastGateEnabled,
    );
    // ─── ALIGHTING-ONLY IS ASKED ABOUT THE WHOLE CHAIN ─────────────────
    //
    // `computeBoardingLimitCandidates` acts on the LEADER of a pair, and asks
    // whether that leader is standing at a stop it could act at. Handed only
    // `headwayStates` - one row, whose leader is the bus AHEAD of the deciding
    // one and therefore mid-link - the answer was always no. Algorithm E
    // generated zero candidates on every rehearsal and every evaluation ever
    // run, and coverage attributed it to `no_hold_indicated`.
    //
    // The row that makes the law answerable is the one where the DECIDING bus
    // is the leader and the bus behind it is the follower: a bus at a stop
    // with another close behind, which is exactly the situation the action is
    // for. That row was then supplied on its own alongside the deciding pair,
    // and a two-row list is still not what the law is written against.
    //
    // Its fifth guard reads "does this leader itself have a bus close in front
    // of it?" out of the SAME list - a leader mid-bunch must not be told to
    // leave people behind, because the bus ahead of IT is the one with
    // anything to gain. Over two rows that lookup misses for the bus ahead of
    // the deciding one, and a missing gap is read as "front-most bus on the
    // corridor, nothing ahead to be bunched behind" - so the guard passed on
    // trust for half the rows it was given. Production hands the law every
    // pair on the corridor (`mpc/solver.ts`), so now this does too.
    //
    // The HOLD laws still see one row and must: the engine applies whatever is
    // selected to the bus that is deciding, so a candidate naming another bus
    // would hold the wrong vehicle.
    const boardingLimitStates: HeadwayStateRow[] = pairs.map((p) => ({
      id: `rehearsal-${p.leaderVehicleId}-${p.followerVehicleId}-${context.stopId}-${Math.round(context.now)}`,
      routeDirectionId: context.routeDirectionId,
      leaderVehicleId: p.leaderVehicleId,
      followerVehicleId: p.followerVehicleId,
      hFwdSeconds: p.hFwdSeconds,
      hBwdSeconds: p.hBwdSeconds,
      targetHeadwaySeconds: p.targetHeadwaySeconds,
      deviationSeconds: p.deviationSeconds,
      // Carried for shape rather than for use: alighting-only does not consult
      // the mid-route action bar at all (`mpc/boardingLimit.ts` has its own
      // `bunchedThresholdRatio` guard), so the gate never reaches it.
      forecastHFwdSeconds:
        forecastByPair.get(`${p.leaderVehicleId}\u0000${p.followerVehicleId}`) ?? null,
      computedAt: nowIso,
    }));
    const trailingPair = pairs.find((p) => p.leaderVehicleId === followerId);
    const boardingLimitCandidates = computeBoardingLimitCandidates(
      boardingLimitStates,
      policy,
      vehicleStates,
      scheduleDeviationByVehicleId,
      controlPointStopIds,
      terminalStopId,
    );

    // Alighting-only is now offered every pair on the corridor, so it can name
    // a bus other than the one deciding. The engine applies whatever comes
    // back to the DECIDING bus, so only that bus's own proposal can travel any
    // further - and counting the rest as this decision's coverage would report
    // Algorithm E firing at a decision where nothing was proposed for the bus
    // in question.
    const ownBoardingLimitCandidates = boardingLimitCandidates.filter(
      (c) => c.vehicleId === followerId,
    );

    const candidates: CandidateAction[] = [
      ...terminalCandidates,
      ...twoWayCandidates,
      ...selfEqualizingCandidates,
      ...costOptimalCandidates,
      ...ownBoardingLimitCandidates,
    ];

    const eligibleToHold = canExecuteHold(vehicleStates.get(followerId), controlPointStopIds);
    const twoWayCovers = policy.kf !== null && policy.kb !== null && pair.hBwdSeconds !== null;
    const coverageBase = emptyCoverage();
    coverageBase.generated.terminal_dispatch = terminalCandidates.length;
    coverageBase.generated.two_way = twoWayCandidates.length;
    coverageBase.generated.self_equalizing = selfEqualizingCandidates.length;
    coverageBase.generated.cost_optimal = costOptimalCandidates.length;
    coverageBase.generated.boarding_limit = ownBoardingLimitCandidates.length;

    // Why each empty law was empty, read off the preconditions those laws
    // document - see `DeclineReason`. Ordered as the laws test them, so the
    // FIRST unmet precondition is the one reported, which is the one a reader
    // has to fix to make the law run at all.
    if (terminalCandidates.length === 0) {
      coverageBase.declined.terminal_dispatch = !atTerminal
        ? 'not_at_terminal'
        : elapsedSinceTerminalDeparture === null
          ? 'no_measured_terminal_departure'
          : uncheckedTerminal.length > 0
            ? 'scored_self_harmful'
            : 'no_hold_indicated';
    }
    // The mid-route action bar, tested by all three mid-route laws BEFORE
    // they test eligibility - see each law's own loop. Asked through the same
    // predicate the laws ask, gate included: with the gate on, a pair the
    // forecast admitted is one the laws DID consider, and reporting it as
    // `not_deviant_enough` would attribute the largest decline population in
    // the trial to a guard that had not fired - the defect that reason code
    // was added to fix.
    const deviantEnough = isPairActionable(headwayStates[0]!, policy, forecastGateEnabled);
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
                : !deviantEnough
                  ? 'not_deviant_enough'
                  : !eligibleToHold
                    ? 'not_eligible_to_hold'
                    : uncheckedTwoWay.length > 0
                      ? 'scored_self_harmful'
                      : 'no_hold_indicated';
    }
    if (selfEqualizingCandidates.length === 0) {
      // `two_way_covers_pair` sits AFTER eligibility here, which is where
      // `mpc/selfEqualizing.ts` tests it. It used to sit before, so a pair
      // that the law had already abandoned as unexecutable was reported as
      // one two-way had taken off its hands.
      coverageBase.declined.self_equalizing =
        policy.selfEqualizingK === null
          ? 'self_equalizing_gain_unset'
          : terminalVehicleIds.has(followerId)
            ? 'suppressed_by_terminal_regulation'
            : pair.hFwdSeconds === null
              ? 'h_fwd_unavailable'
              : !deviantEnough
                ? 'not_deviant_enough'
                : !eligibleToHold
                  ? 'not_eligible_to_hold'
                  : twoWayCovers
                    ? 'two_way_covers_pair'
                    : uncheckedSelfEqualizing.length > 0
                      ? 'scored_self_harmful'
                      : 'no_hold_indicated';
    }
    if (costOptimalCandidates.length === 0) {
      coverageBase.declined.cost_optimal = terminalVehicleIds.has(followerId)
        ? 'suppressed_by_terminal_regulation'
        : pair.hFwdSeconds === null
          ? 'h_fwd_unavailable'
          : pair.hBwdSeconds === null
            ? 'h_bwd_unavailable'
            : !deviantEnough
              ? 'not_deviant_enough'
              : !eligibleToHold
                ? 'not_eligible_to_hold'
                : 'no_hold_indicated';
    }
    if (ownBoardingLimitCandidates.length === 0 && !trailingPair) {
      // No bus behind at all, so there is nobody for the left-behind passengers
      // to be collected by and the action has no meaning here.
      coverageBase.declined.boarding_limit = 'no_trailing_vehicle';
    } else if (ownBoardingLimitCandidates.length === 0) {
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

    // HOLDS ONLY, exactly as `mpc/solver.ts` feeds it. The advisory re-scores
    // a candidate by what its hold costs the people aboard (`w_v x L x d`),
    // which is identically zero for an action whose d is 0 - so an
    // alighting-only proposal enters the list scored "free" when the truth is
    // that the advisory has no model of its cost at all. This passed `safe`
    // whole, and the extra row was not inert: it made a rehearsal's advisory
    // list two entries long and every consumer counting `candidates.length`
    // to ask "was there a ranking here?" answered yes to a pair that cannot
    // be ranked.
    const advisoryCandidates = safe.filter((c) => isHoldAction(c.actionType));
    const occupancy = {
      asDeployedToday: computePredictiveAdvisory(advisoryCandidates, asDeployedStates, policy, now),
      withModelledOccupancy: computePredictiveAdvisory(
        advisoryCandidates,
        vehicleStates,
        modelledOccupancyPolicy,
        now,
      ),
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
    let selected = selectActions(safeTerminal, safeMidRoute, 1, costOptimalSelectable)[0] ?? null;

    // ─── ALIGHTING-ONLY IS OFFERED, NEVER RANKED ───────────────────────
    //
    // The deployed solver keeps it out of `safeMidRoute` because its
    // `objectiveCost` is 0 - unpriced, not free - and a zero would sort FIRST
    // in a list ranked ascending on cost. That exclusion is correct and is not
    // touched here.
    //
    // What this adds is the only thing an evaluation can honestly do with a
    // proposal: take it when nothing else was chosen, so the trial can MEASURE
    // what the lever is worth instead of reporting it at 0% forever. It can
    // never displace a hold, because it is only consulted once selection has
    // already returned nothing. Off unless the caller asks.
    if (!selected && alightingOnlySelectable) {
      const offered = safe.find((c) => isBoardingLimitCandidate(c) && c.vehicleId === followerId);
      if (offered) selected = offered;
    }

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
      rankedCandidateCount: safe.filter((c) => isRankedMidRouteCandidate(c, costOptimalSelectable))
        .length,
      rejected,
      selectedActionType: selected?.actionType ?? 'no_control',
      holdSeconds: selected?.holdSeconds ?? 0,
      onboardCount: context.onboardCount ?? null,
      scheduleDeviationSeconds: context.scheduleDeviationSeconds ?? null,
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
