/**
 * Bus-bunching simulator — the coordinated corridor controller.
 *
 * This is deliberately *not* `if (headway < 5) hold the bus`. Holding one bus
 * changes two headways at once, so a hold that repairs A–B compresses B–C by
 * exactly the same amount. The controller therefore solves for the whole chain
 * at once:
 *
 *   1. predict where the corridor goes with no intervention (`predictedFree`);
 *   2. pick a partial correction target — only `CONTROL_GAIN` of the remaining
 *      error, so recovery takes several visible iterations;
 *   3. find the per-bus hold/pacing vector that comes closest to that target,
 *      subject to what UPSRTC can actually control, per-iteration caps, and a
 *      penalty on total intervention effort;
 *   4. verify no projected headway breaches the safety floor, scaling the plan
 *      back if it would;
 *   5. explain itself from the numbers it just produced.
 *
 * The objective is a convex quadratic in the four control values, minimised by
 * box-constrained cyclic coordinate descent — deterministic, allocation-free
 * and small enough to run every iteration without a solver dependency.
 */

import {
  CONTROL_EFFORT_WEIGHT,
  CONTROL_GAIN,
  CONTROL_QUANTUM_MINUTES,
  MAX_HOLD_MINUTES,
  MAX_PACING_MINUTES,
  MIN_SAFE_HEADWAY_MINUTES,
  SOLVER_SWEEPS,
  TARGET_HEADWAY_MINUTES,
} from './config';
import { advance, applyDeltas, clamp, formatDuration, round } from './math';
import {
  BUS_IDS,
  HEADWAY_LABELS,
  type BusControl,
  type BusDeltas,
  type BusId,
  type HeadwayVector,
  type InterventionPlan,
  type IsolatedHoldCheck,
} from './types';

/** The bus whose holding directly widens headway `index` (its follower). */
const FOLLOWER_OF_HEADWAY: readonly BusId[] = ['B', 'C', 'D'];

interface Bounds {
  lo: number;
  hi: number;
}

function boundsFor(controllable: Readonly<Record<BusId, boolean>>): Record<BusId, Bounds> {
  const bounds = {} as Record<BusId, Bounds>;
  for (const bus of BUS_IDS) {
    bounds[bus] = controllable[bus]
      ? { lo: -MAX_PACING_MINUTES, hi: MAX_HOLD_MINUTES }
      : { lo: 0, hi: 0 };
  }
  return bounds;
}

/**
 * Minimise Σ_j (D_j(u) − t_j)² + ρ Σ_i u_i² subject to lo_i ≤ u_i ≤ hi_i,
 * where D(u) = (u_B − u_A, u_C − u_B, u_D − u_C) is the headway response to the
 * control vector and `t` is the wanted change in each headway.
 *
 * Each coordinate's unconstrained minimiser has a closed form (the objective is
 * quadratic and separable once the others are fixed); clamping it to the box
 * after every update is the projection step.
 */
function solveControls(
  target: readonly [number, number, number],
  bounds: Record<BusId, Bounds>,
): BusDeltas {
  const u: Record<BusId, number> = { A: 0, B: 0, C: 0, D: 0 };
  const rho = CONTROL_EFFORT_WEIGHT;
  const [t0, t1, t2] = target;

  for (let sweep = 0; sweep < SOLVER_SWEEPS; sweep += 1) {
    // u_A appears only in D_1 = u_B − u_A.
    u.A = clamp((u.B - t0) / (1 + rho), bounds.A.lo, bounds.A.hi);
    // u_B appears in D_1 and D_2.
    u.B = clamp((u.A + u.C + t0 - t1) / (2 + rho), bounds.B.lo, bounds.B.hi);
    // u_C appears in D_2 and D_3.
    u.C = clamp((u.B + u.D + t1 - t2) / (2 + rho), bounds.C.lo, bounds.C.hi);
    // u_D appears only in D_3 = u_D − u_C.
    u.D = clamp((u.C + t2) / (1 + rho), bounds.D.lo, bounds.D.hi);
  }

  return u;
}

/** Snap to whole 15-second steps so a recommendation is actually issuable. */
function quantise(controls: BusDeltas, bounds: Record<BusId, Bounds>): BusDeltas {
  const out = {} as Record<BusId, number>;
  for (const bus of BUS_IDS) {
    const stepped =
      Math.round(controls[bus] / CONTROL_QUANTUM_MINUTES) * CONTROL_QUANTUM_MINUTES;
    out[bus] = round(clamp(stepped, bounds[bus].lo, bounds[bus].hi), 4);
  }
  return out;
}

function scaleControls(controls: BusDeltas, factor: number, bounds: Record<BusId, Bounds>): BusDeltas {
  const scaled = {} as Record<BusId, number>;
  for (const bus of BUS_IDS) scaled[bus] = controls[bus] * factor;
  return quantise(scaled, bounds);
}

