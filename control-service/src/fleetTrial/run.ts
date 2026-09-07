// The fleet trial: a thousand buses on one 400 km corridor, run twice - once
// with the deployed controller and once with nobody intervening - across ten
// ways a corridor comes apart, in two phases that differ in exactly one input.
//
// ─── WHAT IS BEING TESTED, AND WHAT IS ONLY THE RIG ──────────────────────
//
// TESTED (all of it deployed code, imported from where the live path imports it)
//   the four control laws, their gains, the hard safety filter, the selection
//   rule, the occupancy switch, and both tiers of the bunching detector.
//
// THE RIG (invented here, and labelled as such in every result)
//   the corridor's geometry, the demand, the running times, the vehicle
//   capacity, the disturbances and the fleet size. `fleetTrial/corridor.ts`
//   says why an invented corridor was necessary at all.
//
// ─── THE COUNTERFACTUAL IS NOT OPTIONAL ──────────────────────────────────
//
// Every scenario runs twice on the SAME dispatch plan, the SAME disturbances
// and the SAME seed: once through the deployed laws and once through
// `noControlController`. A KPI from the controlled arm alone says nothing -
// a corridor can look calm because the controller worked or because that
// day was quiet, and only the paired arm separates them.
//
// PAIRED BY SEED, NOT BY REALISED RUNNING TIME. Both arms draw from the same
// seeded stream, but the engine draws in simulated-time order (see its
// header), so a hold shifts the order in which draws are consumed and the two
// arms do not receive byte-identical link times. What IS identical is the
// distribution, the plan, the disturbances and the corridor. This is the same
// pairing `evaluation/runner.ts` uses and it is stated here rather than
// implied, because a reader entitled to think "identical day" would be wrong.
import { simulate, noControlController, computeHeadwaySamples } from '../simulation/index.js';
import { computeDispersion } from '../lib/dispersion.js';
import { assessControllability as measureControllability } from '../lib/controllability.js';
import {
  buildRehearsalScenario,
  DEFAULT_MODELLED_INPUTS,
  REHEARSAL_EPOCH_MS,
  WARMUP_VEHICLE_ID,
  isReported,
} from '../rehearsal/run.js';
import {
  createDeployedControlLawsController,
  CONTROL_LAWS,
} from '../rehearsal/deployedControlLaws.js';
import { buildFleetCorridor } from './corridor.js';
import { CORRIDOR_PRESETS, FLEET_TRIAL_INPUTS } from './presets.js';
import type { CorridorPresetId } from './presets.js';
import { BUNCHING_SCENARIOS, scenarioById, scenarioRng } from './scenarios.js';
import { detectIncidents, DEFAULT_SWEEP_INTERVAL_SECONDS } from './detection.js';
import type { DetectedIncident, SweepSample } from './detection.js';
import type { BunchingScenario, BunchingScenarioId } from './scenarios.js';
import type { FleetCorridorSpec } from './corridor.js';
import { plannedUnitCount, eligibleScenarioCount } from './progress.js';
import type { FleetTrialProgressReporter, FleetTrialStage } from './progress.js';
import type { CorridorInputs } from '../rehearsal/corridor.js';
import type { ModelledInputs } from '../rehearsal/run.js';
import {
  COMMAND_BLOCK_REASONS,
  commandLifecyclePolicyFrom,
  inertLimitsFor,
  limitProvenance,
} from '../simulation/commandLifecycle.js';
import type {
  CommandBlockReason,
  CommandLifecycleLedger,
  CommandLifecyclePolicy,
  InertLimit,
  LimitProvenance,
} from '../simulation/commandLifecycle.js';
import type { DeclineReason, RehearsalDecisionRecord } from '../rehearsal/deployedControlLaws.js';
import type {
  ScenarioConfig,
  StopVisitRecord,
  TerminalDispatchPlan,
} from '../simulation/types.js';
import type {
  ArmContrast,
  ArmReport,
  PolicyStudy,
  PolicyStudyRow,
  FleetTrialReport,
  IncidentSummary,
  LawCoverage,
  OccupancyContrast,
  PhaseId,
  PhaseReport,
  PunctualityKpis,
  PassengerOutcome,
  ScenarioReport,
  SelfEqualizingCoverageReport,
  SpacingKpis,
  TrialProvenanceEntry,
  VehicleTrajectory,
} from './types.js';

// ─── What crosses the wire, and what is left behind ──────────────────────
//
// Named constants rather than literals at the slice site, so a reader of a
// report can find out exactly how much of the run they are looking at.

/** Sweep points kept per arm per scenario. A 20-hour run at 60 s is ~1,200; a chart cannot use them all. */
const MAX_SWEEP_POINTS = 120;
/** Buses drawn as trajectories per arm per scenario. Taken CONSECUTIVELY - see `pickTrajectoryVehicles`. */
const MAX_TRAJECTORY_VEHICLES = 10;
/** Incidents carried in full per arm per scenario, deepest bunch first. */
const MAX_INCIDENT_SAMPLES = 15;

/**
 * Seeds each holding-point placement is averaged over.
 *
 * One is not enough and that is measured, not assumed: a single seed's net
 * passenger-time figure on this corridor ranges from -6.0% to +3.9%, which is
 * wider than every difference the study is trying to detect. Three is the
 * smallest number at which a row can report whether its seeds AGREED, which is
 * the thing a reader actually needs - a mean whose seeds disagree is not a
 * small effect, it is no measured effect at all.
 */
const STUDY_SEEDS = 3;

/**
 * Fleet the placement study runs at, capped below the trial's own.
 *
 * The study compares placements against each OTHER, so it needs enough buses
 * for the corridor to behave like a corridor and no more - and it runs three
 * placements at three seeds, so it costs nine phase-runs against the trial's
 * two. Left uncapped it was three quarters of the total time for a comparison
 * whose precision is already set by the seed count rather than the fleet size.
 */
const MAX_STUDY_VEHICLES = 250;

export interface FleetTrialSpec {
  /** Overrides on the preset's corridor. Empty by default so the preset decides the shape. */
  corridor: Partial<FleetCorridorSpec>;
  /** Buses per phase. Two phases of 500 is the thousand-bus trial. */
  vehiclesPerPhase: number;
  scenarios: BunchingScenarioId[];
  seed: number;
  /** Shared modelled inputs. Each scenario overrides the few it is about. */
  inputs: Partial<ModelledInputs>;
  sweepIntervalSeconds: number;
  /** `route_policies.required_samples`: consecutive breaches before the reactive rule fires. */
  requiredSamples: number;
  /**
   * Which end of production's speed-reporting range to run the control laws
   * against. See `rehearsal/deployedControlLaws.ts#followerSpeedSource` - the
   * two ends disagree about the same bus by a factor of sixty, so a trial that
   * silently picked one would be reporting a different system from the other.
   *
   * The trial defaults to `vehicle_state`, the PESSIMISTIC end, because that
   * is the row the deployed solver actually reads.
   */
  followerSpeedSource: 'link_average' | 'vehicle_state';
  /** Which corridor shape to run on. See `presets.ts` for why more than one exists. */
  corridorPreset: CorridorPresetId;
  /**
   * Whether an alighting-only proposal may be ACTED on when no hold was
   * selected.
   *
   * Defaults FALSE, matching production: `mpc/solver.ts` proposes the action to
   * an operator and never issues it, because neither side of its trade can be
   * priced today.
   *
   * The trial can turn it on because it is the one place that CAN price the
   * trade - it simulates the outcome.
   *
   * ─── THE MEASUREMENT THAT SAID IT LOSES NO LONGER REPRODUCES ─────────
   *
   * It used to read: worse on seven of eight urban seeds, and 9% of all
   * passenger time in `slow_bus` on every seed. That was taken on the old
   * headline - waiting plus the hold, over a waiting-only denominator, with
   * passengers still boarding at the terminus - and it does not survive any
   * of those being fixed. RE-MEASURED at six seeds, 250 buses per phase,
   * urban, occupancy-blind, it read as better on only 3 of 6 seeds by total
   * passenger time - NO MEASURED EFFECT by this trial's own rule (a mean
   * whose seeds disagree is not a small effect), which is where this file's
   * verdict stood for a while: "it loses" is no longer something anyone can
   * say, but nor could anyone yet say it wins.
   *
   * RE-MEASURED AGAIN at sixteen paired phase-seeds - the same corridor,
   * phase and selectability, just more of them - it is better on 14 of 16 by
   * total passenger time and 16 of 16 by excess wait. Both figures clear the
   * trial's own agreement bar (`seedsAgreeingWithSign > seedCount / 2`), so
   * this IS a measured effect now, and a positive one. See
   * `docs/FLEET_TRIAL.md` section 17 for both measurements side by side and
   * which seed count backs each.
   *
   * It stays off regardless, but for a reason that does not depend on which
   * way the sign points: the action is unpriced (neither side of its trade
   * can be costed without a fitted lambda), it leaves real passengers
   * standing, and auto-selecting a lever this trial cannot yet cost is a
   * production policy decision the trial's own positive mean does not settle
   * by itself.
   *
   * It is kept as a switch because that conclusion is a measurement, and a
   * measurement has to be re-runnable.
   */
  alightingOnlySelectable: boolean;
  /**
   * Put every hold through the COMMAND PATH before the engine applies it, and
   * report what would actually have been served beside what the laws intended.
   *
   * ─── OFF BY DEFAULT, AND OFF MEANS BYTE-IDENTICAL ────────────────────────
   *
   * `false` is not merely the old behaviour, it is the same bytes: the engine
   * takes no different branch, no visit gains a field, and the report gains no
   * key. `test/fleetTrial/commandLifecycle.test.ts` pins that on all three
   * presets by comparing serialized reports.
   *
   * ─── AND WHY IT IS NOT ON ────────────────────────────────────────────────
   *
   * Not because the modelling is doubtful - three of its five limits carry a
   * value read straight from the seeded `route_policies` - but because turning
   * it on changes what every existing number MEANS. A trial run with this on
   * reports a delivered rate; one run with it off reports the control law's
   * intent. Those are different quantities and a reader comparing across weeks
   * must be told which they are looking at, which is what
   * `commandLifecycle.enabled` in the report is for.
   */
  commandLifecycle: CommandLifecycleTrialOptions;
}

/**
 * How the trial should model the command path.
 *
 * The LIMITS are not here on purpose. They come from `route_policies` through
 * `simulation/commandLifecycle.ts#commandLifecyclePolicyFrom`, so no caller
 * can hand this trial an invented cooldown or an invented concurrency cap and
 * have the report present it as measured. The only value a caller may set is
 * the one nothing in this system measures.
 */
export interface CommandLifecycleTrialOptions {
  enabled: boolean;
  /**
   * Seconds between a law deciding and the instruction reaching the driver:
   * the decision cycle's own lag, a dispatcher's approval, delivery.
   *
   * ASSUMED - nothing here measures it - so it defaults to 0, which makes the
   * headline delivered figure rest only on limits with a real seeded or
   * shipped value behind them. Sweep it to size the sensitivity and report
   * that separately; never fold a swept value into the headline.
   */
  deliveryLatencySeconds: number;
}


export const DEFAULT_FLEET_TRIAL_SPEC: FleetTrialSpec = {
  corridor: {},
  vehiclesPerPhase: 500,
  scenarios: BUNCHING_SCENARIOS.map((s) => s.id),
  seed: 20260822,
  // EMPTY, and it has to be. The preset supplies the demand that belongs to its
  // shape; this field is for a caller overriding one of them deliberately.
  // MEASURED when it defaulted to the inter-city inputs instead: they were
  // spread AFTER the preset's, so asking for the urban corridor got urban
  // GEOMETRY with inter-city TRAFFIC - 0.38 boardings/min against 1.2, a 120 s
  // dwell against 20 s - and the corridor came out four times more lightly
  // loaded than it should be, barely bunched at all, with the controller
  // apparently useless on it. A shape and its traffic cannot be mixed.
  inputs: {},
  sweepIntervalSeconds: DEFAULT_SWEEP_INTERVAL_SECONDS,
  requiredSamples: 3,
  followerSpeedSource: 'vehicle_state',
  corridorPreset: 'intercity',
  alightingOnlySelectable: false,
  commandLifecycle: { enabled: false, deliveryLatencySeconds: 0 },
};

const PHASES: { id: PhaseId; title: string; weighOccupancy: boolean }[] = [
  {
    id: 'occupancy_blind',
    title: 'Phase 1 - spacing and punctuality only',
    weighOccupancy: false,
    },
  {
    id: 'occupancy_aware',
    title: 'Phase 2 - passenger load weighed as well',
    weighOccupancy: true,
  },
];

/**
 * The corridor's own inputs with this scenario's perturbation applied.
 *
 * Multiplicative, so a scenario means the same thing on every corridor - see
 * `BunchingScenario.inputScale` for what absolute overrides did to the urban
 * corridor. `alightingFraction` is additionally clamped to 1: it is a
 * proportion, and a multiplier that pushed it past 1 would have a bus shed
 * more passengers than it is carrying.
 */
function scaleInputs(inputs: ModelledInputs, scenario: BunchingScenario): ModelledInputs {
  const scale = scenario.inputScale;
  return {
    ...inputs,
    boardingRatePerMinute: inputs.boardingRatePerMinute * (scale.boardingRatePerMinute ?? 1),
    alightingFraction: Math.min(1, inputs.alightingFraction * (scale.alightingFraction ?? 1)),
    travelTimeVariation: inputs.travelTimeVariation * (scale.travelTimeVariation ?? 1),
  };
}

// ─── Scenario construction ───────────────────────────────────────────────

/**
 * One scenario as a runnable `ScenarioConfig`.
 *
 * Built on `buildRehearsalScenario` rather than beside it, so the corridor a
 * trial runs on and the corridor a planner rehearses are produced by the same
 * function. Only the two things a trial genuinely needs differently are
 * replaced afterwards: WHO is dispatched (a named thousand-bus fleet instead
 * of `SIM-01`) and WHAT goes wrong (an archetype instead of the rehearsal's
 * five named disturbances).
 */
function buildTrialScenario(args: {
  corridor: CorridorInputs;
  scenario: BunchingScenario;
  inputs: ModelledInputs;
  vehicleIds: readonly string[];
  seed: number;
}): ScenarioConfig {
  const { corridor, scenario, inputs, vehicleIds, seed } = args;
  const targetHeadwaySeconds = corridor.policy.targetHeadwaySeconds;

  const built = buildRehearsalScenario(corridor, {
    ...inputs,
    vehicleCount: vehicleIds.length,
    seed,
    // The archetype supplies its own disturbances; asking the rehearsal
    // builder for one as well would apply two.
    disturbance: 'none',
  });

  // The warm-up run keeps its identity - it is the same piece of machinery in
  // every run and is excluded from every reported number.
  let nextIndex = 0;
  const named: TerminalDispatchPlan[] = built.scenario.dispatches.map((dispatch) => {
    if (dispatch.vehicleId === WARMUP_VEHICLE_ID) return { ...dispatch };
    const vehicleId = vehicleIds[nextIndex++] ?? dispatch.vehicleId;
    return { ...dispatch, vehicleId };
  });

  const metersPerSecond = inputs.cruiseSpeedKmph / 3.6;
  const plan = scenario.build({
    corridor,
    inputs,
    dispatches: named,
    targetHeadwaySeconds,
    freeFlowSecondsTo: (stopIndex: number) => {
      const stop = corridor.stops[stopIndex];
      if (!stop || metersPerSecond <= 0) return 0;
      return stop.cumulativeDistanceMeters / metersPerSecond;
    },
    rng: scenarioRng(seed, scenario.id),
  });

  return {
    ...built.scenario,
    name: `fleet-trial:${scenario.id}`,
    dispatches: plan.dispatches,
    disturbances: plan.disturbances,
    // Filled in by `runScenario` from the uncontrolled arm - see
    // `timetableFromRun`. It cannot be built here because it is a measurement of
    // the run this config is about to produce.
    //
    // Whatever fills it is booked against the PLANNED departures rather than the
    // ones the scenario produced. A timetable is what was promised; the scenario
    // is what happened. Built from `plan.dispatches`, `terminal_jitter` - which
    // moves departures off their slots by up to a third of a headway - would
    // have declared every bus to be leaving exactly on time, and the one
    // scenario whose whole subject is buses leaving wrong would have reported no
    // lateness for either punctuality guard to act on.
    scheduledArrivalSeconds: undefined,
    seed,
  };
}

