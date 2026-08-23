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
import type { CorridorInputs } from '../rehearsal/corridor.js';
import type { ModelledInputs } from '../rehearsal/run.js';
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
   * trade - it simulates the outcome. Turned on and measured, the action LOSES:
   * across eight seeds on the urban corridor it made total passenger time worse
   * on seven of them, and in the `slow_bus` scenario it cost 9% of all
   * passenger time on every seed. The people left behind wait about ten times
   * the law's own estimate, because the follower arrives with its own load,
   * cannot fit a double queue, and the overflow rolls forward.
   *
   * So the deployed caution is correct and this stays off. It is kept as a
   * switch because that conclusion is a measurement, and a measurement has to
   * be re-runnable.
   */
  alightingOnlySelectable: boolean;
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
    scheduledArrivalSeconds: buildTimetable(corridor, inputs, plan.dispatches),
    seed,
  };
}

/**
 * The timetable the trial books its buses against.
 *
 * ─── WHY THE TRIAL HAS TO INVENT ONE ─────────────────────────────────────
 *
 * The deployed system prices punctuality and bounds it - `mpc/objective.ts`
 * charges for the lateness a hold ADDS, and `mpc/safety.ts` refuses a hold that
 * would push a bus past `route_policies.max_lateness_seconds`. Both are inert on
 * the live network, because `trips` and `trip_stop_times` are empty and every
 * schedule deviation is therefore null. A trial that supplied no timetable
 * either would be measuring a controller with its punctuality guardrail
 * switched off - which is what this one was doing, and it showed: single buses
 * accumulated over an hour of hold across a trip, because nothing anywhere
 * asked how late they already were.
 *
 * ─── HOW IT IS BOOKED ────────────────────────────────────────────────────
 *
 * Free-flow running time plus a nominal dwell at every intermediate stop. The
 * nominal dwell uses the demand a stop sees in steady state - one target
 * headway's worth of boardings, and the same number alighting, which is what
 * balance requires - so the schedule is achievable rather than aspirational. A
 * timetable no bus can keep would report every vehicle late from the first
 * stop and make the lateness term a constant.
 *
 * MODELLED, like everything else about the traffic here, and reported as such.
 */