/**
 * The counterfactual that motivates coordinated control (Section 13).
 *
 * Takes the single most compressed headway and asks: if we repaired *only* that
 * headway, by holding only the bus behind it, what would happen to the headway
 * behind that bus? For a real disturbance the answer is that the bunch simply
 * moves one position down the chain.
 */
export function isolatedHoldCheck(predictedFree: HeadwayVector): IsolatedHoldCheck | null {
  let worst = -1;
  let deficit = 0;
  predictedFree.forEach((headway, index) => {
    const shortfall = TARGET_HEADWAY_MINUTES - headway;
    if (shortfall > deficit) {
      deficit = shortfall;
      worst = index;
    }
  });

  if (worst < 0) return null;

  const bus = FOLLOWER_OF_HEADWAY[worst] as BusId;
  const holdMinutes = round(deficit);
  const backwardBefore = worst + 1 < predictedFree.length ? (predictedFree[worst + 1] as number) : null;
  const backwardAfter = backwardBefore === null ? null : round(backwardBefore - holdMinutes);

  return {
    bus,
    holdMinutes,
    forwardHeadwayIndex: worst,
    forwardAfter: TARGET_HEADWAY_MINUTES,
    backwardBefore,
    backwardAfter,
    breachesSafety: backwardAfter !== null && backwardAfter < MIN_SAFE_HEADWAY_MINUTES,
  };
}

/** "a 5.6-minute hold" but "an 8.8-minute hold" — the spoken form decides. */
function article(value: string): string {
  return /^(8|11|18)/.test(value) ? 'an' : 'a';
}

function describeControl(control: BusControl): string {
  if (control.kind === 'hold') return `Hold ${formatDuration(control.minutes)}`;
  if (control.kind === 'pace') return `Maintain progression, recover ${formatDuration(control.minutes)}`;
  return control.controllable ? 'Monitor' : 'No control available';
}

/** Human-readable summary of one recommendation line. */
export function controlSummary(control: BusControl): string {
  return describeControl(control);
}

function buildControlList(
  controls: BusDeltas,
  controllable: Readonly<Record<BusId, boolean>>,
): BusControl[] {
  return BUS_IDS.map((bus) => {
    const minutes = controls[bus];
    const kind = minutes > 0.01 ? 'hold' : minutes < -0.01 ? 'pace' : 'none';
    return {
      bus,
      minutes,
      kind,
      controllable: controllable[bus],
      // Only a hold at the per-cycle ceiling counts as capped: that is the case
      // where correction has to be deferred to a later iteration. A pacing
      // advisory sitting at its (deliberately small) limit is not a shortfall.
      capped: controllable[bus] && minutes >= MAX_HOLD_MINUTES - 1e-6,
    };
  });
}

/**
 * Generate the plan's explanation from the plan itself, so the prose can never
 * drift away from the arithmetic it describes.
 */
function buildReasons(options: {
  controlList: readonly BusControl[];
  predictedFree: HeadwayVector;
  predictedControlled: HeadwayVector;
  isolated: IsolatedHoldCheck | null;
  scaledForSafety: boolean;
  controllable: Readonly<Record<BusId, boolean>>;
}): string[] {
  const { controlList, predictedFree, predictedControlled, isolated, scaledForSafety, controllable } =
    options;
  const reasons: string[] = [];

  const held = controlList.filter((control) => control.kind === 'hold');
  const paced = controlList.filter((control) => control.kind === 'pace');
  const uncontrollable = BUS_IDS.filter((bus) => !controllable[bus]);

  if (isolated && isolated.backwardAfter !== null && isolated.backwardBefore !== null) {
    const forwardLabel = HEADWAY_LABELS[isolated.forwardHeadwayIndex] ?? 'the forward headway';
    const backwardLabel = HEADWAY_LABELS[isolated.forwardHeadwayIndex + 1] ?? 'the headway behind';
    const hold = isolated.holdMinutes.toFixed(1);

    if (isolated.backwardAfter <= 0) {
      reasons.push(
        `Restoring ${forwardLabel} to target on its own would need ${article(hold)} ${hold}-minute hold on Bus ${isolated.bus} against a following gap of only ${isolated.backwardBefore.toFixed(1)} minutes — ${backwardLabel} would be wiped out entirely. The gap has to be redistributed across the chain instead.`,
      );
    } else if (isolated.breachesSafety) {
      reasons.push(
        `Restoring ${forwardLabel} to target with an isolated ${hold}-minute hold on Bus ${isolated.bus} would compress ${backwardLabel} from ${isolated.backwardBefore.toFixed(1)} to ${isolated.backwardAfter.toFixed(1)} minutes — below the ${MIN_SAFE_HEADWAY_MINUTES.toFixed(1)}-minute safety floor. The correction is therefore shared along the chain instead.`,
      );
    } else {
      reasons.push(
        `An isolated ${hold}-minute hold on Bus ${isolated.bus} would repair ${forwardLabel} but pull ${backwardLabel} down to ${isolated.backwardAfter.toFixed(1)} minutes, so part of the correction is passed to the following services.`,
      );
    }
  }

  if (held.length > 1) {
    reasons.push(
      `${held
        .map((control) => `Bus ${control.bus} ${formatDuration(control.minutes)}`)
        .join(', ')} are held together so the corridor absorbs the correction evenly rather than transferring compression backwards.`,
    );
  } else if (held.length === 1) {
    const only = held[0] as BusControl;
    reasons.push(
      `A single ${formatDuration(only.minutes)} hold on Bus ${only.bus} is sufficient at this iteration; the following headways stay clear of the safety floor without further intervention.`,
    );
  }

  if (paced.length > 0) {
    reasons.push(
      `${paced
        .map((control) => `Bus ${control.bus}`)
        .join(', ')} receive${paced.length === 1 ? 's' : ''} a pacing advisory — recovering up to ${formatDuration(
        MAX_PACING_MINUTES,
      )} per cycle to take up slack ahead. No schedule or speed limit is exceeded.`,
    );
  }

  const capped = controlList.filter((control) => control.capped);
  if (capped.length > 0) {
    reasons.push(
      `${capped
        .map((control) => `Bus ${control.bus}`)
        .join(', ')} reached the ${MAX_HOLD_MINUTES}-minute per-cycle hold cap, so the remaining correction is deferred to the next iteration.`,
    );
  }

  if (uncontrollable.length > 0) {
    reasons.push(
      `Bus ${uncontrollable.join(', ')} is outside operational control in this scenario, so recovery is achieved entirely through the following services.`,
    );
  }

  if (scaledForSafety) {
    reasons.push(
      'The recommendation was scaled back after simulation because the full correction would have driven a projected headway below the safety floor.',
    );
  }

  if (held.length === 0 && paced.length === 0) {
    reasons.push(
      `Projected headways ${predictedFree.map((value) => value.toFixed(1)).join(' / ')} remain within tolerance without intervention — the controller holds no bus and continues monitoring.`,
    );
  } else {
    reasons.push(
      `Projected corridor after intervention: ${predictedControlled
        .map((value) => value.toFixed(1))
        .join(' / ')} minutes against a ${TARGET_HEADWAY_MINUTES.toFixed(1)}-minute target.`,
    );
  }

  return reasons;
}

