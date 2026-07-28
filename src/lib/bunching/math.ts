/**
 * Bus-bunching simulator — the calculation engine.
 *
 * Every number the page displays comes from a function in this module. The UI
 * never computes a metric of its own, so a headway vector and a metrics panel
 * can never disagree.
 */

import {
  FEEDBACK_MAX_DELTA_MINUTES,
  HEADWAY_FEEDBACK_GAIN,
  MIN_PHYSICAL_HEADWAY_MINUTES,
  STATUS_THRESHOLDS,
  TARGET_HEADWAY_MINUTES,
} from './config';
import {
  BUS_IDS,
  type BunchingStatus,
  type BusDeltas,
  type BusId,
  type HeadwayMetrics,
  type HeadwayTrend,
  type HeadwayVector,
} from './types';

/** Round to `decimals` places, avoiding accumulated floating-point drift. */
export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const ZERO_DELTAS: BusDeltas = { A: 0, B: 0, C: 0, D: 0 };

export function addDeltas(...parts: readonly BusDeltas[]): BusDeltas {
  const total: Record<BusId, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const part of parts) {
    for (const bus of BUS_IDS) total[bus] = round(total[bus] + part[bus], 4);
  }
  return total;
}

// ── Headway update ─────────────────────────────────────────────────────────

/**
 * The control equations (Section 14). A per-bus time perturbation `u` changes
 * two headways at once — the one in front of the bus and the one behind it:
 *
 *     H'_AB = H_AB + u_B − u_A
 *     H'_BC = H_BC + u_C − u_B
 *     H'_CD = H_CD + u_D − u_C
 *
 * This coupling is the entire reason a corridor cannot be regulated one bus at
 * a time, and both the natural dynamics and the controller go through it.
 */
export function applyDeltas(headways: HeadwayVector, deltas: BusDeltas): HeadwayVector {
  return [
    round(headways[0] + deltas.B - deltas.A),
    round(headways[1] + deltas.C - deltas.B),
    round(headways[2] + deltas.D - deltas.C),
  ];
}

/**
 * Dwell-time feedback: the mechanism that turns a single disturbance into a
 * self-amplifying bunch.
 *
 * Each following bus gains or loses time in proportion to how far the headway
 * *ahead of it* sits from target — a large gap ahead means more accumulated
 * passengers and a longer dwell, a small gap means fewer passengers and a
 * faster run. The lead bus has no modelled bus ahead of it, so its only
 * perturbation is the scenario's exogenous disturbance.
 */
export function feedbackDeltas(headways: HeadwayVector, gain = HEADWAY_FEEDBACK_GAIN): BusDeltas {
  const term = (headway: number): number =>
    round(
      clamp(
        gain * (headway - TARGET_HEADWAY_MINUTES),
        -FEEDBACK_MAX_DELTA_MINUTES,
        FEEDBACK_MAX_DELTA_MINUTES,
      ),
      4,
    );

  return { A: 0, B: term(headways[0]), C: term(headways[1]), D: term(headways[2]) };
}

/**
 * Advance the corridor one iteration under a given set of perturbations.
 * `natural` is the disturbance plus feedback; `controls` is the intervention.
 *
 * The chain is walked from the front because buses cannot overtake each other.
 * If a following bus would gain more time than the gap in front of it allows, it
 * is physically blocked behind its leader: the time it *actually* gains is
 * reduced to the available gap, and that reduced figure — not the one it wanted —
 * is what propagates into the headway behind it. This is why a bunch, once
 * formed, freezes in place instead of inverting, and why the gap behind a bunch
 * stops growing rather than widening for ever.
 *
 * `effective` reports the per-bus minutes that were actually realised, which is
 * what the calculation drawer shows when the floor has bitten.
 */
export function advance(
  headways: HeadwayVector,
  natural: BusDeltas,
  controls: BusDeltas = ZERO_DELTAS,
): { headways: HeadwayVector; clamped: boolean; effective: BusDeltas } {
  const effective: Record<BusId, number> = { ...addDeltas(natural, controls) };
  const next: number[] = [];
  let clamped = false;

  for (let index = 0; index < 3; index += 1) {
    const leader = BUS_IDS[index] as BusId;
    const follower = BUS_IDS[index + 1] as BusId;
    let value = (headways[index] as number) + effective[follower] - effective[leader];

    if (value < MIN_PHYSICAL_HEADWAY_MINUTES) {
      effective[follower] = round(effective[follower] + (MIN_PHYSICAL_HEADWAY_MINUTES - value), 4);
      value = MIN_PHYSICAL_HEADWAY_MINUTES;
      clamped = true;
    }

    next.push(round(value));
  }

  return { headways: next as unknown as HeadwayVector, clamped, effective };
}

// ── Metrics ────────────────────────────────────────────────────────────────

export function meanHeadway(headways: HeadwayVector): number {
  return round((headways[0] + headways[1] + headways[2]) / 3, 4);
}

/** Mean absolute headway error against the target (Section 15). */
export function meanAbsoluteError(
  headways: HeadwayVector,
  target = TARGET_HEADWAY_MINUTES,
): number {
  const total =
    Math.abs(headways[0] - target) +
    Math.abs(headways[1] - target) +
    Math.abs(headways[2] - target);
  return round(total / 3, 4);
}

/**
 * Demo regularity score (Section 16): 100% when every headway sits on target,
 * falling linearly with mean absolute error. Not an official UPSRTC KPI.
 */
export function headwayRegularity(
  headways: HeadwayVector,
  target = TARGET_HEADWAY_MINUTES,
): number {
  return round(Math.max(0, 100 * (1 - meanAbsoluteError(headways, target) / target)), 2);
}

