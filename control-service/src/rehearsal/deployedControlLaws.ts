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
//   mpc/twoWayHold.ts#computeTwoWayCandidates   Algorithm B (blueprint 8.3)
//   mpc/selfEqualizing.ts#compute...Candidates  Algorithm C (blueprint 8.4)
//   mpc/safety.ts#applyHardSafetyFilter         the hard guardrail (9.1 §5)
//   mpc/occupancyMpc.ts#computePredictiveAdvisory   Algorithm E (8.6)
//
// and the selection rule below is the same "safe terminal first, then
// lowest-cost safe mid-route candidate" ordering `mpc/solver.ts` applies.
//
// ─── WHAT IS NOT REHEARSED, SAID PLAINLY ─────────────────────────────────
//
//   * TERMINAL DISPATCH REGULATION (Algorithm A, blueprint 8.1/8.2). The
//     engine dispatches from a terminal but does not model a vehicle
//     DWELLING at one under control, so there is no terminal vehicle for
//     the law to regulate. `terminalVehicleIds` is therefore empty, which
//     also means two-way and self-equalizing are never suppressed in favour
//     of a terminal action the way they can be in production.
//   * TWO-WAY HOLDING, in a scenario run. The law needs the backward
//     headway to the vehicle BEHIND the deciding one, and `engine.ts`
//     cannot supply it: it simulates one complete trip at a time in
//     dispatch order, so the trailing vehicle has not been simulated yet
//     and its trajectory depends on the very hold under decision. h_bwd
//     therefore comes back null and `computeSelfEqualizingCandidates`
//     takes the pair - the deployed fallback, running for the deployed
//     reason. A hand-built `ControllerKinematics.trailer` (as the tests
//     supply) does exercise Algorithm B against the real module. Making a
//     full scenario do so needs an engine that advances every vehicle on
//     one clock.
//   * THE STATE ESTIMATOR. Production derives distance-along-route by map-
//     matching a GPS fix and filtering it, and excludes low-confidence
//     vehicles from the leader/follower chain before any headway is
//     computed. The simulator knows its own world exactly, so it reports
//     full confidence and that exclusion path never fires.
//   * COOLDOWNS AND COMMAND LIFECYCLE. `policy.cooldownSeconds`,
//     `minimumActionSeconds`, acknowledgement and TTL live in the command
//     path, which this deliberately does not touch. A rehearsal therefore
//     shows the control law's intent, not the rate at which commands would
//     actually reach a driver.
import { computePairHeadways } from '../headway/metrics.js';
import { computeTwoWayCandidates } from '../mpc/twoWayHold.js';
import { computeSelfEqualizingCandidates } from '../mpc/selfEqualizing.js';
import { applyHardSafetyFilter, DEFAULT_STATE_STALE_SECONDS } from '../mpc/safety.js';
import { computePredictiveAdvisory } from '../mpc/occupancyMpc.js';
import type { CandidateAction, PredictiveAdvisory, SafetyRejection } from '../mpc/types.js';
import type { RoutePolicyRow, HeadwayStateRow, VehicleStateRow } from '../state/store.js';
import type { OrderedVehicle } from '../state-estimation/types.js';
import type { Controller, ControllerContext, ControllerDecision } from '../simulation/types.js';

export const REHEARSAL_CONTROLLER_NAME = 'deployed-control-laws';

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
}

export interface DeployedControlLawsOptions {
  /** The corridor's own `route_policies` row, loaded by the same reader the live path uses. */
  policy: RoutePolicyRow;
  /** Wall-clock instant that simulated second 0 maps to. Only its differences matter, but the deployed staleness filter compares real Dates. */
  epochMs: number;
  /** Modelled seat capacity, used solely to give the occupancy-weighted tier a denominator. See `RehearsalDecisionRecord.occupancy`. */
  modelledCapacity: number;
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

function isoAt(epochMs: number, seconds: number): string {
  return new Date(epochMs + seconds * 1000).toISOString();
}

export interface DeployedControlLawsController extends Controller {
  /** Every control-point decision this controller made, in the order it made them. */
  readonly decisions: readonly RehearsalDecisionRecord[];
}

export function createDeployedControlLawsController(
  options: DeployedControlLawsOptions,
): DeployedControlLawsController {
  const { policy, epochMs, modelledCapacity } = options;
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
    const noAction = (record: Partial<RehearsalDecisionRecord> = {}): ControllerDecision => {
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

    const speedByVehicleId = new Map<string, number | null>([
      [leaderId, kinematics.leader.speedKmph],
      [followerId, kinematics.follower.speedKmph],
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
          speedKmph: kinematics.follower.speedKmph,
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
    // Empty on purpose - the engine models no controllable terminal dwell.
    // See this file's header.
    const terminalVehicleIds = new Set<string>();
    // The vehicle state map is passed through because the deployed laws now
    // decline to propose a hold to a vehicle that could not execute one
    // (mpc/eligibility.ts). The engine only asks for a decision at a stop, so
    // the state above reports `dwelling_at_stop` and every simulated control
    // point is eligible - an EMPTY control-point set means "any stop", which
    // is the right reading for a synthetic corridor that has designated none.
    const candidates = [
      ...computeTwoWayCandidates(
        headwayStates,
        terminalVehicleIds,
        policy,
        vehicleStates,
        now,
        new Map(),
        new Set<string>(),
      ),
      ...computeSelfEqualizingCandidates(
        headwayStates,
        terminalVehicleIds,
        policy,
        vehicleStates,
        now,
        new Map(),
        new Set<string>(),
      ),
    ];

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
      minimumActionSeconds: 0,
    });

    // Today's behaviour: no occupancy reading reaches the tier at all.
    const asDeployedStates = new Map<string, VehicleStateRow>([
      [followerId, { ...vehicleStates.get(followerId)!, occupancyCount: null }],
    ]);

    const occupancy = {
      asDeployedToday: computePredictiveAdvisory(safe, asDeployedStates, policy, now),
      withModelledOccupancy: computePredictiveAdvisory(safe, vehicleStates, modelledOccupancyPolicy, now),
    };

    // The same priority the deployed solver applies. Terminal candidates
    // cannot arise here (see header), so this reduces to the lowest-cost
    // safe mid-route candidate - but it is written as the solver writes it
    // so the two do not quietly diverge if terminal dwell is ever modelled.
    const safeTerminal = safe.filter((c) => c.actionType === 'terminal_dispatch_hold');
    const safeMidRoute = safe.filter((c) => c.actionType !== 'terminal_dispatch_hold');
    const selected = safeTerminal[0] ?? safeMidRoute[0] ?? null;

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
    });

    if (!selected) return { holdSeconds: 0, actionType: 'no_control' };
    return { holdSeconds: selected.holdSeconds, actionType: selected.actionType };
  }

  return { name: REHEARSAL_CONTROLLER_NAME, decide, decisions };
}