/**
 * Plan one iteration of coordinated headway recovery.
 *
 * @param headways   current corridor state
 * @param natural    disturbance + feedback minutes expected this iteration
 * @param controllable which buses UPSRTC can influence in this scenario
 */
export function planIntervention(
  headways: HeadwayVector,
  natural: BusDeltas,
  controllable: Readonly<Record<BusId, boolean>>,
): InterventionPlan {
  const bounds = boundsFor(controllable);

  // 1. Where the corridor goes on its own.
  const predictedFree = advance(headways, natural).headways;

  // 2. Partial correction target, measured from the *current* state so the
  //    controller also cancels the disturbance rather than merely damping it.
  const aim = headways.map((headway) =>
    round(headway + CONTROL_GAIN * (TARGET_HEADWAY_MINUTES - headway)),
  ) as unknown as HeadwayVector;

  const target: [number, number, number] = [
    round(aim[0] - predictedFree[0]),
    round(aim[1] - predictedFree[1]),
    round(aim[2] - predictedFree[2]),
  ];

  // 3. Closest feasible control vector.
  let controls = quantise(solveControls(target, bounds), bounds);
  let predictedControlled = advance(headways, natural, controls).headways;

  // 4. Safety verification (Section 36). If the plan would push any projected
  //    headway below the floor, shrink it until it does not — the bunch must
  //    never simply be relocated one position down the chain.
  let scaledForSafety = false;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const breaches = predictedControlled.some(
      (value, index) =>
        value < MIN_SAFE_HEADWAY_MINUTES && value < (predictedFree[index] as number) - 1e-6,
    );
    if (!breaches) break;
    scaledForSafety = true;
    controls = scaleControls(controls, 0.7, bounds);
    predictedControlled = advance(headways, natural, controls).headways;
  }

  const controlList = buildControlList(controls, controllable);
  const isolated = isolatedHoldCheck(predictedFree);

  const totalHoldMinutes = round(
    controlList.reduce((sum, control) => sum + Math.max(0, control.minutes), 0),
  );

  return {
    aim,
    predictedFree,
    predictedControlled,
    controls,
    controlList,
    totalHoldMinutes,
    isolated,
    safetyFloorRespected: predictedControlled.every(
      (value, index) =>
        value >= MIN_SAFE_HEADWAY_MINUTES || value >= (predictedFree[index] as number) - 1e-6,
    ),
    scaledForSafety,
    reasons: buildReasons({
      controlList,
      predictedFree,
      predictedControlled,
      isolated,
      scaledForSafety,
      controllable,
    }),
  };
}

/**
 * Re-derive the headway change attributable to control alone. Used by the
 * calculation drawer so the algebra it prints is computed, not transcribed.
 */
export function controlContribution(
  headways: HeadwayVector,
  controls: BusDeltas,
): HeadwayVector {
  return applyDeltas(headways, controls);
}