/** Population variance of the headways — a direct measure of spacing evenness. */
export function headwayVariance(headways: HeadwayVector): number {
  const mean = meanHeadway(headways);
  const total =
    (headways[0] - mean) ** 2 + (headways[1] - mean) ** 2 + (headways[2] - mean) ** 2;
  return round(total / 3, 4);
}

/**
 * Random-arrival passenger waiting proxy (Section 18): Σh² / 2Σh.
 *
 * With even headways this reduces to h/2; irregular spacing pushes it up
 * because most passengers arrive during the long gaps.
 */
export function passengerWaitProxy(headways: HeadwayVector): number {
  const sum = headways[0] + headways[1] + headways[2];
  if (sum <= 0) return 0;
  const squares = headways[0] ** 2 + headways[1] ** 2 + headways[2] ** 2;
  return round(squares / (2 * sum), 4);
}

export function calculateMetrics(
  headways: HeadwayVector,
  target = TARGET_HEADWAY_MINUTES,
): HeadwayMetrics {
  return {
    headways,
    mean: meanHeadway(headways),
    mae: meanAbsoluteError(headways, target),
    regularity: headwayRegularity(headways, target),
    variance: headwayVariance(headways),
    waitProxy: passengerWaitProxy(headways),
    minHeadway: Math.min(headways[0], headways[1], headways[2]),
    maxHeadway: Math.max(headways[0], headways[1], headways[2]),
  };
}

/**
 * Recovery progress (Section 19): how much of the initial disturbance's headway
 * error has been removed. Progress towards stable target headway — not a
 * transport KPI.
 */
export function recoveryProgress(initialMae: number, currentMae: number): number {
  if (initialMae <= 0) return 100;
  return round(clamp((100 * (initialMae - currentMae)) / initialMae, 0, 100), 2);
}

// ── Status ─────────────────────────────────────────────────────────────────

/**
 * Corridor status from the demo thresholds in `config.ts`. Driven primarily by
 * the minimum headway, with `recovering` reserved for a controlled corridor
 * whose error is actively falling but has not yet reached stability.
 */
export function classifyStatus(options: {
  headways: HeadwayVector;
  mae: number;
  previousMae: number | null;
  controlled: boolean;
}): BunchingStatus {
  const { headways, mae, previousMae, controlled } = options;
  const minHeadway = Math.min(headways[0], headways[1], headways[2]);

  if (mae <= STATUS_THRESHOLDS.stableMae && minHeadway >= STATUS_THRESHOLDS.stableMinHeadway) {
    return 'stable';
  }

  const improving =
    previousMae !== null && previousMae - mae >= STATUS_THRESHOLDS.recoveringMaeDelta;
  if (controlled && improving) return 'recovering';

  if (minHeadway <= STATUS_THRESHOLDS.bunchedMinHeadway) return 'bunched';
  if (minHeadway <= STATUS_THRESHOLDS.riskMinHeadway) return 'bunching-risk';
  return 'watch';
}

export function trendOf(current: number, previous: number | null): HeadwayTrend {
  if (previous === null) return 'flat';
  const delta = Math.abs(current - TARGET_HEADWAY_MINUTES) - Math.abs(previous - TARGET_HEADWAY_MINUTES);
  if (delta <= -0.05) return 'improving';
  if (delta >= 0.05) return 'deteriorating';
  return 'flat';
}

/**
 * Free-run the feedback model forward to find how many iterations remain before
 * the corridor would be classified bunched. Used by the uncontrolled side's
 * observation card, so its warning is a projection rather than a caption.
 */
export function iterationsUntilBunched(
  headways: HeadwayVector,
  natural: BusDeltas,
  horizon = 12,
): number | null {
  let state = headways;
  for (let step = 1; step <= horizon; step += 1) {
    // The exogenous part of the disturbance is not assumed to persist; the
    // feedback term is recomputed from the projected state each step.
    const deltas = addDeltas(step === 1 ? natural : ZERO_DELTAS, feedbackDeltas(state));
    state = advance(state, deltas).headways;
    if (Math.min(state[0], state[1], state[2]) <= STATUS_THRESHOLDS.bunchedMinHeadway) {
      return step;
    }
  }
  return null;
}

/** Project the corridor forward `steps` iterations with no intervention. */
export function projectFree(
  headways: HeadwayVector,
  natural: BusDeltas,
  steps: number,
): HeadwayVector {
  let state = headways;
  for (let step = 0; step < steps; step += 1) {
    const deltas = addDeltas(step === 0 ? natural : ZERO_DELTAS, feedbackDeltas(state));
    state = advance(state, deltas).headways;
  }
  return state;
}

// ── Formatting helpers ─────────────────────────────────────────────────────

/** "9.7" — headways and metrics are shown to one decimal place. */
export function formatMinutes(value: number, decimals = 1): string {
  return value.toFixed(decimals);
}

/** "02:00" — hold durations read as operational instructions, not decimals. */
export function formatDuration(minutes: number): string {
  const total = Math.round(Math.abs(minutes) * 60);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** "T+10:00" — the simulated elapsed-time clock (Section 41). */
export function formatSimClock(minutes: number): string {
  return `T+${String(Math.floor(minutes)).padStart(2, '0')}:${String(
    Math.round((minutes % 1) * 60),
  ).padStart(2, '0')}`;
}

/** "[6.0, 10.0, 10.0]" — used by the calculation drawer. */
export function formatVector(headways: HeadwayVector, decimals = 1): string {
  return `[${headways.map((value) => value.toFixed(decimals)).join(', ')}]`;
}

/** Add a leading sign so "+1.5" and "−0.8" read unambiguously. */
export function formatSigned(value: number, decimals = 2): string {
  if (Math.abs(value) < 0.005) return '0';
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(decimals)}`;
}