/**
 * A timetable booked from what the corridor ACTUALLY does, the way a scheduler
 * builds one from observed running times.
 *
 * ─── WHY NOT FREE-FLOW ARITHMETIC ────────────────────────────────────────
 *
 * The first version of this booked free-flow running plus a nominal dwell, and
 * `assessScheduleFit` caught it: buses ran 130 s late against it on the urban
 * corridor and 896 s late on the inter-city one, with no control at all. Real
 * running time exceeds free-flow for reasons the arithmetic cannot see - the
 * no-overtake clamp, dwells that scale with a queue rather than with an average,
 * and a Gaussian draw floored at zero.
 *
 * That is not a cosmetic error. `mpc/safety.ts` refuses a hold that would push a
 * bus past `max_lateness_seconds`, so a timetable nobody can keep makes EVERY
 * bus late and therefore EVERY hold a breach - the guardrail switches the
 * controller off, silently, for a reason that is about the schedule rather than
 * the corridor. Measured: tightening the booked time 15% cut the excess-wait
 * improvement from 52.9% to 19.4% and holding from 183 s per bus to 31 s.
 *
 * So the timetable comes from the UNCONTROLLED arm's own mean arrival at each
 * stop. The uncontrolled arm is then on time by construction, which is exactly
 * the baseline wanted: every second of lateness on the controlled arm is a
 * second the CONTROLLER added, not one the schedule invented.
 */
function timetableFromRun(
  visits: readonly StopVisitRecord[],
  dispatches: readonly TerminalDispatchPlan[],
  stopCount: number,
): Record<string, number[]> {
  // Mean offset from departure to each stop, across every reported bus.
  const totals = new Array<number>(stopCount).fill(0);
  const counts = new Array<number>(stopCount).fill(0);
  const dispatchByVehicle = new Map(dispatches.map((d) => [d.vehicleId, d.scheduledDispatchSeconds]));

  for (const visit of visits) {
    if (!isReported(visit.vehicleId)) continue;
    const dispatchSeconds = dispatchByVehicle.get(visit.vehicleId);
    if (dispatchSeconds === undefined) continue;
    if (visit.stopIndex < 0 || visit.stopIndex >= stopCount) continue;
    totals[visit.stopIndex] = (totals[visit.stopIndex] ?? 0) + (visit.arrivalSeconds - dispatchSeconds);
    counts[visit.stopIndex] = (counts[visit.stopIndex] ?? 0) + 1;
  }

  const offsets = totals.map((total, index) => {
    const count = counts[index] ?? 0;
    return count > 0 ? total / count : 0;
  });
  // Monotonic by construction: a booked arrival cannot precede the one before it.
  for (let index = 1; index < offsets.length; index++) {
    offsets[index] = Math.max(offsets[index] ?? 0, offsets[index - 1] ?? 0);
  }

  const timetable: Record<string, number[]> = {};
  for (const dispatch of dispatches) {
    timetable[dispatch.vehicleId] = offsets.map((offset) => dispatch.scheduledDispatchSeconds + offset);
  }
  return timetable;
}

// ─── Metric helpers ──────────────────────────────────────────────────────

function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] ?? null;
}

/**
 * Every station, not only the holding points.
 *
 * ─── WHY THE MEASUREMENT POPULATION IS NOT THE ACTION POPULATION ─────────
 *
 * `simulation/kpi.ts` samples headway at control points, which is the right
 * default for a regression fixture: it is where the controller acts, so it is
 * where a regression would show. It is the wrong population for THIS question.
 *
 * Passengers wait at every station, so service quality is a property of every
 * station. Worse, tying the measurement to the holding points makes the metric
 * move when the holding points move: MEASURED while sweeping how many stations
 * were designated, baseline EWT read 61 s with two holding points and 323 s
 * with ten - on the identical uncontrolled corridor, because each configuration
 * was being scored on a different set of stops. Any comparison across
 * placements would have been meaningless, and it would have looked like a
 * finding.
 */
function allStopIds(corridor: CorridorInputs): Set<string> {
  return new Set(corridor.stops.map((s) => s.stopId));
}

function spacingKpis(
  visits: readonly StopVisitRecord[],
  corridor: CorridorInputs,
): SpacingKpis {
  const reported = visits.filter((v) => isReported(v.vehicleId));
  const samples = computeHeadwaySamples(reported, allStopIds(corridor));
  const dispersion = computeDispersion(samples, corridor.policy.targetHeadwaySeconds);
  const bunchThreshold = corridor.policy.bunchedThresholdRatio * corridor.policy.targetHeadwaySeconds;
  const deniedBoardings = reported.reduce((acc, v) => acc + v.deniedBoardings, 0);
  const firstTimeDeniedBoardings = reported.reduce((acc, v) => acc + v.firstTimeDeniedBoardings, 0);
  const totalBoardings = reported.reduce((acc, v) => acc + v.boardings, 0);

  return {
    headwaySampleCount: dispersion.sampleCount,
    meanHeadwaySeconds: dispersion.meanHeadwaySeconds,
    ewtSeconds: dispersion.ewtSeconds,
    headwayCv: dispersion.cv,
    bunchingRate:
      samples.length > 0 ? samples.filter((h) => h < bunchThreshold).length / samples.length : 0,
    deniedBoardings,
    firstTimeDeniedBoardings,
    totalBoardings,
    deniedShare: deniedShare(firstTimeDeniedBoardings, totalBoardings),
    saturated: isSaturated(firstTimeDeniedBoardings, totalBoardings),
  };
}

/** Offered passengers = those who boarded plus those refused. A fifth refused is the line `evaluation/report.ts` draws. */
export const SATURATION_DENIED_SHARE = 0.2;

/**
 * The share of offered passengers refused a seat, in PEOPLE on both sides.
 *
 * ─── WHY THIS IS PUBLISHED AND NOT LEFT TO THE READER ────────────────────
 *
 * It was not on the wire at all. `SpacingKpis` carried `deniedBoardings` (a
 * count of refusal EVENTS - a passenger a full bus turns away is offered to
 * the next bus and counted again), `totalBoardings` (a HEADCOUNT, each person
 * once) and a `saturated` flag, and nothing said which arithmetic the flag was
 * drawn on. A reader who built a share from the two numbers in front of them
 * got `deniedBoardings / totalBoardings`, which divides a rate by a headcount:
 * MEASURED on urban at 500 buses/phase it read 52% beside a flag reading
 * false. Both numbers were honest and they described different things.
 *
 * So the flag is now `deniedShare > SATURATION_DENIED_SHARE` and nothing else,
 * and the share travels beside it. They cannot disagree because they are one
 * expression.
 *
 * Null - not zero - when nobody was offered a seat at all: "no passenger
 * reached this arm" and "every passenger boarded" are opposite statements.
 */
function deniedShare(firstTimeDeniedBoardings: number, totalBoardings: number): number | null {
  const offered = firstTimeDeniedBoardings + totalBoardings;
  return offered > 0 ? firstTimeDeniedBoardings / offered : null;
}

/**
 * Whether waiting time here is bounded by seats rather than by spacing.
 *
 * Worked through at an urban stop, for why the numerator is the headcount:
 * three buses that refuse seven distinct people, every one of whom boards in
 * the end, record 14 denial EVENTS and would report 40% saturation on a stop
 * that saturated nobody.
 */
function isSaturated(firstTimeDeniedBoardings: number, totalBoardings: number): boolean {
  const share = deniedShare(firstTimeDeniedBoardings, totalBoardings);
  return share !== null && share > SATURATION_DENIED_SHARE;
}

/** Headway samples on their own, so a phase can pool every scenario's and reduce them ONCE rather than average means. */
function headwaySamplesOf(
  visits: readonly StopVisitRecord[],
  corridor: CorridorInputs,
): number[] {
  return computeHeadwaySamples(visits.filter((v) => isReported(v.vehicleId)), allStopIds(corridor));
}

/**
 * Waiting and onboard-delay passenger-seconds, measured off the simulated day.
 *
 * The waiting half comes from the engine rather than being reconstructed here.
 * It used to be `boardings x leaderHeadway / 2` - the gap between two buses'
 * arrivals, halved - which is right only while every bus takes everybody
 * waiting. It parts company with the truth the moment one does not, and it
 * charged the people who walked on while a bus was HELD the same wait as the
 * people who had been standing there since the last bus left.
 */
function passengerOutcome(visits: readonly StopVisitRecord[]): PassengerOutcome {
  let waitPassengerSeconds = 0;
  let onboardDelayPassengerSeconds = 0;
  let dwellPassengerSeconds = 0;
  let ridePassengerSeconds = 0;
  let boardings = 0;
  let deniedBoardings = 0;

  // Riding between stops needs a vehicle's visits in stop order, so the
  // timeline is assembled once rather than re-scanned per stop.
  const byVehicle = new Map<string, StopVisitRecord[]>();

  for (const visit of visits) {
    if (!isReported(visit.vehicleId)) continue;
    // Straight from the engine, which is the only thing that knows the two
    // boarding populations apart - see `StopVisitRecord.boardingWaitPassengerSeconds`.
    waitPassengerSeconds += visit.boardingWaitPassengerSeconds;
    // From the engine, like the waiting half above and for the same reason:
    // `appliedHoldSeconds x onboardAfter` charges the people who walked onto
    // the bus DURING the hold both for turning up then and for the hold.
    onboardDelayPassengerSeconds += visit.onboardDelayPassengerSeconds;
    dwellPassengerSeconds += visit.dwellPassengerSeconds;
    boardings += visit.boardings;
    deniedBoardings += visit.deniedBoardings;
    const bucket = byVehicle.get(visit.vehicleId) ?? [];
    bucket.push(visit);
    byVehicle.set(visit.vehicleId, bucket);
  }

  for (const timeline of byVehicle.values()) {
    timeline.sort((a, b) => a.stopIndex - b.stopIndex);
    for (let index = 0; index < timeline.length - 1; index++) {
      const from = timeline[index]!;
      const to = timeline[index + 1]!;
      const rideSeconds = Math.max(0, to.arrivalSeconds - from.departureSeconds);
      ridePassengerSeconds += rideSeconds * from.onboardAfter;
    }
  }

  // Rounded ONCE, at the leaves, and the totals summed from the rounded parts.
  // Rounding each of five reals independently and rounding their sum
  // separately leaves the two disagreeing by a second or two - which is
  // nothing to a reader and fatal to `total === wait + inVehicle`, an identity
  // the report states and the console draws two bars against.
  const wait = Math.round(waitPassengerSeconds);
  const hold = Math.round(onboardDelayPassengerSeconds);
  const dwell = Math.round(dwellPassengerSeconds);
  const ride = Math.round(ridePassengerSeconds);
  const inVehicle = dwell + hold + ride;

  return {
    boardings,
    deniedBoardings,
    waitPassengerSeconds: wait,
    onboardDelayPassengerSeconds: hold,
    dwellPassengerSeconds: dwell,
    ridePassengerSeconds: ride,
    inVehiclePassengerSeconds: inVehicle,
    totalPassengerSeconds: wait + inVehicle,
  };
}

/**
 * How close to its booked time a bus has to arrive to count as punctual.
 *
 * Five minutes either side, which is the operator's own framing of the trade
 * this trial exists to measure: a little delay is acceptable, a lot is not.
 * Symmetric, because a bus running five minutes EARLY has left passengers
 * behind at every stop it passed and is not a success.
 */
export const ON_TIME_WINDOW_SECONDS = 300;

interface JourneyRecord {
  vehicleId: string;
  journeySeconds: number;
  holdSeconds: number;
  refusedHoldSeconds: number;
  /** Lateness at the terminus against the booked timetable, or null when none was booked. */
  scheduleDeviationSeconds: number | null;
  alightingOnlyActions: number;
  alightingOnlyPassengersPassed: number;
}

/**
 * End-to-end journey time per bus, and what holding added to it.
 *
 * Counted only for buses that REACHED the terminus. A bus still on the road
 * when the simulated day ends has no journey time, and giving it a partial one
 * would quietly shorten the mean by exactly the buses that ran longest.
 */
function journeysOf(
  visits: readonly StopVisitRecord[],
  dispatches: readonly TerminalDispatchPlan[],
  finalStopIndex: number,
  scheduledArrivalSeconds?: Record<string, number[]>,
): JourneyRecord[] {
  const dispatchByVehicle = new Map(dispatches.map((d) => [d.vehicleId, d.scheduledDispatchSeconds]));
  const byVehicle = new Map<
    string,
    { arrival: number | null; hold: number; refused: number; limited: number; passed: number }
  >();

  for (const visit of visits) {
    if (!isReported(visit.vehicleId)) continue;
    const entry =
      byVehicle.get(visit.vehicleId) ?? { arrival: null, hold: 0, refused: 0, limited: 0, passed: 0 };
    if (visit.stopIndex === finalStopIndex) entry.arrival = visit.arrivalSeconds;
    entry.hold += visit.appliedHoldSeconds;
    // The seconds the instruction asked for that the kerb did not get.
    // A refusal is the whole hold; a driver who took the instruction and
    // served part of it (`compliedHoldFraction`) leaves the rest here too,
    // and the difference is exactly zero for a hold that was fully served.
    entry.refused += visit.intendedHoldSeconds - visit.appliedHoldSeconds;
    if (visit.boardingLimitedPassengers > 0) {
      entry.limited++;
      entry.passed += visit.boardingLimitedPassengers;
    }
    byVehicle.set(visit.vehicleId, entry);
  }

  const journeys: JourneyRecord[] = [];
  for (const [vehicleId, entry] of byVehicle) {
    const dispatchSeconds = dispatchByVehicle.get(vehicleId);
    if (dispatchSeconds === undefined || entry.arrival === null) continue;
    const booked = scheduledArrivalSeconds?.[vehicleId]?.[finalStopIndex];
    journeys.push({
      vehicleId,
      journeySeconds: entry.arrival - dispatchSeconds,
      holdSeconds: entry.hold,
      refusedHoldSeconds: entry.refused,
      scheduleDeviationSeconds: booked === undefined ? null : entry.arrival - booked,
      alightingOnlyActions: entry.limited,
      alightingOnlyPassengersPassed: entry.passed,
    });
  }
  return journeys;
}

function punctualityKpis(
  journeys: readonly JourneyRecord[],
  maxLatenessSeconds: number | null,
): PunctualityKpis {
  const durations = journeys.map((j) => j.journeySeconds).sort((a, b) => a - b);
  const totalHoldSeconds = journeys.reduce((acc, j) => acc + j.holdSeconds, 0);
  const deviations = journeys
    .map((j) => j.scheduleDeviationSeconds)
    .filter((v): v is number => v !== null);
  const sortedDeviations = [...deviations].sort((a, b) => a - b);
  return {
    meanScheduleDeviationSeconds:
      deviations.length > 0 ? deviations.reduce((a, b) => a + b, 0) / deviations.length : null,
    p95ScheduleDeviationSeconds: percentile(sortedDeviations, 0.95),
    onTimeRate:
      deviations.length > 0
        ? deviations.filter((v) => Math.abs(v) <= ON_TIME_WINDOW_SECONDS).length / deviations.length
        : null,
    // How many buses the punctuality guardrail would already refuse to hold
    // before anybody has held anything. See `scheduleFit`.
    shareBeyondLatenessBound:
      maxLatenessSeconds === null || deviations.length === 0
        ? null
        : deviations.filter((v) => v > maxLatenessSeconds).length / deviations.length,
    vehiclesCompleted: journeys.length,
    meanJourneySeconds:
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    p95JourneySeconds: percentile(durations, 0.95),
    maxJourneySeconds: durations.length > 0 ? (durations[durations.length - 1] ?? null) : null,
    totalHoldSeconds,
    meanHoldSecondsPerVehicle: journeys.length > 0 ? totalHoldSeconds / journeys.length : 0,
    maxHoldSecondsOnAnyVehicle: journeys.reduce((acc, j) => Math.max(acc, j.holdSeconds), 0),
    refusedHoldSeconds: journeys.reduce((acc, j) => acc + j.refusedHoldSeconds, 0),
    alightingOnlyActions: journeys.reduce((acc, j) => acc + j.alightingOnlyActions, 0),
    alightingOnlyPassengersPassed: journeys.reduce((acc, j) => acc + j.alightingOnlyPassengersPassed, 0),
  };
}

