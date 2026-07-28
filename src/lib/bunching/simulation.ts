/**
 * Bus-bunching simulator — run construction.
 *
 * `buildSimulation` resolves a scenario into two fully-computed iteration
 * sequences, one per control policy. Both start from the same state and receive
 * the same disturbance at the same iteration; the only difference is that the
 * controlled run also applies the vector returned by `planIntervention`.
 *
 * The whole run is precomputed and pure — playback is nothing more than an index
 * into these arrays, so scrubbing, stepping backwards and replaying are all
 * exact, and nothing depends on wall-clock time.
 */

import {
  INCIDENT_ESCALATION_ITERATIONS,
  LEAD_START_PROGRESS,
  OCCUPANCY_DELAY_SLOPE,
  OCCUPANCY_HEADWAY_SLOPE,
  PHASES_WITHOUT_AI,
  PHASES_WITH_AI,
  ROUTE_NOMINAL_DURATION_MINUTES,
  SIM_MINUTES_PER_ITERATION,
  STALLED_DELAY_THRESHOLD_MINUTES,
  STATUS_THRESHOLDS,
  TARGET_HEADWAY_MINUTES,
} from './config';
import { planIntervention } from './controller';
import {
  ZERO_DELTAS,
  addDeltas,
  advance,
  calculateMetrics,
  clamp,
  classifyStatus,
  feedbackDeltas,
  iterationsUntilBunched,
  meanAbsoluteError,
  projectFree,
  recoveryProgress,
  round,
  trendOf,
} from './math';
import { disturbanceAt } from './scenarios';
import {
  BUS_IDS,
  HEADWAY_LABELS,
  type BunchingStatus,
  type BusDeltas,
  type BusId,
  type BusProgress,
  type HeadwayVector,
  type IncidentState,
  type ObservationInsight,
  type Policy,
  type PolicyRun,
  type ScenarioDefinition,
  type SimulationIteration,
  type SimulationRun,
  type TerminalDispatch,
} from './types';

/**
 * Bus positions along the route, derived from the headway state (Section 21).
 *
 * The lead bus advances with simulated time, minus whatever time the scenario's
 * exogenous disturbance has taken from it — which is why a stationary bus
 * visibly stalls on the map. Every following bus is placed by converting the
 * headway in front of it into a fraction of the corridor's nominal running time,
 * so marker spacing is always a direct picture of the headway vector.
 */
export function busProgress(
  headways: HeadwayVector,
  simMinutes: number,
  leadDelayMinutes: number,
): BusProgress {
  const lead = clamp(
    LEAD_START_PROGRESS + (simMinutes - leadDelayMinutes) / ROUTE_NOMINAL_DURATION_MINUTES,
    0,
    1,
  );
  const b = lead - headways[0] / ROUTE_NOMINAL_DURATION_MINUTES;
  const c = b - headways[1] / ROUTE_NOMINAL_DURATION_MINUTES;
  const d = c - headways[2] / ROUTE_NOMINAL_DURATION_MINUTES;

  return {
    A: round(lead, 5),
    B: round(clamp(b, 0, 1), 5),
    C: round(clamp(c, 0, 1), 5),
    D: round(clamp(d, 0, 1), 5),
  };
}

/** Passenger load per bus, driven by the headway ahead of it. */
function occupancyFor(
  scenario: ScenarioDefinition,
  headways: HeadwayVector,
  leadDelayMinutes: number,
): Readonly<Record<BusId, number>> | null {
  const base = scenario.occupancyBase;
  if (!base) return null;

  const headwayAhead: Record<BusId, number | null> = {
    A: null,
    B: headways[0],
    C: headways[1],
    D: headways[2],
  };

  const out = {} as Record<BusId, number>;
  for (const bus of BUS_IDS) {
    const ahead = headwayAhead[bus];
    const value =
      ahead === null
        ? base[bus] + OCCUPANCY_DELAY_SLOPE * leadDelayMinutes
        : base[bus] + OCCUPANCY_HEADWAY_SLOPE * (ahead - TARGET_HEADWAY_MINUTES);
    out[bus] = Math.round(clamp(value, 5, 99));
  }
  return out;
}