function buildTimetable(
  corridor: CorridorInputs,
  inputs: ModelledInputs,
  dispatches: readonly TerminalDispatchPlan[],
): Record<string, number[]> {
  const metersPerSecond = inputs.cruiseSpeedKmph / 3.6;
  const expectedBoardings = (inputs.boardingRatePerMinute * corridor.policy.targetHeadwaySeconds) / 60;
  const nominalDwellSeconds =
    inputs.baseDwellSeconds +
    inputs.secondsPerBoarding * expectedBoardings +
    inputs.secondsPerAlighting * expectedBoardings;

  // Cumulative booked offset from departure, per stop index.
  const offsets: number[] = [];
  let elapsed = 0;
  for (const [index, stop] of corridor.stops.entries()) {
    const previous = index > 0 ? (corridor.stops[index - 1]?.cumulativeDistanceMeters ?? 0) : 0;
    const linkMeters = Math.max(0, stop.cumulativeDistanceMeters - previous);
    elapsed += metersPerSecond > 0 ? linkMeters / metersPerSecond : 0;
    offsets.push(elapsed);
    // The dwell at THIS stop is served before the next link, so it lands in
    // every later stop's booked time and in none of the earlier ones.
    elapsed += nominalDwellSeconds;
  }

  const timetable: Record<string, number[]> = {};
  for (const dispatch of dispatches) {
    timetable[dispatch.vehicleId] = offsets.map(
      (offset) => dispatch.scheduledDispatchSeconds + offset,
    );
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
  const totalBoardings = reported.reduce((acc, v) => acc + v.boardings, 0);

  return {
    headwaySampleCount: dispersion.sampleCount,
    meanHeadwaySeconds: dispersion.meanHeadwaySeconds,
    ewtSeconds: dispersion.ewtSeconds,
    headwayCv: dispersion.cv,
    bunchingRate:
      samples.length > 0 ? samples.filter((h) => h < bunchThreshold).length / samples.length : 0,
    deniedBoardings,
    totalBoardings,
    saturated: isSaturated(deniedBoardings, totalBoardings),
  };
}

/** Offered passengers = those who boarded plus those refused. A fifth refused is the line `evaluation/report.ts` draws. */
export const SATURATION_DENIED_SHARE = 0.2;

function isSaturated(deniedBoardings: number, totalBoardings: number): boolean {
  const offered = deniedBoardings + totalBoardings;
  return offered > 0 && deniedBoardings / offered > SATURATION_DENIED_SHARE;
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
 * A visit with no `leaderHeadwaySeconds` is the FIRST bus to reach that station
 * in the run: nobody there had been waiting for a predecessor, so there is no
 * gap to halve and its boardings are excluded from the waiting total rather
 * than charged an invented wait. It is excluded identically on both arms, so
 * the contrast is unaffected.
 */
function passengerOutcome(visits: readonly StopVisitRecord[]): PassengerOutcome {
  let waitPassengerSeconds = 0;
  let onboardDelayPassengerSeconds = 0;
  let boardings = 0;
  let deniedBoardings = 0;

  for (const visit of visits) {
    if (!isReported(visit.vehicleId)) continue;
    if (visit.leaderHeadwaySeconds !== null) {
      waitPassengerSeconds += visit.boardings * (visit.leaderHeadwaySeconds / 2);
    }
    onboardDelayPassengerSeconds += visit.appliedHoldSeconds * visit.onboardAfter;
    boardings += visit.boardings;
    deniedBoardings += visit.deniedBoardings;
  }

  return {
    boardings,
    deniedBoardings,
    waitPassengerSeconds: Math.round(waitPassengerSeconds),
    onboardDelayPassengerSeconds: Math.round(onboardDelayPassengerSeconds),
    totalPassengerSeconds: Math.round(waitPassengerSeconds + onboardDelayPassengerSeconds),
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
    if (!visit.compliant) entry.refused += visit.intendedHoldSeconds;
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

function punctualityKpis(journeys: readonly JourneyRecord[]): PunctualityKpis {
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

function summarizeIncidents(incidents: readonly DetectedIncident[]): IncidentSummary {
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

  const waitSecondsSaved =
    uncontrolled.passengers.waitPassengerSeconds - controlled.passengers.waitPassengerSeconds;
  const passengerSecondsSaved =
    uncontrolled.passengers.totalPassengerSeconds - controlled.passengers.totalPassengerSeconds;

  return {
    waitSecondsSaved,
    onboardDelayImposed: controlled.passengers.onboardDelayPassengerSeconds,
    passengerSecondsSaved,
    passengerSecondsSavedPercent:
      uncontrolled.passengers.totalPassengerSeconds > 0
        ? (passengerSecondsSaved / uncontrolled.passengers.totalPassengerSeconds) * 100
        : null,
    ewtImprovementSeconds: improvement(uncontrolled.spacing.ewtSeconds, controlled.spacing.ewtSeconds),
    ewtImprovementPercent: percent(uncontrolled.spacing.ewtSeconds, controlled.spacing.ewtSeconds),
    cvImprovementPercent: percent(uncontrolled.spacing.headwayCv, controlled.spacing.headwayCv),
    bunchingRateImprovementPercent: percent(
      uncontrolled.spacing.bunchingRate,
      controlled.spacing.bunchingRate,
    ),
    incidentsAvoided: uncontrolled.incidents.detected - controlled.incidents.detected,
    addedJourneySecondsPerVehicle: addedJourney,
    additionalDeniedBoardings:
      controlled.spacing.deniedBoardings - uncontrolled.spacing.deniedBoardings,
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

interface ScenarioRun {
  report: ScenarioReport;
  controlledVisits: StopVisitRecord[];
  uncontrolledVisits: StopVisitRecord[];
  decisions: readonly RehearsalDecisionRecord[];
  config: ScenarioConfig;
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
  } = args;
  const config = buildTrialScenario({ corridor, scenario, inputs, vehicleIds, seed });
  const finalStopIndex = corridor.stops.length - 1;
  const excludeVehicleIds = new Set([WARMUP_VEHICLE_ID]);

  const uncontrolled = simulate(config, noControlController);
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
    // Left at the deployed switch. The closed-form optimum is the argmin of
    // the very quantity candidates are ranked by, so letting it compete would
    // REPLACE the tuned controller rather than add to it - and a trial that
    // silently flipped it would be measuring a different system.
  });
  const controlled = simulate(config, controller);

  const decisions = controller.decisions.filter((d) => isReported(d.vehicleId));

  const detectedControlled = detectIncidents({
    corridor,
    visits: controlled.visits,
    dispatches: config.dispatches,
    disturbances: config.disturbances,
    requiredSamples,
    decisions,
    sweepIntervalSeconds,
    excludeVehicleIds,
  });
  const detectedUncontrolled = detectIncidents({
    corridor,
    visits: uncontrolled.visits,
    dispatches: config.dispatches,
    disturbances: config.disturbances,
    requiredSamples,
    sweepIntervalSeconds,
    excludeVehicleIds,
  });

  const controlledArm: ArmReport = {
    spacing: spacingKpis(controlled.visits, corridor),
    punctuality: punctualityKpis(
      journeysOf(controlled.visits, config.dispatches, finalStopIndex, config.scheduledArrivalSeconds),
    ),
    passengers: passengerOutcome(controlled.visits),
    incidents: summarizeIncidents(detectedControlled.incidents),
  };
  const uncontrolledArm: ArmReport = {
    spacing: spacingKpis(uncontrolled.visits, corridor),
    punctuality: punctualityKpis(
      journeysOf(uncontrolled.visits, config.dispatches, finalStopIndex, config.scheduledArrivalSeconds),
    ),
    passengers: passengerOutcome(uncontrolled.visits),
    incidents: summarizeIncidents(detectedUncontrolled.incidents),
  };

  const trajectoryVehicleIds = pickTrajectoryVehicles(config.dispatches);
  const horizonSeconds = Math.max(
    ...controlled.visits.map((v) => v.departureSeconds),
    ...uncontrolled.visits.map((v) => v.departureSeconds),
    0,
  );

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
    config,
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
  let totalBoardings = 0;
  const pooledPassengers: PassengerOutcome = {
    boardings: 0,
    deniedBoardings: 0,
    waitPassengerSeconds: 0,
    onboardDelayPassengerSeconds: 0,
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
    pooledPassengers.totalPassengerSeconds += outcome.totalPassengerSeconds;
    for (const visit of visits) {
      if (!isReported(visit.vehicleId)) continue;
      deniedBoardings += visit.deniedBoardings;
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
      totalBoardings,
      saturated: isSaturated(deniedBoardings, totalBoardings),
    },
    punctuality: punctualityKpis(journeys),
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
  const medians: number[] = [];

  for (const summary of summaries) {
    detected += summary.detected;
    resolved += summary.resolved;
    closedPairGone += summary.closedPairGone;
    unresolvedAtEnd += summary.unresolvedAtEnd;
    escalatedFromPrediction += summary.escalatedFromPrediction;
    withIntervention += summary.withIntervention;
    totalHoldSecondsServed += summary.totalHoldSecondsServed;
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
  };
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
}): OccupancyContrast {
  const { corridor, runs, inputs, followerSpeedSource } = args;

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

    const blindByKey = new Map<string, DecisionShape>();
    for (const decision of blindController.decisions) {
      if (!isReported(decision.vehicleId)) continue;
      blindByKey.set(`${decision.vehicleId}|${decision.stopId}`, shapeOf(decision));
      // More than one SELECTABLE candidate is what a ranking needs to bite on.
      // `cost_optimal_hold` is generated on nearly every decision but is not
      // selectable, so counting it here would report a ranking that cannot
      // actually happen.
      const selectable = decision.candidates.filter((c) => c.actionType !== 'cost_optimal_hold');
      if (selectable.length > 1) rankingComparable = true;
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

// ─── What each policy knob is worth, on THIS corridor ────────────────────

/** One variant of the corridor, and the label it is reported under. */
interface PolicyVariant {
  label: string;
  corridor: FleetCorridorSpec;
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
}): PolicyStudy {
  const { spec, knob, title, description, variants, scenarios, inputs, vehiclesPerPhase } = args;

  const rows: PolicyStudyRow[] = [];
  for (const variant of variants) {
    const corridor = buildFleetCorridor(variant.corridor);
    const perSeed: {
      net: number | null;
      ewt: number | null;
      hold: number;
      worst: number;
      holds: number;
      denied: number;
      detected: number;
      resolved: number;
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
            inputs: { ...inputs, ...scenario.inputs },
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
          }),
        );
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
        denied: controlled.passengers.deniedBoardings,
        detected: controlled.incidents.detected,
        resolved: controlled.incidents.resolved,
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
  const recommended = [...affordable].sort(
    (a, b) =>
      (b.passengerSecondsSavedPercent ?? 0) - (a.passengerSecondsSavedPercent ?? 0) ||
      (b.ewtImprovementPercent ?? 0) - (a.ewtImprovementPercent ?? 0),
  )[0];
  const current = rows.find((row) => row.isCurrent);

  let verdict: string;
  if (rows.length < 2) {
    verdict = 'Only one setting was tried, so there is nothing to compare.';
  } else if (recommended && current && recommended.label !== current.label) {
    verdict =
      `${recommended.label} beats the configured ${current.label}: ` +
      `${(recommended.ewtImprovementPercent ?? 0).toFixed(0)}% excess-wait improvement against ` +
      `${(current.ewtImprovementPercent ?? 0).toFixed(0)}%, and ` +
      `${(recommended.passengerSecondsSavedPercent ?? 0).toFixed(1)}% of total passenger time saved against ` +
      `${(current.passengerSecondsSavedPercent ?? 0).toFixed(1)}%.`;
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

/** The placements and lateness bounds worth trying on this corridor. */
function policyVariants(corridorSpec: FleetCorridorSpec): {
  holdingPoints: PolicyVariant[];
  lateness: PolicyVariant[];
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

  return {
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
];

// ─── Entry point ─────────────────────────────────────────────────────────

export function runFleetTrial(
  spec: FleetTrialSpec = DEFAULT_FLEET_TRIAL_SPEC,
  onProgress?: (done: number, total: number, label: string) => void,
): FleetTrialReport {
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

  const totalRuns = PHASES.length * scenarios.length;
  let done = 0;

  const phaseReports: PhaseReport[] = [];
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
        inputs: { ...inputs, ...scenario.inputs },
        vehicleIds: takeVehicleIds(vehicleCount),
        seed,
        weighOccupancy: phase.weighOccupancy,
        requiredSamples: spec.requiredSamples,
        sweepIntervalSeconds: spec.sweepIntervalSeconds,
        followerSpeedSource: spec.followerSpeedSource,
        alightingOnlySelectable: spec.alightingOnlySelectable,
      });
      runs.push(run);
      done++;
      onProgress?.(done, totalRuns, `${phase.id}/${scenario.id}`);
    }

    const controlledArm = poolArm(runs, corridor, (r) => r.controlledVisits, (report) => report.controlled);
    const uncontrolledArm = poolArm(runs, corridor, (r) => r.uncontrolledVisits, (report) => report.uncontrolled);
    const holds = holdBreakdown(runs, corridor);

    phaseReports.push({
      id: phase.id,
      title: phase.title,
      weighOccupancy: phase.weighOccupancy,
      vehicleCount: runs.reduce((acc, r) => acc + r.report.vehicleCount, 0),
      scenarios: runs.map((r) => r.report),
      controlled: controlledArm,
      uncontrolled: uncontrolledArm,
      contrast: contrast(controlledArm, uncontrolledArm),
      lawCoverage: coverageOf(runs.flatMap((r) => [...r.decisions])),
      ...holds,
    });

    if (phase.weighOccupancy) awarePhaseRuns = runs;
  }

  const variants = policyVariants(corridorSpec);
  const studyVehicles = Math.min(spec.vehiclesPerPhase, MAX_STUDY_VEHICLES);
  const policyStudies: PolicyStudy[] = [
    runPolicyStudy({
      spec,
      knob: 'is_control_point',
      title: 'Where the holding points should be',
      description:
        'Every station can hold a bus; which of them SHOULD is an operational choice, counted from the origin so a correction has the rest of the route to propagate through.',
      variants: variants.holdingPoints,
      scenarios,
      inputs,
      vehiclesPerPhase: studyVehicles,
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
    }),
  ];

  const occupancyContrast = compareOccupancySettings({
    corridor,
    runs: awarePhaseRuns,
    inputs,
    requiredSamples: spec.requiredSamples,
    followerSpeedSource: spec.followerSpeedSource,
  });

  return {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    corridorPreset: { id: preset.id, title: preset.title, description: preset.description },
    alightingOnlySelectable: spec.alightingOnlySelectable,
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
    vehiclesSimulated: nextBusNumber,
    sweepIntervalSeconds: spec.sweepIntervalSeconds,
    requiredSamples: spec.requiredSamples,
    phases: phaseReports,
    policyStudies,
    occupancyContrast,
    provenance: buildProvenance(corridor, inputs, spec),
    notExercised: NOT_EXERCISED,
  };
}