/**
 * `endOfRunSeconds` is the same sweep-window bound `detectIncidents` was
 * given (`sweepUntilSeconds`) - needed here because an incident still open
 * when the window closed carries `durationSeconds: null`, and charging it
 * zero bunched-seconds-open would understate exactly the incidents that were
 * open the LONGEST.
 */
export function summarizeIncidents(
  incidents: readonly DetectedIncident[],
  endOfRunSeconds: number,
): IncidentSummary {
  const byOpeningSeverity: Record<string, number> = {};
  const byPeakSeverity: Record<string, number> = {};
  const resolutionDurations: number[] = [];
  let resolved = 0;
  let closedPairGone = 0;
  let unresolvedAtEnd = 0;
  let escalatedFromPrediction = 0;
  let withIntervention = 0;
  let totalHoldSecondsServed = 0;
  let worstRatio: number | null = null;
  let bunchedSecondsOpen = 0;

  for (const incident of incidents) {
    byOpeningSeverity[incident.openedSeverity] = (byOpeningSeverity[incident.openedSeverity] ?? 0) + 1;
    byPeakSeverity[incident.peakSeverity] = (byPeakSeverity[incident.peakSeverity] ?? 0) + 1;
    if (incident.openedSeverity === 'predicted' && incident.peakSeverity !== 'predicted') {
      escalatedFromPrediction++;
    }
    if (incident.closeReason === 'recovered' || incident.closeReason === 'risk_cleared') {
      resolved++;
      if (incident.durationSeconds !== null) resolutionDurations.push(incident.durationSeconds);
    } else if (incident.closeReason === 'pair_no_longer_adjacent') {
      closedPairGone++;
    } else {
      unresolvedAtEnd++;
    }
    if (incident.holdCount > 0) withIntervention++;
    totalHoldSecondsServed += incident.holdSecondsApplied;
    if (worstRatio === null || incident.minRatio < worstRatio) worstRatio = incident.minRatio;
    if (incident.peakSeverity === 'bunched') {
      bunchedSecondsOpen += incident.durationSeconds ?? endOfRunSeconds - incident.openedAtSeconds;
    }
  }

  resolutionDurations.sort((a, b) => a - b);
  const median = percentile(resolutionDurations, 0.5);

  return {
    detected: incidents.length,
    byOpeningSeverity,
    byPeakSeverity,
    escalatedFromPrediction,
    resolved,
    closedPairGone,
    unresolvedAtEnd,
    medianResolutionSeconds: median,
    meanResolutionSeconds:
      resolutionDurations.length > 0
        ? resolutionDurations.reduce((a, b) => a + b, 0) / resolutionDurations.length
        : null,
    worstRatio,
    withIntervention,
    totalHoldSecondsServed,
    bunchedSecondsOpen,
  };
}

function contrast(controlled: ArmReport, uncontrolled: ArmReport): ArmContrast {
  const improvement = (before: number | null, after: number | null): number | null =>
    before === null || after === null ? null : before - after;
  const percent = (before: number | null, after: number | null): number | null =>
    before === null || after === null || before === 0 ? null : ((before - after) / before) * 100;

  const addedJourney =
    controlled.punctuality.vehiclesCompleted > 0 && uncontrolled.punctuality.vehiclesCompleted > 0
      ? (controlled.punctuality.meanJourneySeconds ?? 0) -
        (uncontrolled.punctuality.meanJourneySeconds ?? 0)
      : null;

  // Per BOARDING, so a difference in how many passengers each arm served
  // cannot masquerade as a difference in what happened to them.
  const perBoarding = (arm: ArmReport): number | null =>
    arm.passengers.boardings > 0
      ? arm.passengers.totalPassengerSeconds / arm.passengers.boardings
      : null;
  const uncontrolledPerBoarding = perBoarding(uncontrolled);
  const controlledPerBoarding = perBoarding(controlled);

  const waitSecondsSaved =
    uncontrolled.passengers.waitPassengerSeconds - controlled.passengers.waitPassengerSeconds;
  const passengerSecondsSaved =
    uncontrolled.passengers.totalPassengerSeconds - controlled.passengers.totalPassengerSeconds;

  return {
    waitSecondsSaved,
    onboardDelayImposed: controlled.passengers.onboardDelayPassengerSeconds,
    inVehicleSecondsSaved:
      uncontrolled.passengers.inVehiclePassengerSeconds -
      controlled.passengers.inVehiclePassengerSeconds,
    passengerSecondsSaved,
    passengerSecondsSavedPercent:
      uncontrolled.passengers.totalPassengerSeconds > 0
        ? (passengerSecondsSaved / uncontrolled.passengers.totalPassengerSeconds) * 100
        : null,
    passengerSecondsPerBoardingSavedPercent:
      uncontrolledPerBoarding !== null && controlledPerBoarding !== null && uncontrolledPerBoarding > 0
        ? ((uncontrolledPerBoarding - controlledPerBoarding) / uncontrolledPerBoarding) * 100
        : null,
    ewtImprovementSeconds: improvement(uncontrolled.spacing.ewtSeconds, controlled.spacing.ewtSeconds),
    ewtImprovementPercent: percent(uncontrolled.spacing.ewtSeconds, controlled.spacing.ewtSeconds),
    cvImprovementPercent: percent(uncontrolled.spacing.headwayCv, controlled.spacing.headwayCv),
    bunchingRateImprovementPercent: percent(
      uncontrolled.spacing.bunchingRate,
      controlled.spacing.bunchingRate,
    ),
    incidentsAvoided: uncontrolled.incidents.detected - controlled.incidents.detected,
    deepIncidentsAvoided:
      (uncontrolled.incidents.byPeakSeverity['bunched'] ?? 0) -
      (controlled.incidents.byPeakSeverity['bunched'] ?? 0),
    bunchedSecondsOpenReduced:
      uncontrolled.incidents.bunchedSecondsOpen - controlled.incidents.bunchedSecondsOpen,
    bunchedSecondsOpenReducedPercent: percent(
      uncontrolled.incidents.bunchedSecondsOpen,
      controlled.incidents.bunchedSecondsOpen,
    ),
    addedJourneySecondsPerVehicle: addedJourney,
    // PEOPLE, not refusal events. A passenger left behind is one person
    // harmed however many buses passed them, and the two arms repeat their
    // refusals at different rates - measured on one urban run, 23% of the
    // uncontrolled arm's denials were somebody being turned away again
    // against 10% of the controlled arm's, so the event counts differed by 9
    // where the headcounts differed by 223.
    //
    // Plus the people an alighting-only instruction left standing. That is a
    // decision rather than a capacity shortfall - which is why `saturated` is
    // drawn on the capacity half alone - but to the passenger it is the same
    // bus leaving without them, and this line is about passengers.
    additionalDeniedBoardings:
      controlled.spacing.firstTimeDeniedBoardings +
      controlled.punctuality.alightingOnlyPassengersPassed -
      (uncontrolled.spacing.firstTimeDeniedBoardings +
        uncontrolled.punctuality.alightingOnlyPassengersPassed),
  };
}

// ─── Bounded evidence ────────────────────────────────────────────────────

function downsample<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  const step = items.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    const item = items[Math.floor(i * step)];
    if (item !== undefined) out.push(item);
  }
  return out;
}

/**
 * CONSECUTIVE buses from the middle of the fleet, never a spread.
 *
 * A trajectory chart shows bunching as two lines converging, which only
 * exists between buses that actually follow each other. Sampling every tenth
 * bus would draw ten lines that never interact and would make the most
 * bunched corridor in the trial look perfectly regular.
 */
function pickTrajectoryVehicles(dispatches: readonly TerminalDispatchPlan[]): string[] {
  const reported = dispatches.filter((d) => isReported(d.vehicleId));
  if (reported.length <= MAX_TRAJECTORY_VEHICLES) return reported.map((d) => d.vehicleId);
  const start = Math.max(0, Math.floor(reported.length / 2) - Math.floor(MAX_TRAJECTORY_VEHICLES / 2));
  return reported.slice(start, start + MAX_TRAJECTORY_VEHICLES).map((d) => d.vehicleId);
}

function buildTrajectories(
  visits: readonly StopVisitRecord[],
  dispatches: readonly TerminalDispatchPlan[],
  corridor: CorridorInputs,
  vehicleIds: readonly string[],
): VehicleTrajectory[] {
  const wanted = new Set(vehicleIds);
  const dispatchByVehicle = new Map(dispatches.map((d) => [d.vehicleId, d.scheduledDispatchSeconds]));
  const byVehicle = new Map<string, StopVisitRecord[]>();
  for (const visit of visits) {
    if (!wanted.has(visit.vehicleId)) continue;
    const bucket = byVehicle.get(visit.vehicleId) ?? [];
    bucket.push(visit);
    byVehicle.set(visit.vehicleId, bucket);
  }

  const trajectories: VehicleTrajectory[] = [];
  for (const vehicleId of vehicleIds) {
    const timeline = (byVehicle.get(vehicleId) ?? []).sort((a, b) => a.stopIndex - b.stopIndex);
    if (timeline.length === 0) continue;
    const dispatchSeconds = dispatchByVehicle.get(vehicleId) ?? 0;
    // The trace starts at the terminal, distance zero: without it every line
    // begins at the first station and the dispatch spacing - the thing
    // `terminal_jitter` is entirely about - is invisible.
    const points = [{ t: Math.round(dispatchSeconds), d: 0, hold: 0 }];
    for (const visit of timeline) {
      const stop = corridor.stops[visit.stopIndex];
      if (!stop) continue;
      points.push({
        t: Math.round(visit.arrivalSeconds),
        d: stop.cumulativeDistanceMeters,
        hold: Math.round(visit.appliedHoldSeconds),
      });
    }
    trajectories.push({ vehicleId, points });
  }
  return trajectories;
}

function worstIncidents(incidents: readonly DetectedIncident[]): DetectedIncident[] {
  return [...incidents].sort((a, b) => a.minRatio - b.minRatio).slice(0, MAX_INCIDENT_SAMPLES);
}

// ─── Law coverage ────────────────────────────────────────────────────────

function coverageOf(decisions: readonly RehearsalDecisionRecord[]): LawCoverage[] {
  return CONTROL_LAWS.map((law) => {
    let generating = 0;
    const declines = new Map<DeclineReason, number>();
    for (const decision of decisions) {
      if ((decision.coverage.generated[law] ?? 0) > 0) {
        generating++;
        continue;
      }
      const reason = decision.coverage.declined[law];
      if (reason) declines.set(reason, (declines.get(reason) ?? 0) + 1);
    }
    let commonestDecline: DeclineReason | null = null;
    let commonestCount = 0;
    for (const [reason, count] of declines) {
      if (count > commonestCount) {
        commonestDecline = reason;
        commonestCount = count;
      }
    }
    const declinedTotal = [...declines.values()].reduce((a, b) => a + b, 0);
    return {
      law: law,
      decisionsGenerating: generating,
      decisionsTotal: decisions.length,
      commonestDecline,
      commonestDeclineShare: declinedTotal > 0 ? commonestCount / declinedTotal : null,
    };
  });
}

// ─── One scenario, both arms ─────────────────────────────────────────────

/**
 * One tick per simulated run, against a total fixed before the trial started.
 *
 * Threaded through every function that calls `runScenario` or `simulate` in a
 * loop, because those loops ARE the trial's work - see `progress.ts` for why
 * the phases alone are not. It reports and returns; nothing downstream of a
 * tick reads it, so a caller that passes no reporter runs the identical code.
 */
type UnitTick = (stage: FleetTrialStage, label: string) => void;

function unitReporter(total: number, report: FleetTrialProgressReporter | undefined): UnitTick {
  let done = 0;
  return (stage, label) => {
    done++;
    report?.({ done, total, stage, label });
  };
}

interface ScenarioRun {
  report: ScenarioReport;
  controlledVisits: StopVisitRecord[];
  uncontrolledVisits: StopVisitRecord[];
  decisions: readonly RehearsalDecisionRecord[];
  config: ScenarioConfig;
  /** What the command path did with this run's instructions. Absent unless the spec asked for one. */
  commandLifecycle?: CommandLifecycleLedger;
}