/** Consecutive iterations, ending at `index`, in which the anchor bus stalled. */
function stalledIterations(scenario: ScenarioDefinition, index: number): number {
  const anchor = scenario.incident.anchorBus;
  if (!anchor) return 0;

  let count = 0;
  for (let step = index; step >= 0; step -= 1) {
    if (disturbanceAt(scenario, step)[anchor] >= STALLED_DELAY_THRESHOLD_MINUTES) count += 1;
    else break;
  }
  return count;
}

function incidentStateFor(scenario: ScenarioDefinition, index: number): IncidentState {
  const stalled = stalledIterations(scenario, index);
  const active = index <= scenario.incident.activeUntilIteration;

  return {
    kind: scenario.incident.kind,
    label: scenario.incident.mapLabel,
    anchorBus: scenario.incident.anchorBus,
    anchorStopIndex: scenario.incident.anchorStopIndex,
    active,
    cleared: !active,
    escalated:
      scenario.incident.kind === 'stationary' && stalled >= INCIDENT_ESCALATION_ITERATIONS,
    stalledIterations: stalled,
  };
}

function phaseFor(policy: Policy, index: number): string {
  const phases = policy === 'withAI' ? PHASES_WITH_AI : PHASES_WITHOUT_AI;
  return phases[Math.min(index, phases.length - 1)] as string;
}

/** "10:10" plus signed minutes → "10:13:45" (seconds omitted when whole). */
export function addMinutesToClock(time: string, minutes: number): string {
  const [hoursPart, minutesPart] = time.split(':');
  const baseSeconds = Number(hoursPart ?? 0) * 3600 + Number(minutesPart ?? 0) * 60;
  const total = Math.max(0, Math.round(baseSeconds + minutes * 60));
  const hh = Math.floor(total / 3600) % 24;
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const stamp = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  return ss === 0 ? stamp : `${stamp}:${String(ss).padStart(2, '0')}`;
}

/**
 * Terminal release times for the late-departure scenario.
 *
 * The lead bus's lateness is *derived*: the timetable asks for a 10-minute gap
 * between consecutive departures, and the corridor starts with H_AB instead, so
 * A left `10 − H_AB` minutes late. Under timetable priority every following bus
 * departs on schedule; under headway recovery each is offset by its recommended
 * hold.
 */
function terminalDispatch(
  scenario: ScenarioDefinition,
  controls: BusDeltas,
): readonly TerminalDispatch[] | null {
  const schedule = scenario.terminalSchedule;
  if (!schedule) return null;

  const leadLateness = round(TARGET_HEADWAY_MINUTES - scenario.initialHeadways[0]);

  return BUS_IDS.map((bus) => {
    const offset = bus === 'A' ? leadLateness : controls[bus];
    return {
      bus,
      scheduled: schedule[bus],
      actual: addMinutesToClock(schedule[bus], offset),
      offsetMinutes: round(offset),
    };
  });
}

function observationFor(options: {
  headways: HeadwayVector;
  previous: HeadwayVector | null;
  natural: BusDeltas;
  status: BunchingStatus;
}): ObservationInsight {
  const { headways, previous, natural, status } = options;

  const predictedFree = advance(headways, natural).headways;

  let worstIndex = 0;
  headways.forEach((value, index) => {
    if (value < (headways[worstIndex] as number)) worstIndex = index;
  });

  const worstNow = headways[worstIndex] as number;
  const worstNext = predictedFree[worstIndex] as number;
  const closingRatePerIteration = round(worstNow - worstNext);

  const alreadyBunched = Math.min(...headways) <= STATUS_THRESHOLDS.bunchedMinHeadway;
  const iterationsToBunching = alreadyBunched ? 0 : iterationsUntilBunched(headways, natural);

  const trends = [0, 1, 2].map((index) =>
    trendOf(headways[index] as number, previous ? (previous[index] as number) : null),
  ) as unknown as ObservationInsight['trends'];

  const worstLabel = HEADWAY_LABELS[worstIndex] as string;
  const headline =
    closingRatePerIteration > 0.05
      ? `${worstLabel} closing at ${closingRatePerIteration.toFixed(2)} min per cycle`
      : alreadyBunched
        ? `${worstLabel} collapsed — services running together`
        : `${worstLabel} holding at ${worstNow.toFixed(1)} min`;

  const result =
    status === 'bunched'
      ? 'Cluster established; a service gap is growing behind it'
      : status === 'bunching-risk'
        ? 'Instability propagating through the corridor'
        : 'Deviation persisting with no corrective action';

  return {
    trends,
    worstIndex,
    closingRatePerIteration,
    iterationsToBunching,
    predictedFree,
    headline,
    result,
  };
}