function runScenario(args: {
  corridor: CorridorInputs;
  scenario: BunchingScenario;
  inputs: ModelledInputs;
  vehicleIds: readonly string[];
  seed: number;
  weighOccupancy: boolean;
  requiredSamples: number;
  sweepIntervalSeconds: number;
  followerSpeedSource: 'link_average' | 'vehicle_state';
  alightingOnlySelectable: boolean;
  commandLifecycle: CommandLifecycleTrialOptions;
  /** See `mpc/actionThreshold.ts#isPairActionable` and the `forecast_gate` study. */
  forecastGateEnabled?: boolean;
}): ScenarioRun {
  const {
    corridor,
    scenario,
    inputs,
    vehicleIds,
    seed,
    weighOccupancy,
    requiredSamples,
    sweepIntervalSeconds,
    followerSpeedSource,
    alightingOnlySelectable,
    commandLifecycle,
    forecastGateEnabled = false,
  } = args;
  const config = buildTrialScenario({ corridor, scenario, inputs, vehicleIds, seed });
  const finalStopIndex = corridor.stops.length - 1;
  const excludeVehicleIds = new Set([WARMUP_VEHICLE_ID]);

  // Uncontrolled FIRST, and its timetable used for both arms: the schedule is a
  // measurement of what this corridor does when left alone, so the controlled
  // arm's lateness is the controller's doing rather than the schedule's.
  const uncontrolled = simulate(config, noControlController);
  const timetable = timetableFromRun(
    uncontrolled.visits,
    config.dispatches,
    corridor.stops.length,
  );
  // ─── THE COMMAND PATH GOES ON THE CONTROLLED ARM ONLY ──────────────────
  //
  // The uncontrolled arm proposes nothing, so a gate there would refuse
  // nothing and report an empty ledger - but it must not SHARE one with the
  // controlled arm either, or the controlled arm's cooldowns and per-cycle
  // budget would be charged against a run that issued no instructions. The
  // limits come from the corridor's own policy, never from the caller: see
  // `commandLifecyclePolicyFrom`.
  const timetabledConfig: ScenarioConfig = {
    ...config,
    scheduledArrivalSeconds: timetable,
    ...(commandLifecycle.enabled
      ? {
          commandLifecycle: commandLifecyclePolicyFrom(corridor.policy, {
            deliveryLatencySeconds: commandLifecycle.deliveryLatencySeconds,
          }),
        }
      : {}),
  };
  const controller = createDeployedControlLawsController({
    policy: corridor.policy,
    epochMs: REHEARSAL_EPOCH_MS,
    modelledCapacity: inputs.vehicleCapacity,
    weighOccupancy,
    followerSpeedSource,
    // Lets the laws that ask about a NEIGHBOUR see one - without this,
    // alighting-only could never pass its leader check and reported 0%
    // coverage for a reason that belonged to the harness.
    corridorStops: corridor.stops,
    alightingOnlySelectable,
    forecastGateEnabled,
    // The forecast's sample history is appended on the SAME cadence the trial
    // replays the detector at, because production fits it from `headway_states`
    // and that table is written by the headway sweep. See
    // `rehearsal/deployedControlLaws.ts#forecastSweepIntervalSeconds`.
    forecastSweepIntervalSeconds: sweepIntervalSeconds,
    // Left at the deployed switch. The closed-form optimum is the argmin of
    // the very quantity candidates are ranked by, so letting it compete would
    // REPLACE the tuned controller rather than add to it - and a trial that
    // silently flipped it would be measuring a different system.
  });
  const controlled = simulate(timetabledConfig, controller);

  const decisions = controller.decisions.filter((d) => isReported(d.vehicleId));

  // ONE sweep window for both arms. Each arm's own last departure would give
  // the controlled one more sweeps than the uncontrolled one, because holding
  // makes buses finish later - and `incidentsAvoided` is the difference of the
  // two counts, so the arms have to be watched for the same length of time.
  const detectionHorizonSeconds = Math.max(
    ...controlled.visits.map((v) => v.departureSeconds),
    ...uncontrolled.visits.map((v) => v.departureSeconds),
    0,
  );
  const detectedControlled = detectIncidents({
    corridor,
    visits: controlled.visits,
    dispatches: config.dispatches,
    disturbances: config.disturbances,
    requiredSamples,
    decisions,
    sweepIntervalSeconds,
    excludeVehicleIds,
    sweepUntilSeconds: detectionHorizonSeconds,
  });
  const detectedUncontrolled = detectIncidents({
    corridor,
    visits: uncontrolled.visits,
    dispatches: config.dispatches,
    disturbances: config.disturbances,
    requiredSamples,
    sweepIntervalSeconds,
    excludeVehicleIds,
    sweepUntilSeconds: detectionHorizonSeconds,
  });

  const controlledArm: ArmReport = {
    spacing: spacingKpis(controlled.visits, corridor),
    punctuality: punctualityKpis(
      journeysOf(controlled.visits, config.dispatches, finalStopIndex, timetable),
      corridor.policy.maxLatenessSeconds,
    ),
    passengers: passengerOutcome(controlled.visits),
    incidents: summarizeIncidents(detectedControlled.incidents, detectionHorizonSeconds),
  };
  const uncontrolledArm: ArmReport = {
    spacing: spacingKpis(uncontrolled.visits, corridor),
    punctuality: punctualityKpis(
      journeysOf(uncontrolled.visits, config.dispatches, finalStopIndex, timetable),
      corridor.policy.maxLatenessSeconds,
    ),
    passengers: passengerOutcome(uncontrolled.visits),
    incidents: summarizeIncidents(detectedUncontrolled.incidents, detectionHorizonSeconds),
  };

  const trajectoryVehicleIds = pickTrajectoryVehicles(config.dispatches);
  const horizonSeconds = detectionHorizonSeconds;

  const report: ScenarioReport = {
    id: scenario.id,
    title: scenario.title,
    mechanism: scenario.mechanism,
    whatItTests: scenario.whatItTests,
    vehicleCount: vehicleIds.length,
    seed,
    horizonSeconds: Math.round(horizonSeconds),
    controlled: controlledArm,
    uncontrolled: uncontrolledArm,
    contrast: contrast(controlledArm, uncontrolledArm),
    sweeps: {
      controlled: downsample<SweepSample>(detectedControlled.sweeps, MAX_SWEEP_POINTS),
      uncontrolled: downsample<SweepSample>(detectedUncontrolled.sweeps, MAX_SWEEP_POINTS),
    },
    trajectories: {
      controlled: buildTrajectories(controlled.visits, config.dispatches, corridor, trajectoryVehicleIds),
      uncontrolled: buildTrajectories(uncontrolled.visits, config.dispatches, corridor, trajectoryVehicleIds),
    },
    worstIncidents: worstIncidents(detectedControlled.incidents),
    worstIncidentsUncontrolled: worstIncidents(detectedUncontrolled.incidents),
  };

  return {
    report,
    controlledVisits: controlled.visits,
    uncontrolledVisits: uncontrolled.visits,
    decisions,
    config: timetabledConfig,
    ...(controlled.commandLifecycle ? { commandLifecycle: controlled.commandLifecycle } : {}),
  };
}

// ─── Phase aggregation ───────────────────────────────────────────────────

/**
 * The phase's KPIs from POOLED samples, never a mean of scenario means.
 *
 * EWT is a ratio of second moment to first moment. Averaging ten scenarios'
 * EWTs weights a scenario that produced forty headway samples the same as one
 * that produced four hundred, and the arithmetic does not even commute.
 * Pooling every sample and reducing once is both correct and simpler.
 */
function poolArm(
  runs: readonly ScenarioRun[],
  corridor: CorridorInputs,
  pick: (run: ScenarioRun) => StopVisitRecord[],
  armOf: (report: ScenarioReport) => ArmReport,
): ArmReport {
  const finalStopIndex = corridor.stops.length - 1;
  const samples: number[] = [];
  const journeys: JourneyRecord[] = [];
  let deniedBoardings = 0;
  let firstTimeDeniedBoardings = 0;
  let totalBoardings = 0;
  const pooledPassengers: PassengerOutcome = {
    boardings: 0,
    deniedBoardings: 0,
    waitPassengerSeconds: 0,
    onboardDelayPassengerSeconds: 0,
    dwellPassengerSeconds: 0,
    ridePassengerSeconds: 0,
    inVehiclePassengerSeconds: 0,
    totalPassengerSeconds: 0,
  };

  for (const run of runs) {
    const visits = pick(run);
    samples.push(...headwaySamplesOf(visits, corridor));
    journeys.push(
      ...journeysOf(visits, run.config.dispatches, finalStopIndex, run.config.scheduledArrivalSeconds),
    );
    const outcome = passengerOutcome(visits);
    pooledPassengers.boardings += outcome.boardings;
    pooledPassengers.deniedBoardings += outcome.deniedBoardings;
    pooledPassengers.waitPassengerSeconds += outcome.waitPassengerSeconds;
    pooledPassengers.onboardDelayPassengerSeconds += outcome.onboardDelayPassengerSeconds;
    pooledPassengers.dwellPassengerSeconds += outcome.dwellPassengerSeconds;
    pooledPassengers.ridePassengerSeconds += outcome.ridePassengerSeconds;
    pooledPassengers.inVehiclePassengerSeconds += outcome.inVehiclePassengerSeconds;
    pooledPassengers.totalPassengerSeconds += outcome.totalPassengerSeconds;
    for (const visit of visits) {
      if (!isReported(visit.vehicleId)) continue;
      deniedBoardings += visit.deniedBoardings;
      firstTimeDeniedBoardings += visit.firstTimeDeniedBoardings;
      totalBoardings += visit.boardings;
    }
  }

  const dispersion = computeDispersion(samples, corridor.policy.targetHeadwaySeconds);
  const bunchThreshold = corridor.policy.bunchedThresholdRatio * corridor.policy.targetHeadwaySeconds;

  // Incident counts add across scenarios; the durations behind the median do
  // not, so the phase median is recomputed from the scenario summaries'
  // means weighted by count rather than pretending to a pooled quantile.
  const incidentTotals = runs.map((run) => armOf(run.report).incidents);
  const merged = mergeIncidentSummaries(incidentTotals);

  return {
    spacing: {
      headwaySampleCount: dispersion.sampleCount,
      meanHeadwaySeconds: dispersion.meanHeadwaySeconds,
      ewtSeconds: dispersion.ewtSeconds,
      headwayCv: dispersion.cv,
      bunchingRate:
        samples.length > 0 ? samples.filter((h) => h < bunchThreshold).length / samples.length : 0,
      deniedBoardings,
      firstTimeDeniedBoardings,
      totalBoardings,
      deniedShare: deniedShare(firstTimeDeniedBoardings, totalBoardings),
      saturated: isSaturated(firstTimeDeniedBoardings, totalBoardings),
    },
    punctuality: punctualityKpis(journeys, corridor.policy.maxLatenessSeconds),
    passengers: pooledPassengers,
    incidents: merged,
  };
}

function mergeIncidentSummaries(summaries: readonly IncidentSummary[]): IncidentSummary {
  const byOpeningSeverity: Record<string, number> = {};
  const byPeakSeverity: Record<string, number> = {};
  let detected = 0;
  let resolved = 0;
  let closedPairGone = 0;
  let unresolvedAtEnd = 0;
  let escalatedFromPrediction = 0;
  let withIntervention = 0;
  let totalHoldSecondsServed = 0;
  let worstRatio: number | null = null;
  let resolutionSecondsWeighted = 0;
  let resolutionCount = 0;
  let bunchedSecondsOpen = 0;
  const medians: number[] = [];

  for (const summary of summaries) {
    detected += summary.detected;
    resolved += summary.resolved;
    closedPairGone += summary.closedPairGone;
    unresolvedAtEnd += summary.unresolvedAtEnd;
    escalatedFromPrediction += summary.escalatedFromPrediction;
    withIntervention += summary.withIntervention;
    totalHoldSecondsServed += summary.totalHoldSecondsServed;
    bunchedSecondsOpen += summary.bunchedSecondsOpen;
    for (const [key, count] of Object.entries(summary.byOpeningSeverity)) {
      byOpeningSeverity[key] = (byOpeningSeverity[key] ?? 0) + count;
    }
    for (const [key, count] of Object.entries(summary.byPeakSeverity)) {
      byPeakSeverity[key] = (byPeakSeverity[key] ?? 0) + count;
    }
    if (summary.worstRatio !== null && (worstRatio === null || summary.worstRatio < worstRatio)) {
      worstRatio = summary.worstRatio;
    }
    if (summary.meanResolutionSeconds !== null && summary.resolved > 0) {
      resolutionSecondsWeighted += summary.meanResolutionSeconds * summary.resolved;
      resolutionCount += summary.resolved;
    }
    if (summary.medianResolutionSeconds !== null) medians.push(summary.medianResolutionSeconds);
  }

  medians.sort((a, b) => a - b);
  return {
    detected,
    byOpeningSeverity,
    byPeakSeverity,
    escalatedFromPrediction,
    resolved,
    closedPairGone,
    unresolvedAtEnd,
    // The median of the scenarios' medians, and labelled as such rather than
    // presented as the median of every incident - the per-incident durations
    // are not carried across the wire, so a true pooled quantile is not
    // available here and inventing one would be worse than saying which it is.
    medianResolutionSeconds: percentile(medians, 0.5),
    meanResolutionSeconds: resolutionCount > 0 ? resolutionSecondsWeighted / resolutionCount : null,
    worstRatio,
    withIntervention,
    totalHoldSecondsServed,
    bunchedSecondsOpen,
  };
}

// ─── What the headline is allowed to be an average of ────────────────────

/**
 * The scenarios whose numbers can be READ, decided by measurement.
 *
 * A scenario is excluded when EITHER arm is past the saturation line. Either,
 * not both: the contrast between the two arms is a difference of quantities
 * that saturation bounds, so one saturated side is enough to make the
 * difference uninterpretable. It is decided on the measured `saturated` flag
 * rather than on an id list - `oversaturated` is the scenario this was built
 * for, but naming it would go stale the first time it was renamed, and would
 * silently keep including the next scenario that crossed the line.
 *
 * Computed across EVERY phase, so all phases pool an identical scenario set
 * and remain comparable with each other.
 */
function headlineScopeOf(
  runsByPhase: readonly (readonly ScenarioRun[])[],
): FleetTrialReport['headlineScope'] {
  const excluded = new Map<string, { id: string; title: string; deniedShare: number }>();
  const order: string[] = [];

  for (const runs of runsByPhase) {
    for (const run of runs) {
      const report = run.report;
      if (!order.includes(report.id)) order.push(report.id);
      for (const arm of [report.controlled, report.uncontrolled]) {
        if (!arm.spacing.saturated) continue;
        const share = arm.spacing.deniedShare ?? 0;
        const seen = excluded.get(report.id);
        // The worst share across the arms and phases that flagged it: the
        // number shown should be the one that most clearly justifies the call.
        if (!seen || share > seen.deniedShare) {
          excluded.set(report.id, { id: report.id, title: report.title, deniedShare: share });
        }
      }
    }
  }

  const included = order.filter((id) => !excluded.has(id));
  if (included.length === 0) {
    return {
      includedScenarioIds: order,
      excludedScenarios: [],
      fellBackToAllScenarios: true,
      note:
        'Every scenario in this trial ran past the saturation line, so there was no readable subset to average. The headline is the whole set, and past that line spacing control cannot move it.',
    };
  }

  const excludedList = order.filter((id) => excluded.has(id)).map((id) => excluded.get(id)!);
  return {
    includedScenarioIds: included,
    excludedScenarios: excludedList,
    fellBackToAllScenarios: false,
    note:
      excludedList.length === 0
        ? `Averaged over all ${included.length} scenarios. None ran past the saturation line.`
        : `Averaged over ${included.length} of ${order.length} scenarios. ${excludedList
            .map((s) => `${s.title} (${(s.deniedShare * 100).toFixed(0)}% refused a seat)`)
            .join(', ')} ${excludedList.length === 1 ? 'was' : 'were'} left out: past the saturation line waiting time is bounded by how many seats exist rather than by how they are spaced, so spacing control cannot move the figure there and averaging it in only pulls the headline towards zero.`,
  };
}

/**
 * How the phase's own scenarios agreed about the sign of its pooled contrast.
 *
 * NOT an error bar - see `PhaseReport.scenarioAgreement`. Ten scenarios are ten
 * different kinds of bad day, not ten replicates, so this answers "is the
 * result broad or is it one scenario" rather than "how noisy is it".
 */
function scenarioAgreement(reports: readonly ScenarioReport[]): PhaseReport['scenarioAgreement'] {
  let worst: ScenarioReport | null = null;
  let best: ScenarioReport | null = null;
  let positive = 0;
  let count = 0;
  for (const report of reports) {
    const value = report.contrast.passengerSecondsSavedPercent;
    if (value === null) continue;
    count++;
    if (value > 0) positive++;
    if (worst === null || value < (worst.contrast.passengerSecondsSavedPercent ?? 0)) worst = report;
    if (best === null || value > (best.contrast.passengerSecondsSavedPercent ?? 0)) best = report;
  }
  return {
    positive,
    count,
    worstPercent: worst?.contrast.passengerSecondsSavedPercent ?? null,
    worstScenarioId: worst?.id ?? null,
    bestPercent: best?.contrast.passengerSecondsSavedPercent ?? null,
    bestScenarioId: best?.id ?? null,
  };
}

/** Every hard-safety rejection across a phase, counted by reason. */
function safetyRejections(runs: readonly ScenarioRun[]): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const run of runs) {
    for (const decision of run.decisions) {
      for (const rejection of decision.rejected) {
        for (const reason of rejection.reasons) {
          counts.set(reason, (counts.get(reason) ?? 0) + 1);
        }
      }
    }
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

function holdBreakdown(runs: readonly ScenarioRun[], corridor: CorridorInputs) {
  const byStation = new Map<string, { holdSeconds: number; holdCount: number }>();
  const byActionType = new Map<string, { count: number; holdSeconds: number }>();

  for (const run of runs) {
    const actionByKey = new Map<string, string>();
    for (const decision of run.decisions) {
      actionByKey.set(`${decision.vehicleId}|${decision.atSeconds}`, decision.selectedActionType);
    }
    for (const visit of run.controlledVisits) {
      if (!isReported(visit.vehicleId) || visit.appliedHoldSeconds <= 0) continue;
      const station = byStation.get(visit.stopId) ?? { holdSeconds: 0, holdCount: 0 };
      station.holdSeconds += visit.appliedHoldSeconds;
      station.holdCount++;
      byStation.set(visit.stopId, station);

      const actionType = actionByKey.get(`${visit.vehicleId}|${visit.arrivalSeconds}`) ?? 'unknown';
      const action = byActionType.get(actionType) ?? { count: 0, holdSeconds: 0 };
      action.count++;
      action.holdSeconds += visit.appliedHoldSeconds;
      byActionType.set(actionType, action);
    }
  }

  return {
    holdSecondsByStation: corridor.stops.map((stop) => ({
      stopId: stop.stopId,
      name: stop.name,
      sequence: stop.sequence,
      holdSeconds: Math.round(byStation.get(stop.stopId)?.holdSeconds ?? 0),
      holdCount: byStation.get(stop.stopId)?.holdCount ?? 0,
    })),
    holdCountByActionType: [...byActionType.entries()]
      .map(([actionType, value]) => ({
        actionType,
        count: value.count,
        holdSeconds: Math.round(value.holdSeconds),
      }))
      .sort((a, b) => b.holdSeconds - a.holdSeconds),
  };
}

// ─── The occupancy question, answered by a paired re-run ─────────────────

/**
 * What the occupancy switch changed, measured rather than assumed.
 *
 * The two PHASES cannot answer this on their own: they run different buses on
 * different seeds, so a difference between them is confounded with the day.
 * This re-runs the occupancy-aware phase's exact scenarios with the switch
 * OFF and compares decision by decision - same corridor, same plan, same
 * seed, one input different.
 *
 * The comparison is keyed on (vehicle, station) rather than on position in the
 * decision stream: if the two settings ever select differently, the two
 * simulations diverge from that point and their streams stop lining up, which
 * is precisely when a positional comparison would start comparing unrelated
 * decisions.
 */
function compareOccupancySettings(args: {
  corridor: CorridorInputs;
  runs: readonly ScenarioRun[];
  inputs: ModelledInputs;
  requiredSamples: number;
  followerSpeedSource: 'link_average' | 'vehicle_state';
  tick?: UnitTick;
}): OccupancyContrast {
  const { corridor, runs, inputs, followerSpeedSource, tick } = args;

  interface DecisionShape {
    actionType: string;
    holdSeconds: number;
    objectiveCost: number | null;
  }

  const shapeOf = (decision: RehearsalDecisionRecord): DecisionShape => {
    const selected = decision.candidates.find((c) => c.actionType === decision.selectedActionType);
    return {
      actionType: decision.selectedActionType,
      holdSeconds: decision.holdSeconds,
      objectiveCost: selected ? selected.objectiveCost : null,
    };
  };

  let decisionsChanged = 0;
  let decisionsCompared = 0;
  let awareCostSum = 0;
  let awareCostCount = 0;
  let blindCostSum = 0;
  let blindCostCount = 0;
  let rankingComparable = false;

  for (const run of runs) {
    const blindController = createDeployedControlLawsController({
      policy: corridor.policy,
      epochMs: REHEARSAL_EPOCH_MS,
      modelledCapacity: inputs.vehicleCapacity,
      weighOccupancy: false,
      followerSpeedSource,
      corridorStops: corridor.stops,
      alightingOnlySelectable: true,
    });
    simulate(run.config, blindController);
    tick?.('occupancy_contrast', `Occupancy switch off - ${run.report.title}`);

    const blindByKey = new Map<string, DecisionShape>();
    for (const decision of blindController.decisions) {
      if (!isReported(decision.vehicleId)) continue;
      blindByKey.set(`${decision.vehicleId}|${decision.stopId}`, shapeOf(decision));
      // More than one RANKED candidate is what a ranking needs to bite on.
      // Counted by the controller off its own safe pool
      // (`mpc/solver.ts#isRankedMidRouteCandidate`): `decision.candidates` is
      // every candidate the laws generated, including the ones the safety
      // filter refused and the two families the ranked pool never contains.
      if (decision.rankedCandidateCount > 1) rankingComparable = true;
    }

    for (const decision of run.decisions) {
      const key = `${decision.vehicleId}|${decision.stopId}`;
      const blind = blindByKey.get(key);
      if (!blind) continue;
      const aware = shapeOf(decision);
      decisionsCompared++;
      if (aware.actionType !== blind.actionType || aware.holdSeconds !== blind.holdSeconds) {
        decisionsChanged++;
      }
      if (aware.objectiveCost !== null) {
        awareCostSum += aware.objectiveCost;
        awareCostCount++;
      }
      if (blind.objectiveCost !== null) {
        blindCostSum += blind.objectiveCost;
        blindCostCount++;
      }
    }
  }

  const meanAware = awareCostCount > 0 ? awareCostSum / awareCostCount : null;
  const meanBlind = blindCostCount > 0 ? blindCostSum / blindCostCount : null;

  let verdict: string;
  if (decisionsCompared === 0) {
    verdict = 'No decision was made under both settings, so the switch could not be compared.';
  } else if (decisionsChanged === 0) {
    verdict =
      `Across ${decisionsCompared.toLocaleString()} matched decisions the switch changed nothing that was issued. ` +
      'It changes what a hold COSTS in the objective, not which hold is chosen: the mid-route laws are mutually ' +
      'exclusive on this corridor, so at most one selectable candidate is ever offered and there is no ranking for ' +
      'the load term to reorder. The one place occupancy would change a hold LENGTH is the closed-form optimum, ' +
      'which is generated and priced on every solve but is not selectable until lambda is calibrated from real boardings.';
  } else {
    const share = ((decisionsChanged / decisionsCompared) * 100).toFixed(1);
    verdict =
      `Weighing passenger load changed the instruction at ${decisionsChanged.toLocaleString()} of ` +
      `${decisionsCompared.toLocaleString()} matched decisions (${share}%).`;
  }

  return {
    decisionsChanged,
    decisionsCompared,
    meanObjectiveCostBlind: meanBlind,
    meanObjectiveCostAware: meanAware,
    rankingComparable,
    verdict,
  };
}

// ─── Is self_equalizing actually exercised? A coverage re-run, not a study ─

/**
 * Re-runs phase 1's scenarios and seeds with `kb` forced to null, which
 * disables `two_way` outright (`twoWayHold.ts:37`) and removes
 * `self_equalizing`'s only gate (`selfEqualizing.ts:55-56`), making it the
 * one law left to cover the corridor.
 *
 * NEVER wired into `phases` or any other field `runFleetTrial` uses to build
 * the deployed configuration's own numbers - this corridor and its decisions
 * exist only for this function's return value, so the deployed `lawCoverage`
 * and `contrast` cannot be affected by its existence. See
 * `SelfEqualizingCoverageReport`.
 */
function runSelfEqualizingCoverage(args: {
  corridor: CorridorInputs;
  scenarios: readonly BunchingScenario[];
  inputs: ModelledInputs;
  spec: FleetTrialSpec;
  vehiclesPerPhase: number;
  deployedSelfEqualizing: LawCoverage | undefined;
  tick?: UnitTick;
}): SelfEqualizingCoverageReport {
  const { corridor, scenarios, inputs, spec, vehiclesPerPhase, deployedSelfEqualizing, tick } =
    args;
  const coverageCorridor: CorridorInputs = {
    ...corridor,
    policy: { ...corridor.policy, kb: null },
  };

  const base = Math.floor(vehiclesPerPhase / scenarios.length);
  const remainder = vehiclesPerPhase - base * scenarios.length;
  let busNumber = 0;
  const runs: ScenarioRun[] = [];
  for (const [index, scenario] of scenarios.entries()) {
    const vehicleCount = base + (index < remainder ? 1 : 0);
    if (vehicleCount < 2) continue;
    runs.push(
      runScenario({
        corridor: coverageCorridor,
        scenario,
        inputs: scaleInputs(inputs, scenario),
        vehicleIds: Array.from(
          { length: vehicleCount },
          () => `COVERAGE-${String(++busNumber).padStart(4, '0')}`,
        ),
        // Same seeds as phase 1 (occupancy-blind, no phase offset), so this
        // arm is paired against the same days the deployed configuration ran.
        seed: (spec.seed + index * 7919) >>> 0,
        weighOccupancy: false,
        requiredSamples: spec.requiredSamples,
        sweepIntervalSeconds: spec.sweepIntervalSeconds,
        followerSpeedSource: spec.followerSpeedSource,
        alightingOnlySelectable: spec.alightingOnlySelectable,
        commandLifecycle: spec.commandLifecycle,
      }),
    );
    tick?.('self_equalizing', `Self-equalizing fallback - ${scenario.title}`);
  }

  const controlled = poolArm(runs, coverageCorridor, (r) => r.controlledVisits, (report) => report.controlled);
  const uncontrolled = poolArm(
    runs,
    coverageCorridor,
    (r) => r.uncontrolledVisits,
    (report) => report.uncontrolled,
  );
  const lawCoverage = coverageOf(runs.flatMap((r) => [...r.decisions]));
  const selfEqualizing = lawCoverage.find((l) => l.law === 'self_equalizing');

  const coverageShare =
    selfEqualizing && selfEqualizing.decisionsTotal > 0
      ? (selfEqualizing.decisionsGenerating / selfEqualizing.decisionsTotal) * 100
      : 0;
  const deployedShare =
    deployedSelfEqualizing && deployedSelfEqualizing.decisionsTotal > 0
      ? (deployedSelfEqualizing.decisionsGenerating / deployedSelfEqualizing.decisionsTotal) * 100
      : 0;
  const verdict =
    `With two-way holding disabled (kb = null), self-equalizing generated on ` +
    `${selfEqualizing?.decisionsGenerating ?? 0} of ${selfEqualizing?.decisionsTotal ?? 0} decisions ` +
    `(${coverageShare.toFixed(2)}%) - against ${deployedShare.toFixed(2)}% on the deployed configuration, ` +
    'which this variant never changes.';

  return {
    vehicleCount: runs.reduce((acc, r) => acc + r.report.vehicleCount, 0),
    controlled,
    uncontrolled,
    contrast: contrast(controlled, uncontrolled),
    lawCoverage,
    verdict,
  };
}

// ─── What each policy knob is worth, on THIS corridor ────────────────────

/** One variant of the corridor, and the label it is reported under. */
interface PolicyVariant {
  label: string;
  corridor: FleetCorridorSpec;
  /**
   * Overrides on the shared modelled inputs, for a study that sweeps an INPUT
   * rather than a `route_policies` column - see `runDispersionSensitivityStudy`.
   * Empty for every corridor-knob study, which is the common case.
   */
  inputs?: Partial<ModelledInputs>;
  /**
   * Whether this variant runs with the forecast-admission gate on. A CONTROL
   * LAW switch rather than a corridor column or a modelled input, which is why
   * it is a third override kind here: the gate is not something a corridor
   * has, it is something the controller does. Absent means the deployed state,
   * off.
   */
  forecastGate?: boolean;
  isCurrent: boolean;
}

/**
 * Runs a list of corridor variants against the same fleet, scenarios and seeds,
 * and scores them against each other.
 *
 * Run with the occupancy switch OFF for every row, so the only thing varying is
 * the knob under test. The SAME seed is used across variants at a given index,
 * so the difference between two rows is the setting rather than the weather.
 *
 * The excess-wait figures are comparable across rows only because `spacingKpis`
 * samples EVERY station rather than only the designated ones - see
 * `allStopIds`, and the artefact that made these rows meaningless before it.
 */
function runPolicyStudy(args: {
  spec: FleetTrialSpec;
  knob: string;
  title: string;
  description: string;
  variants: readonly PolicyVariant[];
  scenarios: readonly BunchingScenario[];
  inputs: ModelledInputs;
  vehiclesPerPhase: number;
  tick?: UnitTick;
}): PolicyStudy {
  const { spec, knob, title, description, variants, scenarios, inputs, vehiclesPerPhase, tick } =
    args;

  const rows: PolicyStudyRow[] = [];
  for (const variant of variants) {
    const corridor = buildFleetCorridor(variant.corridor);
    // A variant that overrides an INPUT (dispersion) rather than a corridor
    // column merges over the study's shared inputs; every other study leaves
    // this untouched and gets `inputs` back unchanged.
    const variantInputs: ModelledInputs = variant.inputs ? { ...inputs, ...variant.inputs } : inputs;
    const perSeed: {
      net: number | null;
      ewt: number | null;
      hold: number;
      worst: number;
      holds: number;
      denied: number;
      detected: number;
      resolved: number;
      incidentsAvoided: number;
    }[] = [];

    for (let seedIndex = 0; seedIndex < STUDY_SEEDS; seedIndex++) {
      const runs: ScenarioRun[] = [];
      let busNumber = 0;
      const base = Math.floor(vehiclesPerPhase / scenarios.length);
      const remainder = vehiclesPerPhase - base * scenarios.length;

      for (const [index, scenario] of scenarios.entries()) {
        const vehicleCount = base + (index < remainder ? 1 : 0);
        if (vehicleCount < 2) continue;
        runs.push(
          runScenario({
            corridor,
            scenario,
            inputs: scaleInputs(variantInputs, scenario),
            vehicleIds: Array.from(
              { length: vehicleCount },
              () => `STUDY-${String(++busNumber).padStart(4, '0')}`,
            ),
            seed: (spec.seed + seedIndex * 104_729 + index * 7919) >>> 0,
            weighOccupancy: false,
            requiredSamples: spec.requiredSamples,
            sweepIntervalSeconds: spec.sweepIntervalSeconds,
            followerSpeedSource: spec.followerSpeedSource,
            alightingOnlySelectable: spec.alightingOnlySelectable,
            commandLifecycle: spec.commandLifecycle,
            forecastGateEnabled: variant.forecastGate ?? false,
          }),
        );
        tick?.('policy_study', `${title} - ${variant.label}, seed ${seedIndex + 1}`);
      }
      if (runs.length === 0) continue;

      const controlled = poolArm(runs, corridor, (r) => r.controlledVisits, (report) => report.controlled);
      const uncontrolled = poolArm(runs, corridor, (r) => r.uncontrolledVisits, (report) => report.uncontrolled);
      const armContrast = contrast(controlled, uncontrolled);
      const holds = holdBreakdown(runs, corridor);
      perSeed.push({
        net: armContrast.passengerSecondsSavedPercent,
        ewt: armContrast.ewtImprovementPercent,
        hold: controlled.punctuality.meanHoldSecondsPerVehicle,
        worst: controlled.punctuality.maxHoldSecondsOnAnyVehicle,
        holds: holds.holdCountByActionType.reduce((acc, a) => acc + a.count, 0),
        // Headcount, matching `additionalDeniedBoardings` - the column is read
        // as "how many people did this setting strand".
        denied: controlled.spacing.firstTimeDeniedBoardings,
        detected: controlled.incidents.detected,
        resolved: controlled.incidents.resolved,
        incidentsAvoided: armContrast.incidentsAvoided,
      });
    }
    if (perSeed.length === 0) continue;

    const mean = (pick: (row: (typeof perSeed)[number]) => number | null): number | null => {
      const values = perSeed.map(pick).filter((v): v is number => v !== null);
      return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
    };
    const meanNet = mean((row) => row.net);
    const agreeing =
      meanNet === null
        ? 0
        : perSeed.filter((row) => row.net !== null && Math.sign(row.net) === Math.sign(meanNet)).length;

    rows.push({
      label: variant.label,
      ewtImprovementPercent: mean((row) => row.ewt),
      passengerSecondsSavedPercent: meanNet,
      meanHoldSecondsPerVehicle: mean((row) => row.hold) ?? 0,
      worstBusHoldSeconds: perSeed.reduce((acc, row) => Math.max(acc, row.worst), 0),
      holdCount: perSeed.reduce((acc, row) => acc + row.holds, 0),
      deniedBoardings: perSeed.reduce((acc, row) => acc + row.denied, 0),
      incidentsDetected: perSeed.reduce((acc, row) => acc + row.detected, 0),
      incidentsResolved: perSeed.reduce((acc, row) => acc + row.resolved, 0),
      incidentsAvoided: perSeed.reduce((acc, row) => acc + row.incidentsAvoided, 0),
      seedCount: perSeed.length,
      seedsAgreeingWithSign: agreeing,
      isCurrent: variant.isCurrent,
    });
  }

  // The best wait gain among the settings that did not cost passengers time
  // overall AND whose seeds agreed about it. Ordering it this way rather than
  // by wait gain alone is the whole lesson of the trial - the biggest wait
  // improvement has repeatedly also been the one that made passengers
  // collectively worse off - and requiring seed agreement is the lesson of a
  // gain-tuning result that looked convincing over three seeds and reversed
  // over ten.
  const affordable = rows.filter(
    (row) =>
      (row.passengerSecondsSavedPercent ?? -1) >= 0 &&
      row.seedsAgreeingWithSign > row.seedCount / 2,
  );
  // Sorted on TOTAL PASSENGER TIME first and excess wait only as a tie-break.
  //
  // Ranking on excess wait was wrong for the same reason the whole trial leads
  // with passenger time: it counts only the people at stops, and the setting
  // with the best wait figure has repeatedly been the one that made passengers
  // collectively worse off. It also produced arbitrary answers - two holding
  // placements tied at 46.1% wait improvement, and the tie-break handed the
  // recommendation to the one with the WORSE net effect.
  const ranked = [...affordable].sort(
    (a, b) =>
      (b.passengerSecondsSavedPercent ?? 0) - (a.passengerSecondsSavedPercent ?? 0) ||
      (b.ewtImprovementPercent ?? 0) - (a.ewtImprovementPercent ?? 0),
  );

  // ─── DRIVER TIME BREAKS A TIE, AND ONLY A TIE ──────────────────────────
  //
  // A hold is executed by a driver keeping a bus standing at a stop
  // (`mpc/eligibility.ts` - it can be executed nowhere else), and driver time
  // is a real cost the passenger-second metric does not price at all. Two
  // settings whose passenger-time AND excess-wait figures are indistinguishable
  // are not "one better than the other", and recommending the one that asks
  // more of drivers spends goodwill on a difference nobody measured.
  //
  // It is the LAST key, not the first, and that was measured the wrong way
  // round first: ranking on holding as soon as passenger time tied recommended
  // 4 of 15 stations over 15 of 15 on the suburban corridor - saving 2.6
  // min/bus of holding and throwing away 29 points of excess-wait improvement
  // for it. Excess wait is the service quality passengers actually experience;
  // driver time decides only between settings that deliver the same of it,
  // which is the exact-tie case this file already recorded (two placements
  // tied at 46.1% and the recommendation went to the worse net effect).
  const TIE_POINTS = 0.3;
  const best = ranked[0];
  const recommended =
    best === undefined
      ? undefined
      : [...ranked]
          .filter(
            (row) =>
              (best.passengerSecondsSavedPercent ?? 0) - (row.passengerSecondsSavedPercent ?? 0) <=
              TIE_POINTS,
          )
          .sort(
            (a, b) =>
              (b.ewtImprovementPercent ?? 0) - (a.ewtImprovementPercent ?? 0) ||
              a.meanHoldSecondsPerVehicle - b.meanHoldSecondsPerVehicle,
          )[0];
  const current = rows.find((row) => row.isCurrent);

  let verdict: string;
  if (rows.length < 2) {
    verdict = 'Only one setting was tried, so there is nothing to compare.';
  } else if (recommended && current && recommended.label !== current.label) {
    const holdSaved = current.meanHoldSecondsPerVehicle - recommended.meanHoldSecondsPerVehicle;
    verdict =
      `${recommended.label} beats the configured ${current.label}: ` +
      `${(recommended.ewtImprovementPercent ?? 0).toFixed(0)}% excess-wait improvement against ` +
      `${(current.ewtImprovementPercent ?? 0).toFixed(0)}%, and ` +
      `${(recommended.passengerSecondsSavedPercent ?? 0).toFixed(1)}% of total passenger time saved against ` +
      `${(current.passengerSecondsSavedPercent ?? 0).toFixed(1)}%.` +
      // Driver time is a real cost the passenger-second metric does not price,
      // so when the recommendation also asks less of drivers, say so.
      (holdSaved > 1
        ? ` It also asks ${(holdSaved / 60).toFixed(1)} fewer minutes of holding per bus.`
        : '');
  } else if (recommended) {
    verdict =
      `The configured ${recommended.label} is the best of those tried: ` +
      `${(recommended.ewtImprovementPercent ?? 0).toFixed(0)}% excess-wait improvement without costing ` +
      'passengers time overall.';
  } else {
    const byTrade = [...rows].sort(
      (a, b) =>
        (b.ewtImprovementPercent ?? 0) / Math.max(0.1, Math.abs(b.passengerSecondsSavedPercent ?? 0)) -
        (a.ewtImprovementPercent ?? 0) / Math.max(0.1, Math.abs(a.passengerSecondsSavedPercent ?? 0)),
    );
    const best = byTrade[0];
    verdict =
      'Every setting tried cost passengers a little more time than it saved on this corridor. They are not ' +
      `equally expensive: ${best?.label} returns ${(best?.ewtImprovementPercent ?? 0).toFixed(0)}% of the wait ` +
      `improvement for ${Math.abs(best?.passengerSecondsSavedPercent ?? 0).toFixed(1)}% of total passenger time.`;
  }

  return { knob, title, description, rows, recommended: recommended?.label ?? null, verdict, seedsPerRow: STUDY_SEEDS };
}

/**
 * Dispersion levels worth trying on this corridor, as MULTIPLES of the
 * preset's own configured value.
 *
 * Multiplicative for the same reason `BunchingScenario.inputScale` is: what
 * counts as noisy on a calm corridor is not what counts on a disturbed one,
 * and an absolute value tuned to read sensibly on one preset reads as either
 * "barely perturbed" or "impossible" on another (urban ships at 0.18,
 * inter-city at 0.14). The top multiple, 3.3x, is wider than any single
 * scenario's own `travelTimeVariation` scaling (`cascade`'s 1.6x is the
 * largest in `scenarios.ts`) - chosen to reproduce the range this trial's own
 * investigation measured on the urban preset (`docs/FLEET_TRIAL.md`), not to
 * match an existing scenario.
 */
function dispersionVariants(
  current: number,
): { label: string; travelTimeVariation: number; isCurrent: boolean }[] {
  const multiples = [0.5, 1, 2, 10 / 3];
  const values = [...new Set(multiples.map((m) => Number((current * m).toFixed(4))))]
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  return values.map((v) => ({
    label: `${(v * 100).toFixed(0)}% travel-time variation`,
    travelTimeVariation: v,
    isCurrent: Math.abs(v - current) < 1e-9,
  }));
}

/**
 * How sensitive the headline is to corridor dispersion, holding demand fixed.
 *
 * ─── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * `NOT_EXERCISED` names the invented demand, the untouched command lifecycle,
 * the absent state estimator and the booked timetable - and used to leave out
 * the one input the headline is most sensitive to. Measured by sweeping
 * `travelTimeVariation` alone with demand held at the preset's own value: the
 * excess-wait improvement moves an order of magnitude more than it does
 * across an equivalent swing in the INVENTED boarding rate. So the headline
 * is never quoted again without this sweep sitting beside it - see
 * `docs/FLEET_TRIAL.md` for the specific figures this measured on the urban
 * preset.
 *
 * Built ON `runPolicyStudy` - identical rows, seeds and pairing to every
 * other study - because dispersion is swept exactly like a policy knob would
 * be. What differs is what the result MEANS: nobody configures corridor
 * dispersion, so there is no "best" setting, and the verdict says so instead
 * of picking one.
 */
function runDispersionSensitivityStudy(args: {
  spec: FleetTrialSpec;
  scenarios: readonly BunchingScenario[];
  inputs: ModelledInputs;
  vehiclesPerPhase: number;
  corridorSpec: FleetCorridorSpec;
  tick?: UnitTick;
}): PolicyStudy {
  const { spec, scenarios, inputs, vehiclesPerPhase, corridorSpec, tick } = args;
  const variants: PolicyVariant[] = dispersionVariants(inputs.travelTimeVariation).map((v) => ({
    label: v.label,
    corridor: corridorSpec,
    inputs: { travelTimeVariation: v.travelTimeVariation },
    isCurrent: v.isCurrent,
  }));

  const study = runPolicyStudy({
    spec,
    knob: 'travel_time_variation',
    title: 'How sensitive the headline is to corridor dispersion',
    description:
      'NOT a policy knob - nobody configures how noisy a corridor is. The shipped preset states one INVENTED dispersion value among many; this sweeps it, as a multiple of that value, with demand held fixed, because it is the input the headline moves most against.',
    variants,
    scenarios,
    inputs,
    vehiclesPerPhase,
    tick,
  });

  const shipped = study.rows.find((row) => row.isCurrent);
  const ranked = [...study.rows].sort(
    (a, b) => (b.ewtImprovementPercent ?? -Infinity) - (a.ewtImprovementPercent ?? -Infinity),
  );
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  const verdict =
    study.rows.length < 2 || !best || !worst
      ? 'Only one dispersion level was tried, so there is nothing to compare.'
      : `From ${best.label} to ${worst.label}, excess-wait improvement runs ` +
        `${(best.ewtImprovementPercent ?? 0).toFixed(1)}% down to ${(worst.ewtImprovementPercent ?? 0).toFixed(1)}%, ` +
        `and incidents avoided ${best.incidentsAvoided} down to ${worst.incidentsAvoided}` +
        (shipped
          ? ` - the shipped preset (${shipped.label}) is measured at ${(shipped.ewtImprovementPercent ?? 0).toFixed(1)}% ` +
            `and ${shipped.incidentsAvoided} incidents avoided.`
          : '.') +
        ' This is not a setting to tune; it is the range the headline is exposed to before any control law runs, and it is far wider than the range demand alone produces.';

  return { ...study, recommended: null, verdict };
}

/** The placements and lateness bounds worth trying on this corridor. */
function policyVariants(corridorSpec: FleetCorridorSpec): {
  holdingPoints: PolicyVariant[];
  lateness: PolicyVariant[];
  actionBar: PolicyVariant[];
  forecastGate: PolicyVariant[];
} {
  const stationCount = corridorSpec.stationCount;
  const configuredHolding = corridorSpec.holdingPointCount ?? stationCount;
  const holdingCounts = [
    ...new Set([
      Math.max(2, Math.round(stationCount * 0.25)),
      Math.max(3, Math.round(stationCount * 0.5)),
      Math.max(4, Math.round(stationCount * 0.75)),
      stationCount,
      configuredHolding,
    ]),
  ]
    .filter((n) => n >= 1 && n <= stationCount)
    .sort((a, b) => a - b);

  const headway = corridorSpec.targetHeadwaySeconds;
  // Multiples of the corridor's own headway rather than absolute seconds: what
  // counts as "very late" on a six-minute service is not what counts on a
  // thirty-minute one. `null` is included because on a high-frequency corridor
  // no bound at all measured best - passengers there turn up rather than
  // consulting a timetable, so headway regularity IS the punctuality objective.
  const latenessValues: number[] = [
    ...new Set(
      [
        Math.round(headway / 6),
        Math.round(headway / 3),
        Math.round(headway),
        Math.round(headway * 2),
        corridorSpec.maxLatenessSeconds,
      ].filter((v): v is number => v !== null),
    ),
  ].sort((a, b) => a - b);

  // ─── HOW DEVIANT A PAIR MUST BE BEFORE ANYONE IS INSTRUCTED ─────────
  //
  // `mpc/actionThreshold.ts#isWorthActingOn` bars a mid-route hold for any
  // pair whose forward headway is above `warning_threshold_ratio x H*` - the
  // same number the corridor's alert surface uses to decide whether a human is
  // told. It is the single largest filter in the system: on the urban corridor
  // it refuses 65% of every decision the mid-route laws are offered.
  //
  // It was swept once, by hand, and every value read as noise. That sweep was
  // taken on the old headline - waiting plus the hold, over a waiting-only
  // denominator - and the sibling conclusion from the same era (alighting-only
  // "loses on 7 of 8 seeds") did not survive the metric being fixed. A knob
  // this consequential belongs in the trial's own swept set, paired by seed
  // and reported with its agreement count, rather than in a note that says a
  // measurement was taken once.
  const configuredBar = corridorSpec.warningThresholdRatio;
  const actionBars = [...new Set([0.3, 0.5, 0.75, 1.0, configuredBar])].sort((a, b) => a - b);

  // ─── ACTING EARLY ON THE PAIRS PREDICTED TO COME APART ──────────────
  //
  // Two rows, and the pairing is the whole point. The corridor is IDENTICAL
  // in both - same `warningThresholdRatio`, so the same 0.6 effective action
  // bar the `actionBar` study above sweeps and the bar this repo currently
  // ships. The only thing that differs is whether the mid-route laws may also
  // act on a pair that bar declines when the pair's own forecast says it is
  // heading through it.
  //
  // Read against the raised bar, not the old one. `MID_ROUTE_ACTION_RATIO`
  // already moved the effective bar 0.5 -> 0.6 and took the timing win that
  // did not spend the guardrail; the question this study asks is what the
  // forecast buys ON TOP of that, which is the only question left worth
  // asking. Comparing the gate against the old bar would credit it with a
  // win that is already shipped.
  const forecastGateVariants: PolicyVariant[] = [
    { label: 'off (deployed)', corridor: corridorSpec, forecastGate: false, isCurrent: true },
    { label: 'on', corridor: corridorSpec, forecastGate: true, isCurrent: false },
  ];

  return {
    forecastGate: forecastGateVariants,
    actionBar: actionBars.map((ratio) => ({
      label: `h_fwd under ${(ratio * 100).toFixed(0)}% of H*`,
      corridor: { ...corridorSpec, warningThresholdRatio: ratio },
      isCurrent: ratio === configuredBar,
    })),
    holdingPoints: holdingCounts.map((count) => ({
      label: `${count} of ${stationCount} stations`,
      corridor: { ...corridorSpec, holdingPointCount: count },
      isCurrent: count === configuredHolding,
    })),
    lateness: [
      ...latenessValues.map((seconds) => ({
        label: `${Math.round(seconds / 60)} min`,
        corridor: { ...corridorSpec, maxLatenessSeconds: seconds },
        isCurrent: corridorSpec.maxLatenessSeconds === seconds,
      })),
      {
        label: 'no bound',
        corridor: { ...corridorSpec, maxLatenessSeconds: null },
        isCurrent: corridorSpec.maxLatenessSeconds === null,
      },
    ],
  };
}

/** Where this corridor sits on the controllability curve. One formula, one place - see `lib/controllability.ts`. */
function assessControllability(
  corridor: CorridorInputs,
  inputs: ModelledInputs,
): FleetTrialReport['controllability'] {
  return measureControllability({
    cumulativeDistanceMeters: corridor.stops.map((stop) => stop.cumulativeDistanceMeters),
    cruiseSpeedKmph: inputs.cruiseSpeedKmph,
    travelTimeVariation: inputs.travelTimeVariation,
    targetHeadwaySeconds: corridor.policy.targetHeadwaySeconds,
  });
}

/**
 * Whether the booked timetable is one the corridor can keep. See
 * `FleetTrialReport.scheduleFit` for what happens when it is not.
 *
 * ─── THE MEAN CANNOT ANSWER THIS, AND USED TO BE ASKED ───────────────────
 *
 * `timetableFromRun` books each stop's MEAN arrival offset across the
 * uncontrolled arm. Measuring that same arm's MEAN deviation against it is
 * then arithmetically zero - not approximately, exactly: a real run returns
 * -1.05e-12 s and a ratio of -2.9e-15, and it does so on every corridor,
 * every seed and every phase. So the tripwire CLAUDE.md names as the guard
 * against the single largest silent failure this trial has ever had could
 * not fire, and reported `achievable` by construction rather than by
 * measurement.
 *
 * What the tripwire is actually for is the punctuality guardrail:
 * `mpc/safety.ts` refuses a hold that would push a bus past
 * `max_lateness_seconds`, and if the schedule is one nobody can keep then
 * EVERY bus is late and EVERY hold is a breach - the controller is switched
 * off for a reason about the timetable, silently. The quantity that says so
 * is the SHARE OF BUSES ALREADY PAST THE BOUND WITH NO CONTROL AT ALL. The
 * derivation does not zero it, because it is about the spread rather than
 * the centre: booking the mean leaves half the fleet late by construction and
 * says nothing about how late.
 *
 * The mean is still reported, because a caller who supplies its own timetable
 * (rather than letting the trial book one) gets a real number there.
 */
function assessScheduleFit(
  phases: readonly PhaseReport[],
  corridor: CorridorInputs,
  maxLatenessSeconds: number | null,
): FleetTrialReport['scheduleFit'] {
  // The UNCONTROLLED arm only: the controlled one measures the schedule plus
  // the holds, and it is the schedule that is on trial here.
  const deviations = phases
    .map((phase) => phase.uncontrolled.punctuality.meanScheduleDeviationSeconds)
    .filter((value): value is number => value !== null);
  if (deviations.length === 0) {
    return {
      meanUncontrolledDeviationSeconds: null,
      deviationRatio: null,
      shareBeyondLatenessBound: null,
      band: 'achievable',
      note: 'No timetable was booked, so there is nothing to check the schedule against.',
    };
  }

  const mean = deviations.reduce((a, b) => a + b, 0) / deviations.length;
  const headway = corridor.policy.targetHeadwaySeconds;
  const ratio = headway > 0 ? mean / headway : 0;

  const shares = phases
    .map((phase) => phase.uncontrolled.punctuality.shareBeyondLatenessBound)
    .filter((value): value is number => value !== null);
  const share = shares.length > 0 ? shares.reduce((a, b) => a + b, 0) / shares.length : null;

  // Half the fleet, which is where a bound stops discriminating. A timetable
  // booked from the mean leaves about half the buses late by construction and
  // half early, so a HEALTHY corridor sits just under this - what it must not
  // do is sit near 1, where the guardrail has refused everybody before the
  // controller has proposed anything.
  const BOUND_REFUSES_MOST = 0.75;

  const band =
    share !== null && share > BOUND_REFUSES_MOST
      ? ('tight' as const)
      : ratio > 0.1
        ? ('tight' as const)
        : ratio < -0.1
          ? ('slack' as const)
          : ('achievable' as const);

  const sharePhrase =
    share === null
      ? 'No lateness bound is configured, so nothing is refused on punctuality grounds.'
      : `${(share * 100).toFixed(0)}% of buses are already past the ${maxLatenessSeconds}s lateness bound with no control at all.`;

  const note =
    band === 'tight'
      ? `${sharePhrase} The punctuality guardrail will refuse most holds for a reason that is about the schedule rather than the corridor. Fix the timetable before reading the control result.`
      : band === 'slack'
        ? `Buses arrive ${Math.round(-mean)}s EARLY against this timetable with no control at all, so it is looser than the corridor needs. Holds then look free to the punctuality guardrail and the controller will spend more of them than it should.`
        : `${sharePhrase} The guardrail is judging individual late buses rather than refusing everything.`;

  return {
    meanUncontrolledDeviationSeconds: mean,
    deviationRatio: ratio,
    shareBeyondLatenessBound: share,
    band,
    note,
  };
}

// ─── Provenance ──────────────────────────────────────────────────────────

function buildProvenance(
  corridor: CorridorInputs,
  inputs: ModelledInputs,
  spec: FleetTrialSpec,
): TrialProvenanceEntry[] {
  return [
    {
      field: 'Control laws',
      source: 'deployed',
      value: 'Terminal dispatch, two-way, self-equalizing, closed-form optimum, alighting-only',
      note: 'Imported from the same modules the live decision cycle imports them from. Not reimplementations - the selection rule and the hard safety filter are called, not restated.',
    },
    {
      field: 'Bunching detection',
      source: 'deployed',
      value: 'Reactive and predictive tiers, on the ladder predicted < warning < bunched',
      note: 'The live sweep’s own rules, replayed at the deployed 60-second cadence over each simulated day.',
    },
    {
      field: 'Corridor geometry',
      source: 'modelled',
      value: `${corridor.stops.length} stations over ${(corridor.totalDistanceMeters / 1000).toFixed(0)} km`,
      note: 'INVENTED. No seeded route-direction has this shape; the trial needed a corridor that could carry a thousand buses and none exists.',
    },
    {
      field: 'Holding points',
      source: 'configured',
      value: `${corridor.stops.filter((s) => s.isControlPoint).length} of ${corridor.stops.length} stations`,
      note: 'Every station is a control point, including the origin terminal. A bus between stations cannot be held, and the deployed eligibility check refuses to propose one to it.',
    },
    {
      field: 'Target headway H*',
      source: 'configured',
      value: `${(corridor.policy.targetHeadwaySeconds / 60).toFixed(0)} min`,
      note: 'Chosen, not measured. Every bunching threshold in the system is a ratio of this number, so it is the single most consequential input here.',
    },
    {
      field: 'Controller gains',
      source: 'configured',
      value: `Kf ${corridor.policy.kf ?? '-'}, Kb ${corridor.policy.kb ?? '-'}, k ${corridor.policy.selfEqualizingK ?? '-'}`,
      note: 'The same values the synthetic corridors in the evaluation harness carry, so a number here is comparable with one from there. The trial runs these gains; it does not tune them.',
    },
    {
      field: 'Running time between stations',
      source: 'modelled',
      value: `${inputs.cruiseSpeedKmph} km/h, ${Math.round(inputs.travelTimeVariation * 100)}% variation`,
      note: 'INVENTED. route_links is empty and there are no trip stop times, so no measured running time exists anywhere in this system.',
    },
    {
      field: 'Passenger demand',
      source: 'modelled',
      value: `${inputs.boardingRatePerMinute}/min boarding, ${Math.round(inputs.alightingFraction * 100)}% alighting, ${inputs.vehicleCapacity} seats`,
      note: 'INVENTED. No ticketing feed exists. Chosen to leave headroom below capacity, because a saturated corridor cannot respond to spacing control at all and would report "no effect" about a working controller.',
    },
    {
      field: 'Timetable',
      source: 'modelled',
      value: `free-flow running plus a nominal ${Math.round(inputs.baseDwellSeconds)}s+ dwell at every stop`,
      note:
        'INVENTED. `trips` and `trip_stop_times` are empty, so no published departure time exists anywhere ' +
        'in this system. The trial books one so the deployed punctuality guardrail has something to measure ' +
        'against - without it the lateness term contributes nothing and the max-lateness bound rejects nothing.',
    },
    {
      field: 'Maximum lateness',
      source: 'configured',
      value:
        corridor.policy.maxLatenessSeconds === null
          ? 'unbounded'
          : `${corridor.policy.maxLatenessSeconds}s`,
      note:
        'route_policies.max_lateness_seconds, enforced by the same hard safety filter the live decision cycle ' +
        'runs. Null on every real corridor. Paired across eight seeds, bounding it at 300s cut holding per bus ' +
        'from 353s to 228s on every seed and improved the excess-wait gain rather than costing it.',
    },
    {
      field: 'Occupancy',
      source: 'modelled',
      value: 'Simulated onboard count, fed to the objective in phase 2',
      note: 'INVENTED, and the only place this system has ever run its occupancy-weighted tier on a real number. vehicle_states.occupancy_count is null fleet-wide in production.',
    },
    {
      field: 'Fleet size',
      source: 'configured',
      value: `${spec.vehiclesPerPhase * 2} buses across ${spec.scenarios.length} scenarios x 2 phases`,
      note: 'Chosen to match the trial brief. Each scenario run is a continuous chain of buses one headway apart, so a disturbance propagates down the line rather than dissipating.',
    },
  ];
}

const NOT_EXERCISED = [
  'The command lifecycle. Cooldown, minimum action interval, maximum concurrent actions, driver acknowledgement and command expiry all live in the command path, which this trial deliberately does not touch. A result here is the control law’s INTENT, not the rate at which instructions would actually reach a driver.',
  'The state estimator. Production derives distance along the route by map-matching a GPS fix and filtering it, and excludes low-confidence vehicles before any headway is computed. The simulator knows its own world exactly, so that exclusion path only ever fires for the vehicles a scenario deliberately darkens.',
  'Real demand. Every passenger in this trial was invented. The boarding rate, the alighting fraction and the seat count are chosen numbers, and every figure derived from them inherits that.',
  'A REAL timetable. The trial books its own - free-flow running plus a nominal dwell - so lateness is measured and the deployed punctuality guardrail is exercised. It is measured against an invented schedule, not a published one: `trips` and `trip_stop_times` are empty everywhere in this system.',
  'Corridor dispersion. `travelTimeVariation` is invented like every other running-time input, and it is the one this headline is most sensitive to: holding demand fixed, excess-wait improvement measured 60.7% at the shipped preset\'s own value, 43.7% at roughly double it, and 14.1% at roughly 3.3x it - against 60.7-64.5% across a 3.3x swing in the invented boarding rate over the same range. The bunching result IS robust to demand; it is not robust to dispersion, and that is roughly an order of magnitude difference in sensitivity. See the `travel_time_variation` row in `policyStudies` for the re-runnable sweep behind this and `docs/FLEET_TRIAL.md` for how it was measured.',
];

/**
 * `NOT_EXERCISED` with its command-lifecycle entry REPLACED rather than
 * deleted, for a trial that modelled the command path.
 *
 * Modelling it does not make the entry go away, it changes what the entry
 * says: five limits are now in the loop, three configured columns are dead and
 * still are, and the delivery latency is still assumed. A reader who knows the
 * old sentence needs to be told which parts of it stopped being true, not to
 * find it silently missing.
 *
 * Derived from `NOT_EXERCISED` by replacing element 0, so the four entries
 * this task did not touch cannot drift between the two lists.
 */
const NOT_EXERCISED_WITH_COMMAND_PATH = [
  'The command lifecycle, PARTLY. This trial put every proposed hold through a modelled command path: the one-active-command-per-vehicle unique index, `cooldown_seconds`, the decision cycle\u2019s `max_concurrent_actions` budget, driver acknowledgement, and TTL expiry. So these numbers are what would have been DELIVERED, not only what the laws intended - read `commandLifecycle` for both side by side, `commandLifecycle.inertLimits` for the three `route_policies` columns no code in control-service/src reads, and `commandLifecycle.notModelled` for what is still outside the loop: dispatcher approval, delivery failure and redelivery, alighting-only instructions, and supersede.',
  ...NOT_EXERCISED.slice(1),
];

// ─── The command lifecycle's own report ──────────────────────────────────

/**
 * What the command path would have delivered, beside what the laws intended.
 *
 * ─── TWO NUMBERS, NEVER ONE ──────────────────────────────────────────────
 *
 * The whole point of this block is the GAP. `intendedHoldSeconds` is what the
 * control laws asked for and is the quantity every trial before this one
 * reported; `deliveredHoldSeconds` is what would have reached a driver;
 * `servedHoldSeconds` is what a driver would actually have stood for. Collapse
 * them into a single "compliance" figure and the comparison this exists to
 * expose is destroyed - which is exactly what `KpiSummary.complianceRate` did
 * on its own, reporting a corridor that serves 42% of its hold seconds as 65%
 * obedient.
 *
 * ─── AND IT IS ABSENT UNLESS ASKED FOR ───────────────────────────────────
 *
 * `FleetTrialSpec.commandLifecycle.enabled` is false by default, and then this
 * key is not on the report at all. An absent block means the command path was
 * not in the loop and every number in the report is the control law's INTENT -
 * an upper bound - which is what `notExercised` has always said in prose.
 */
export interface CommandLifecycleTrialReport {
  enabled: true;
  /** The limits the run applied, and where each value came from. Nothing here is invented. */
  policy: CommandLifecyclePolicy;
  limitProvenance: Record<keyof CommandLifecyclePolicy, LimitProvenance>;
  /** Configured limits that do nothing, and which kind of nothing. THE OPERATOR-FACING FINDING. */
  inertLimits: InertLimit[];
  /** Hold instructions the control laws proposed, over the whole trial. */
  proposals: number;
  /** Of those, how many reached a driver's screen. */
  issued: number;
  /** Instructions a driver accepted. */
  acknowledged: number;
  /** Instructions the TTL cut short of what was delivered. */
  truncatedByExpiry: number;
  intendedHoldSeconds: number;
  deliveredHoldSeconds: number;
  servedHoldSeconds: number;
  /** `deliveredHoldSeconds / intendedHoldSeconds`. What the COMMAND PATH costs. Null when nothing was proposed. */
  deliveredShareOfIntent: number | null;
  /** `servedHoldSeconds / intendedHoldSeconds`. What the path AND the drivers cost together. Null when nothing was proposed. */
  servedShareOfIntent: number | null;
  /** Instructions each limit refused. */
  blockedBy: Record<CommandBlockReason, number>;
  /** Intended hold seconds each limit refused - the same losses, priced, which is the ordering an operator should act on. */
  holdSecondsLostTo: Record<CommandBlockReason, number>;
  /** Stated rather than left to be discovered. */
  notModelled: string[];
}

function emptyBlockCounts(): Record<CommandBlockReason, number> {
  const out = {} as Record<CommandBlockReason, number>;
  for (const reason of COMMAND_BLOCK_REASONS) out[reason] = 0;
  return out;
}

/**
 * Sums the ledgers of the runs it is given into one trial-level answer.
 *
 * Sums rather than averages: an instruction is an instruction whichever
 * scenario produced it, and `vehiclesPerPhase` is split across scenarios, so a
 * mean of per-scenario rates would weight a scenario with four instructions
 * the same as one with four hundred. The same reason `poolArm` pools samples.
 *
 * ─── SCOPE: THE TWO PHASES, NOT THE STUDIES ──────────────────────────────
 *
 * Called on the two headline phases only. The policy studies and the
 * self-equalizing coverage arm run with the same command path applied - so
 * their KPIs are delivered figures too, and stay comparable with the headline
 * - but their instructions are not pooled in here, because those arms exist to
 * compare CONFIGURATIONS against each other and folding their volume into one
 * corridor-level delivered rate would describe a fleet nobody ran.
 *
 * ─── AND ONE THING THE PER-SCENARIO SPLIT UNDERSTATES ────────────────────
 *
 * `max_concurrent_actions` is a budget per CORRIDOR per cycle, and each
 * scenario runs as its own corridor with `vehiclesPerPhase / scenarios.length`
 * buses on it - six to thirteen at the sizes this trial is run at. A real
 * corridor carries its whole fleet, so the concurrency cap would bind harder
 * there than it does here. Read `blockedBy.max_concurrent_actions` as a LOWER
 * bound on that limit specifically; every other limit here is per vehicle and
 * is unaffected by the split.
 */
function commandLifecycleReport(
  runs: readonly ScenarioRun[],
  policy: CommandLifecyclePolicy,
): CommandLifecycleTrialReport {
  const blockedBy = emptyBlockCounts();
  const holdSecondsLostTo = emptyBlockCounts();
  let proposals = 0;
  let issued = 0;
  let acknowledged = 0;
  let truncatedByExpiry = 0;
  let intendedHoldSeconds = 0;
  let deliveredHoldSeconds = 0;
  let servedHoldSeconds = 0;

  for (const run of runs) {
    const ledger = run.commandLifecycle;
    if (!ledger) continue;
    proposals += ledger.proposals;
    issued += ledger.issued;
    acknowledged += ledger.acknowledged;
    truncatedByExpiry += ledger.truncatedByExpiry;
    intendedHoldSeconds += ledger.intendedHoldSeconds;
    deliveredHoldSeconds += ledger.deliveredHoldSeconds;
    servedHoldSeconds += ledger.servedHoldSeconds;
    for (const reason of COMMAND_BLOCK_REASONS) {
      blockedBy[reason] += ledger.blockedBy[reason];
      holdSecondsLostTo[reason] += ledger.holdSecondsLostTo[reason];
    }
  }

  return {
    enabled: true,
    policy,
    limitProvenance: limitProvenance(),
    inertLimits: inertLimitsFor(policy),
    proposals,
    issued,
    acknowledged,
    truncatedByExpiry,
    intendedHoldSeconds: Math.round(intendedHoldSeconds),
    deliveredHoldSeconds: Math.round(deliveredHoldSeconds),
    servedHoldSeconds: Math.round(servedHoldSeconds),
    deliveredShareOfIntent:
      intendedHoldSeconds > 0 ? deliveredHoldSeconds / intendedHoldSeconds : null,
    servedShareOfIntent: intendedHoldSeconds > 0 ? servedHoldSeconds / intendedHoldSeconds : null,
    blockedBy,
    holdSecondsLostTo,
    notModelled: COMMAND_LIFECYCLE_NOT_MODELLED,
  };
}

/**
 * What this model still does NOT do, said here rather than left for a reader
 * to find out by being wrong about it.
 */
const COMMAND_LIFECYCLE_NOT_MODELLED = [
  'Dispatcher approval. Every authorized_actions entry the trial runs on is automatic, and no human sits between the solver and the command. A real corridor whose action needs approval adds a person\u2019s reaction time to the delivery latency below, and this models that only through `deliveryLatencySeconds`, which defaults to 0.',
  'The delivery latency itself. Nothing in this system measures how long an instruction takes to reach a driver, so it is declared (`limitProvenance.deliveryLatencySeconds` = "assumed"), defaulted to 0, and swept separately rather than folded into any headline. At 0 the only limits that bite are ones with a real seeded or shipped value behind them.',
  'Webhook delivery failure and the redelivery sweep. `commandDeliverySweep` re-attempts commands resting in `authorized`; a command that never leaves that state is not modelled here, and `route_policies.retry_count` would not govern it if it were.',
  'Alighting-only instructions. `boarding_limit` is a real command and would take a slot in the same budget, but it is off on every corridor and off by default in this trial (`alightingOnlySelectable`), so gating it here would change a lever nobody has switched on. Holds only.',
  'Supersede. A newer command replacing a live one (`POST /v1/commands/:id/supersede`) is a path out of the one-active-command constraint that this models as a plain refusal, so the `conflicting_active_command` count is an upper bound on that limit specifically.',
];


// ─── Entry point ─────────────────────────────────────────────────────────

/**
 * A trial report, plus the command-lifecycle block when one was asked for.
 *
 * The extra key is declared HERE rather than on `FleetTrialReport` in
 * `types.ts` deliberately: it is optional, so an absent key leaves the wire
 * shape and every existing reader exactly as they were, and the default-off
 * report is byte-identical to one produced before this file knew about the
 * command path. Promoting it into the wire type (and its Zod mirror in the web
 * app, `src/models/fleetTrial.ts`) is what a console would need to RENDER it;
 * until then it reaches a reader through `sim:fleet --out`'s `report.json`.
 */
export type FleetTrialReportWithLifecycle = FleetTrialReport & {
  commandLifecycle?: CommandLifecycleTrialReport;
};

export function runFleetTrial(
  spec: FleetTrialSpec = DEFAULT_FLEET_TRIAL_SPEC,
  onProgress?: FleetTrialProgressReporter,
): FleetTrialReportWithLifecycle {
  const startedAt = Date.now();
  const preset = CORRIDOR_PRESETS[spec.corridorPreset];
  // The spec's own corridor wins over the preset's, so a caller can vary one
  // field (the placement study varies `holdingPointCount`) without losing the
  // shape it asked for.
  const corridorSpec = { ...preset.corridor, ...spec.corridor };
  const corridor = buildFleetCorridor(corridorSpec);
  const inputs: ModelledInputs = {
    ...DEFAULT_MODELLED_INPUTS,
    ...FLEET_TRIAL_INPUTS,
    ...preset.inputs,
    ...spec.inputs,
    seed: spec.seed,
    disturbance: 'none',
  };

  const scenarios = spec.scenarios.map(scenarioById);
  if (scenarios.length === 0) throw new Error('a fleet trial needs at least one scenario');

  // Buses are numbered once, across the whole trial, so "BUS-0731" identifies
  // exactly one simulated vehicle in one phase of one scenario and the
  // headline count is something a reader can check rather than trust.
  let nextBusNumber = 0;
  const takeVehicleIds = (count: number): string[] =>
    Array.from({ length: count }, () => `BUS-${String(++nextBusNumber).padStart(4, '0')}`);

  // ─── WHAT THIS TRIAL IS ABOUT TO DO, COUNTED BEFORE IT DOES ANY OF IT ──
  //
  // The variant lists are pure functions of the corridor spec and the inputs,
  // so every run the studies will do is knowable now. They are built HERE, once,
  // and handed to the studies below - building them twice would let the plan
  // and the work disagree, which is the one way the count can lie.
  const variants = policyVariants(corridorSpec);
  const studyVehicles = Math.min(spec.vehiclesPerPhase, MAX_STUDY_VEHICLES);
  const dispersionVariantCount = dispersionVariants(inputs.travelTimeVariation).length;
  const totalUnits = plannedUnitCount({
    phaseCount: PHASES.length,
    scenarioCount: scenarios.length,
    // In the order the `policyStudies` array below runs them.
    policyStudyVariantCounts: [
      variants.holdingPoints.length,
      variants.lateness.length,
      variants.actionBar.length,
      variants.forecastGate.length,
      dispersionVariantCount,
    ],
    studySeeds: STUDY_SEEDS,
    studyVehiclesPerPhase: studyVehicles,
    vehiclesPerPhase: spec.vehiclesPerPhase,
    // The contrast re-simulates each of the occupancy-aware phase's runs once.
    occupancyContrastRuns: eligibleScenarioCount(spec.vehiclesPerPhase, scenarios.length),
  });
  const tick = unitReporter(totalUnits, onProgress);

  // Every phase's runs are collected BEFORE any of them is pooled, because
  // which scenarios the headline may average is decided once for the trial
  // from every arm of every phase - see `headlineScopeOf`.
  const runsByPhase: ScenarioRun[][] = [];
  let awarePhaseRuns: ScenarioRun[] = [];

  for (const phase of PHASES) {
    // Split as evenly as the fleet allows, and give the remainder to the first
    // scenarios rather than dropping it: the phase must simulate exactly the
    // number of buses it claims to.
    const base = Math.floor(spec.vehiclesPerPhase / scenarios.length);
    const remainder = spec.vehiclesPerPhase - base * scenarios.length;

    const runs: ScenarioRun[] = [];
    for (const [index, scenario] of scenarios.entries()) {
      const vehicleCount = base + (index < remainder ? 1 : 0);
      if (vehicleCount < 2) {
        throw new Error(
          `fleet trial: ${spec.vehiclesPerPhase} buses across ${scenarios.length} scenarios leaves fewer than 2 per run`,
        );
      }
      // A distinct seed per (phase, scenario) so no two runs in the trial are
      // the same day, derived from the spec's seed so the whole trial re-runs.
      const seed = (spec.seed + index * 7919 + (phase.weighOccupancy ? 104_729 : 0)) >>> 0;
      // The occupancy-aware phase is the only one that gives the policy a seat
      // count. `route_policies.occupancy_capacity` is null on every real
      // corridor, so the occupancy-blind phase leaving it null is not a trial
      // convention - it is the deployed state, and it is what makes the taper
      // in mpc/actionThreshold.ts inert unless somebody deliberately turns
      // occupancy on. The capacity itself is MODELLED, like every passenger
      // number in this trial.
      const phaseCorridor = phase.weighOccupancy
        ? {
            ...corridor,
            policy: { ...corridor.policy, occupancyCapacity: inputs.vehicleCapacity },
          }
        : corridor;
      const run = runScenario({
        corridor: phaseCorridor,
        scenario,
        inputs: scaleInputs(inputs, scenario),
        vehicleIds: takeVehicleIds(vehicleCount),
        seed,
        weighOccupancy: phase.weighOccupancy,
        requiredSamples: spec.requiredSamples,
        sweepIntervalSeconds: spec.sweepIntervalSeconds,
        followerSpeedSource: spec.followerSpeedSource,
        alightingOnlySelectable: spec.alightingOnlySelectable,
        commandLifecycle: spec.commandLifecycle,
      });
      runs.push(run);
      tick('phases', `${phase.title} - ${scenario.title}`);
    }

    runsByPhase.push(runs);
    if (phase.weighOccupancy) awarePhaseRuns = runs;
  }

  const headlineScope = headlineScopeOf(runsByPhase);
  const inHeadline = new Set(headlineScope.includedScenarioIds);

  const phaseReports: PhaseReport[] = PHASES.map((phase, phaseIndex) => {
    const runs = runsByPhase[phaseIndex] ?? [];
    const headlineRuns = runs.filter((run) => inHeadline.has(run.report.id));
    const pool = (subset: readonly ScenarioRun[]) => {
      const controlledArm = poolArm(subset, corridor, (r) => r.controlledVisits, (report) => report.controlled);
      const uncontrolledArm = poolArm(subset, corridor, (r) => r.uncontrolledVisits, (report) => report.uncontrolled);
      return {
        controlled: controlledArm,
        uncontrolled: uncontrolledArm,
        contrast: contrast(controlledArm, uncontrolledArm),
      };
    };

    // The law coverage, the safety rejections and the hold breakdown stay over
    // EVERY scenario. They are counts of what the controller did and what
    // stopped it, and a saturated corridor is still a corridor the laws ran
    // on - dropping it would understate the work rather than sharpen a
    // headline. Only the pooled KPI comparison is scoped.
    return {
      id: phase.id,
      title: phase.title,
      weighOccupancy: phase.weighOccupancy,
      vehicleCount: runs.reduce((acc, r) => acc + r.report.vehicleCount, 0),
      scenarios: runs.map((r) => r.report),
      ...pool(headlineRuns),
      allScenarios: pool(runs),
      scenarioAgreement: scenarioAgreement(runs.map((r) => r.report)),
      lawCoverage: coverageOf(runs.flatMap((r) => [...r.decisions])),
      safetyRejections: safetyRejections(runs),
      ...holdBreakdown(runs, corridor),
    };
  });

  const policyStudies: PolicyStudy[] = [
    runPolicyStudy({
      spec,
      knob: 'is_control_point',
      title: 'Where the holding points should be',
      description:
        'Every station can hold a bus; which of them SHOULD is an operational choice. Spread evenly along the route, because deviation accumulates between corrections - measured, clustering the same number at the origin is about half as effective wherever holding points are scarce, which is the density the network is configured at.',
      variants: variants.holdingPoints,
      scenarios,
      inputs,
      vehiclesPerPhase: studyVehicles,
      tick,
    }),
    runPolicyStudy({
      spec,
      knob: 'max_lateness_seconds',
      title: 'How late a bus may be pushed',
      description:
        'The hard safety filter refuses a hold that would put a bus further behind its timetable than this. A tight bound protects punctuality and costs spacing - and on a high-frequency corridor it also costs seats, because uneven buses arrive to double queues they cannot fit.',
      variants: variants.lateness,
      scenarios,
      inputs,
      vehiclesPerPhase: studyVehicles,
      tick,
    }),
    runPolicyStudy({
      spec,
      knob: 'warning_threshold_ratio',
      title: 'How bunched a pair must be before anyone is instructed',
      description:
        'A mid-route law only proposes for a pair whose forward headway has fallen under this share of the target - the same bar the corridor uses to decide whether a human is told about it. Lower means fewer, larger interventions; higher means the controller acts on pairs its own alert surface would not raise.',
      variants: variants.actionBar,
      scenarios,
      inputs,
      vehiclesPerPhase: studyVehicles,
      tick,
    }),
    runPolicyStudy({
      spec,
      knob: 'forecast_action_gate',
      title: 'Acting early on the pairs predicted to come apart',
      description:
        'Whether a mid-route law may act on a pair the action bar declines, when that pair\'s own forecast says it is closing through the bar inside the horizon. Both rows run the SAME corridor and the SAME 0.6 action bar, so this measures what the forecast buys on top of the raised bar rather than re-measuring the bar. A pair with no forecast - which is most of them, the forecaster refuses on fit, sample count and window - is left exactly where the bar left it.',
      variants: variants.forecastGate,
      scenarios,
      inputs,
      vehiclesPerPhase: studyVehicles,
      tick,
    }),
    runDispersionSensitivityStudy({
      spec,
      scenarios,
      inputs,
      vehiclesPerPhase: studyVehicles,
      corridorSpec,
      tick,
    }),
  ];

  const occupancyContrast = compareOccupancySettings({
    corridor,
    runs: awarePhaseRuns,
    inputs,
    requiredSamples: spec.requiredSamples,
    followerSpeedSource: spec.followerSpeedSource,
    tick,
  });

  const occupancyBlindPhase = phaseReports.find((phase) => phase.id === 'occupancy_blind');
  const selfEqualizingCoverage = runSelfEqualizingCoverage({
    corridor,
    scenarios,
    inputs,
    spec,
    vehiclesPerPhase: studyVehicles,
    deployedSelfEqualizing: occupancyBlindPhase?.lawCoverage.find((l) => l.law === 'self_equalizing'),
    tick,
  });

  return {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    corridorPreset: { id: preset.id, title: preset.title, description: preset.description },
    alightingOnlySelectable: spec.alightingOnlySelectable,
    headlineScope,
    corridor: {
      routeDirectionId: corridor.routeDirectionId,
      routeName: corridor.routeName ?? corridor.routeDirectionId,
      totalDistanceMeters: corridor.totalDistanceMeters,
      stationCount: corridor.stops.length,
      holdingPointCount: corridor.stops.filter((s) => s.isControlPoint).length,
      targetHeadwaySeconds: corridor.policy.targetHeadwaySeconds,
      bunchedThresholdRatio: corridor.policy.bunchedThresholdRatio,
      warningThresholdRatio: corridor.policy.warningThresholdRatio,
      maxHoldSeconds: corridor.policy.maxHoldSeconds,
      kf: corridor.policy.kf,
      kb: corridor.policy.kb,
      selfEqualizingK: corridor.policy.selfEqualizingK,
      stations: corridor.stops.map((stop) => ({
        stopId: stop.stopId,
        name: stop.name,
        sequence: stop.sequence,
        cumulativeDistanceMeters: stop.cumulativeDistanceMeters,
        latitude: stop.latitude,
        longitude: stop.longitude,
      })),
    },
    controllability: assessControllability(corridor, inputs),
    scheduleFit: assessScheduleFit(phaseReports, corridor, corridor.policy.maxLatenessSeconds),
    vehiclesSimulated: nextBusNumber,
    sweepIntervalSeconds: spec.sweepIntervalSeconds,
    requiredSamples: spec.requiredSamples,
    phases: phaseReports,
    policyStudies,
    occupancyContrast,
    selfEqualizingCoverage,
    provenance: buildProvenance(corridor, inputs, spec),
    notExercised: spec.commandLifecycle.enabled ? NOT_EXERCISED_WITH_COMMAND_PATH : NOT_EXERCISED,
    // Absent when the command path was not modelled. An absent key IS the
    // statement that every number above is the control law's intent.
    ...(spec.commandLifecycle.enabled
      ? {
          commandLifecycle: commandLifecycleReport(
            runsByPhase.flat(),
            commandLifecyclePolicyFrom(corridor.policy, {
              deliveryLatencySeconds: spec.commandLifecycle.deliveryLatencySeconds,
            }),
          ),
        }
      : {}),
  };
}