function buildPolicyRun(scenario: ScenarioDefinition, policy: Policy): PolicyRun {
  const controlled = policy === 'withAI';
  const initialMae = meanAbsoluteError(scenario.initialHeadways);

  const iterations: SimulationIteration[] = [];
  let headways: HeadwayVector = scenario.initialHeadways;
  let previousHeadways: HeadwayVector | null = null;
  let previousMae: number | null = null;
  let clampedIntoState = false;
  let leadDelayMinutes = 0;

  for (let index = 0; index < scenario.iterations; index += 1) {
    const isLast = index === scenario.iterations - 1;
    const simMinutes = index * SIM_MINUTES_PER_ITERATION;

    // Identical disturbance on both sides — this is what makes the comparison
    // a controlled experiment rather than two unrelated animations.
    const exogenous = disturbanceAt(scenario, index);
    const natural = addDeltas(exogenous, feedbackDeltas(headways));

    const plan = controlled ? planIntervention(headways, natural, scenario.controllable) : null;
    const controls = plan ? plan.controls : ZERO_DELTAS;

    const transition = advance(headways, natural, controls);
    const metrics = calculateMetrics(headways);
    const status = classifyStatus({ headways, mae: metrics.mae, previousMae, controlled });

    iterations.push({
      index,
      simMinutes,
      headways,
      metrics,
      status,
      phase: phaseFor(policy, index),
      natural,
      controls,
      predictedFree: plan ? plan.predictedFree : advance(headways, natural).headways,
      nextHeadways: isLast ? null : transition.headways,
      clampApplied: clampedIntoState,
      progress: busProgress(headways, simMinutes, leadDelayMinutes),
      occupancy: occupancyFor(scenario, headways, leadDelayMinutes),
      plan,
      observation: controlled ? null : observationFor({ headways, previous: previousHeadways, natural, status }),
      recoveryProgress: controlled ? recoveryProgress(initialMae, metrics.mae) : null,
      incident: incidentStateFor(scenario, index),
      dispatch: index === 0 ? terminalDispatch(scenario, controls) : null,
    });

    previousHeadways = headways;
    previousMae = metrics.mae;
    headways = transition.headways;
    clampedIntoState = transition.clamped;
    // Only the exogenous part delays the lead bus; the feedback term is zero for
    // A by construction (it has no modelled bus in front of it).
    leadDelayMinutes = round(leadDelayMinutes + exogenous.A);
  }

  return { policy, iterations };
}

/** Resolve a scenario into both comparison runs. Pure and deterministic. */
export function buildSimulation(scenario: ScenarioDefinition): SimulationRun {
  return {
    scenarioId: scenario.id,
    withoutAI: buildPolicyRun(scenario, 'withoutAI'),
    withAI: buildPolicyRun(scenario, 'withAI'),
  };
}

/** Multi-step forward projection for the predictive read-out (Section 24). */
export function forwardProjection(
  headways: HeadwayVector,
  natural: BusDeltas,
  steps: readonly number[],
): readonly { steps: number; headways: HeadwayVector }[] {
  return steps.map((count) => ({ steps: count, headways: projectFree(headways, natural, count) }));
}
