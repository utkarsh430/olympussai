import { describe, it, expect } from 'vitest';
import {
  MAX_HOLD_MINUTES,
  MIN_PHYSICAL_HEADWAY_MINUTES,
  MIN_SAFE_HEADWAY_MINUTES,
  CONTROL_QUANTUM_MINUTES,
  TARGET_HEADWAY_MINUTES,
} from '@/lib/bunching/config';
import {
  addDeltas,
  advance,
  applyDeltas,
  calculateMetrics,
  classifyStatus,
  feedbackDeltas,
  formatDuration,
  formatSimClock,
  headwayRegularity,
  headwayVariance,
  iterationsUntilBunched,
  meanAbsoluteError,
  meanHeadway,
  passengerWaitProxy,
  projectFree,
  recoveryProgress,
} from '@/lib/bunching/math';
import { isolatedHoldCheck, planIntervention } from '@/lib/bunching/controller';
import { SCENARIOS, disturbanceAt, getScenario } from '@/lib/bunching/scenarios';
import { buildSimulation, addMinutesToClock, busProgress } from '@/lib/bunching/simulation';
import {
  buildRouteGeometry,
  fractionOfPoint,
  pointAtFraction,
} from '@/lib/bunching/routeInterpolation';
import { SIMULATION_ROUTE_GEOMETRY, SIMULATION_ROUTE_STOPS } from '@/lib/bunching/route';
import { BUS_IDS, type BusId, type HeadwayVector } from '@/lib/bunching/types';

const ALL_CONTROLLABLE = { A: true, B: true, C: true, D: true } as const;
const LEAD_UNCONTROLLABLE = { A: false, B: true, C: true, D: true } as const;
const NO_DELTAS = { A: 0, B: 0, C: 0, D: 0 } as const;

describe('headway metrics', () => {
  it('computes the mean of the headway vector', () => {
    expect(meanHeadway([9, 9, 10])).toBeCloseTo(9.3333, 4);
    expect(meanHeadway([10, 10, 10])).toBe(10);
  });

  it('computes mean absolute headway error against the target', () => {
    // (|9-10| + |9-10| + |10-10|) / 3
    expect(meanAbsoluteError([9, 9, 10])).toBeCloseTo(0.6667, 4);
    // (|7-10| + |8-10| + |13-10|) / 3 = 8/3
    expect(meanAbsoluteError([7, 8, 13])).toBeCloseTo(2.6667, 4);
    expect(meanAbsoluteError([10, 10, 10])).toBe(0);
  });

  it('computes the demo regularity score from that error', () => {
    // 100 × (1 − 0.6667/10)
    expect(headwayRegularity([9, 9, 10])).toBeCloseTo(93.33, 2);
    // 100 × (1 − 2.6667/10)
    expect(headwayRegularity([7, 8, 13])).toBeCloseTo(73.33, 2);
    expect(headwayRegularity([10, 10, 10])).toBe(100);
  });

  it('never reports a negative regularity score', () => {
    expect(headwayRegularity([0.4, 0.4, 40])).toBe(0);
  });

  it('computes headway variance, zero for perfectly even spacing', () => {
    expect(headwayVariance([10, 10, 10])).toBe(0);
    // mean 9.3333; deviations 0.3333, 0.3333, 0.6667
    expect(headwayVariance([9, 9, 10])).toBeCloseTo(0.2222, 4);
    expect(headwayVariance([2, 2, 24])).toBeGreaterThan(100);
  });

  it('computes the passenger wait proxy as sum of squares over twice the total', () => {
    // (4 + 4 + 576) / (2 × 28) = 584 / 56
    expect(passengerWaitProxy([2, 2, 24])).toBeCloseTo(10.4286, 4);
    // Even spacing reduces to half the headway.
    expect(passengerWaitProxy([10, 10, 10])).toBeCloseTo(5, 4);
    expect(passengerWaitProxy([0, 0, 0])).toBe(0);
  });

  it('shows irregular spacing as a worse wait than even spacing of the same total', () => {
    expect(passengerWaitProxy([2, 2, 24])).toBeGreaterThan(passengerWaitProxy([9.33, 9.33, 9.34]));
  });

  it('bundles every metric consistently', () => {
    const metrics = calculateMetrics([7, 8, 13]);
    expect(metrics.mae).toBeCloseTo(2.6667, 4);
    expect(metrics.regularity).toBeCloseTo(73.33, 2);
    expect(metrics.minHeadway).toBe(7);
    expect(metrics.maxHeadway).toBe(13);
    expect(metrics.waitProxy).toBeCloseTo(passengerWaitProxy([7, 8, 13]), 6);
  });

  it('computes recovery progress from the initial error', () => {
    expect(recoveryProgress(10, 10)).toBe(0);
    expect(recoveryProgress(10, 0)).toBe(100);
    expect(recoveryProgress(10, 2.5)).toBe(75);
    // Clamped at both ends — a corridor that got worse is not "negatively recovered".
    expect(recoveryProgress(2, 5)).toBe(0);
    expect(recoveryProgress(0, 0)).toBe(100);
  });
});

describe('control equations', () => {
  it('applies an intervention to the two headways it touches', () => {
    // Section 14: holding B by 2 and C by 3 from [7, 8, 13].
    //   AB = 7 + 2       = 9
    //   BC = 8 − 2 + 3   = 9
    //   CD = 13 − 3      = 10
    expect(applyDeltas([7, 8, 13], { A: 0, B: 2, C: 3, D: 0 })).toEqual([9, 9, 10]);
  });

  it('shows that an isolated hold moves the problem down the chain', () => {
    // Holding B alone by 3 repairs A–B but compresses B–C by the same 3 minutes.
    const before: HeadwayVector = [7, 10, 10];
    const after = applyDeltas(before, { A: 0, B: 3, C: 0, D: 0 });
    expect(after[0]).toBe(10);
    expect(after[1]).toBe(7);
    expect(after[0] - before[0]).toBe(-(after[1] - before[1]));
  });

  it('leaves the corridor unchanged when every bus is delayed equally', () => {
    expect(applyDeltas([10, 10, 10], { A: 2, B: 2, C: 2, D: 2 })).toEqual([10, 10, 10]);
  });

  it('sums delta sets component-wise', () => {
    expect(addDeltas({ A: 1, B: 2, C: 3, D: 4 }, { A: 0.5, B: -1, C: 0, D: 0 })).toEqual({
      A: 1.5,
      B: 1,
      C: 3,
      D: 4,
    });
  });
});

describe('dwell-time feedback', () => {
  it('makes a bus with a small gap ahead gain time and a large gap lose time', () => {
    const deltas = feedbackDeltas([6, 14, 10]);
    expect(deltas.A).toBe(0);
    expect(deltas.B).toBeLessThan(0); // small gap ahead → runs light and closes
    expect(deltas.C).toBeGreaterThan(0); // large gap ahead → crowded and slow
    expect(deltas.D).toBe(0); // on target
  });

  it('caps the feedback term so it stays operationally plausible', () => {
    const extreme = feedbackDeltas([0.4, 40, 10]);
    for (const bus of BUS_IDS) {
      expect(Math.abs(extreme[bus])).toBeLessThanOrEqual(0.8 + 1e-9);
    }
  });

  it('amplifies a disturbance without any intervention', () => {
    let state: HeadwayVector = [6, 10, 10];
    const first = state[0];
    for (let step = 0; step < 4; step += 1) {
      state = advance(state, feedbackDeltas(state)).headways;
    }
    expect(state[0]).toBeLessThan(first); // A–B keeps closing
    expect(state[1]).toBeGreaterThan(10); // and a gap opens behind B
    expect(meanAbsoluteError(state)).toBeGreaterThan(meanAbsoluteError([6, 10, 10]));
  });
});

describe('overtaking floor', () => {
  it('never lets a headway fall below the physical minimum', () => {
    const result = advance([1, 10, 10], { A: 5, B: 0, C: 0, D: 0 });
    expect(result.headways[0]).toBe(MIN_PHYSICAL_HEADWAY_MINUTES);
    expect(result.clamped).toBe(true);
  });

  it('carries the time a blocked bus could not gain into the headway behind it', () => {
    // B wants to gain 2 minutes but only 0.6 of gap is available: the remaining
    // 1.4 minutes are not gained at all, so B–C does not grow by the full 2.
    const result = advance([1, 10, 10], NO_DELTAS, { A: 0, B: -2, C: 0, D: 0 });
    expect(result.headways[0]).toBe(MIN_PHYSICAL_HEADWAY_MINUTES);
    expect(result.effective.B).toBeCloseTo(-0.6, 6);
    expect(result.headways[1]).toBeCloseTo(10.6, 6);
  });

  it('reports no clamping in normal operation', () => {
    expect(advance([10, 10, 10], NO_DELTAS).clamped).toBe(false);
  });
});

describe('status classification', () => {
  const status = (headways: HeadwayVector, previousMae: number | null, controlled: boolean) =>
    classifyStatus({
      headways,
      mae: meanAbsoluteError(headways),
      previousMae,
      controlled,
    });

  it('calls an on-target corridor stable', () => {
    expect(status([10, 10, 10], null, false)).toBe('stable');
    expect(status([9.5, 9.8, 9.9], null, true)).toBe('stable');
  });

  it('calls a collapsed headway bunched', () => {
    expect(status([1, 15, 9], null, false)).toBe('bunched');
    expect(status([2, 2, 24], null, false)).toBe('bunched');
  });

  it('flags an approaching bunch before it forms', () => {
    expect(status([5, 11, 10], null, false)).toBe('bunching-risk');
  });

  it('reports recovering only while controlled error is falling', () => {
    expect(status([7.4, 9.8, 9.8], 1.33, true)).toBe('recovering');
    // Same state, but uncontrolled: recovery is not claimed.
    expect(status([7.4, 9.8, 9.8], 1.33, false)).not.toBe('recovering');
    // Controlled but not improving.
    expect(status([7.4, 9.8, 9.8], 1.0, true)).not.toBe('recovering');
  });

  it('uses watch for moderate deviation that is not closing on a bunch', () => {
    expect(status([7.5, 10, 10], null, false)).toBe('watch');
  });
});

describe('projection helpers', () => {
  it('projects the corridor forward without intervention', () => {
    const two = projectFree([7, 10, 10], feedbackDeltas([7, 10, 10]), 2);
    expect(two[0]).toBeLessThan(7);
    expect(projectFree([10, 10, 10], NO_DELTAS, 3)).toEqual([10, 10, 10]);
  });

  it('counts the iterations remaining before the corridor bunches', () => {
    const iterations = iterationsUntilBunched([6, 10, 10], feedbackDeltas([6, 10, 10]));
    expect(iterations).not.toBeNull();
    expect(iterations as number).toBeGreaterThan(0);
    // A corridor already on target never bunches within the horizon.
    expect(iterationsUntilBunched([10, 10, 10], NO_DELTAS)).toBeNull();
  });
});

describe('coordinated controller', () => {
  it('never recommends an action for a bus outside operational control', () => {
    const plan = planIntervention([6, 10, 10], { A: 0.8, B: -0.8, C: 0, D: 0 }, LEAD_UNCONTROLLABLE);
    expect(plan.controls.A).toBe(0);
  });

  it('spreads the correction across the chain rather than holding one bus', () => {
    const plan = planIntervention([6, 10, 10], { A: 0.8, B: -0.8, C: 0, D: 0 }, LEAD_UNCONTROLLABLE);
    const acting = plan.controlList.filter((control) => control.kind !== 'none');
    expect(acting.length).toBeGreaterThan(1);
    expect(plan.controls.B).toBeGreaterThan(0);
    expect(plan.controls.C).toBeGreaterThan(0);
  });

  it('checks the backward headway: no projected headway is driven below the safety floor', () => {
    for (const scenario of SCENARIOS) {
      let state = scenario.initialHeadways;
      for (let index = 0; index < scenario.iterations; index += 1) {
        const natural = addDeltas(disturbanceAt(scenario, index), feedbackDeltas(state));
        const plan = planIntervention(state, natural, scenario.controllable);

        plan.predictedControlled.forEach((value, headwayIndex) => {
          const free = plan.predictedFree[headwayIndex] as number;
          // Control may not make a headway worse than doing nothing would, and
          // may not push one under the floor that was clear of it.
          expect(value >= MIN_SAFE_HEADWAY_MINUTES || value >= free - 1e-6).toBe(true);
        });

        state = advance(state, natural, plan.controls).headways;
      }
    }
  });

  it('respects the per-cycle hold cap and the pacing bound', () => {
    const plan = planIntervention([2, 2, 24], NO_DELTAS, ALL_CONTROLLABLE);
    for (const bus of BUS_IDS) {
      expect(plan.controls[bus]).toBeLessThanOrEqual(MAX_HOLD_MINUTES + 1e-9);
      expect(plan.controls[bus]).toBeGreaterThanOrEqual(-1 - 1e-9);
    }
  });

  it('quantises recommendations to issuable 15-second steps', () => {
    const plan = planIntervention([3, 10, 10], NO_DELTAS, LEAD_UNCONTROLLABLE);
    for (const bus of BUS_IDS) {
      const steps = plan.controls[bus] / CONTROL_QUANTUM_MINUTES;
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
    }
  });

  it('projects exactly what applying its own recommendation produces', () => {
    const natural = { A: 0.8, B: -0.8, C: 0, D: 0 };
    const plan = planIntervention([6, 10, 10], natural, LEAD_UNCONTROLLABLE);
    expect(advance([6, 10, 10], natural, plan.controls).headways).toEqual(plan.predictedControlled);
    expect(advance([6, 10, 10], natural).headways).toEqual(plan.predictedFree);
  });

  it('aims at a partial correction so recovery takes several iterations', () => {
    const plan = planIntervention([6, 10, 10], NO_DELTAS, LEAD_UNCONTROLLABLE);
    // The aim is between the current state and the target, never at the target.
    expect(plan.aim[0]).toBeGreaterThan(6);
    expect(plan.aim[0]).toBeLessThan(TARGET_HEADWAY_MINUTES);
    expect(plan.predictedControlled[0]).toBeLessThan(TARGET_HEADWAY_MINUTES);
  });

  it('explains itself with reasons derived from the plan', () => {
    const plan = planIntervention([3, 10, 10], NO_DELTAS, LEAD_UNCONTROLLABLE);
    expect(plan.reasons.length).toBeGreaterThan(0);
    expect(plan.reasons.join(' ')).toContain('Bus');
  });

  it('identifies the isolated hold that would relocate the bunch', () => {
    const check = isolatedHoldCheck([2.2, 10.8, 10]);
    expect(check).not.toBeNull();
    const isolated = check as NonNullable<typeof check>;
    expect(isolated.bus).toBe('B');
    expect(isolated.holdMinutes).toBeCloseTo(7.8, 6);
    expect(isolated.backwardAfter).toBeCloseTo(3, 6);
    expect(isolated.breachesSafety).toBe(true);
  });

  it('finds nothing to correct when the corridor is on target', () => {
    expect(isolatedHoldCheck([10, 10, 10])).toBeNull();
    const plan = planIntervention([10, 10, 10], NO_DELTAS, ALL_CONTROLLABLE);
    expect(plan.totalHoldMinutes).toBe(0);
  });
});

describe('route interpolation', () => {
  const square = buildRouteGeometry([
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 1 },
    { latitude: 0, longitude: 2 },
  ]);

  it('requires at least two points', () => {
    expect(() => buildRouteGeometry([{ latitude: 0, longitude: 0 }])).toThrow();
  });

  it('anchors the ends of the path', () => {
    expect(pointAtFraction(square, 0).longitude).toBeCloseTo(0, 6);
    expect(pointAtFraction(square, 1).longitude).toBeCloseTo(2, 6);
  });

  it('clamps fractions outside the path', () => {
    expect(pointAtFraction(square, -3).longitude).toBeCloseTo(0, 6);
    expect(pointAtFraction(square, 4).longitude).toBeCloseTo(2, 6);
  });

  it('interpolates by cumulative distance, not by point index', () => {
    // Two equal-length segments, so halfway along the route is the middle point.
    expect(pointAtFraction(square, 0.5).longitude).toBeCloseTo(1, 4);
  });

  it('places positions by distance on an unevenly sampled path', () => {
    // A long first leg then a very short one: the midpoint by distance must fall
    // inside the long leg, which index-based interpolation would get wrong.
    const uneven = buildRouteGeometry([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 10 },
      { latitude: 0, longitude: 10.2 },
    ]);
    expect(pointAtFraction(uneven, 0.5).longitude).toBeGreaterThan(4);
    expect(pointAtFraction(uneven, 0.5).longitude).toBeLessThan(6);
  });

  it('reports a bearing along the direction of travel', () => {
    expect(pointAtFraction(square, 0.25).bearingDegrees).toBeCloseTo(90, 0);
  });

  it('gives monotonically increasing fractions for the real corridor stops', () => {
    const fractions = SIMULATION_ROUTE_STOPS.map((_, index) =>
      fractionOfPoint(SIMULATION_ROUTE_GEOMETRY, index),
    );
    expect(fractions[0]).toBe(0);
    expect(fractions[fractions.length - 1]).toBeCloseTo(1, 6);
    for (let index = 1; index < fractions.length; index += 1) {
      expect(fractions[index] as number).toBeGreaterThan(fractions[index - 1] as number);
    }
  });
});

describe('bus positions', () => {
  it('spaces buses by the headways in front of them', () => {
    const progress = busProgress([10, 10, 10], 0, 0);
    expect(progress.A).toBeGreaterThan(progress.B);
    expect(progress.B).toBeGreaterThan(progress.C);
    expect(progress.C).toBeGreaterThan(progress.D);
    // Equal headways produce equal spacing on the route. Progress is quantised
    // to five decimals, so compare at four — a rounding step on this corridor is
    // a few centimetres.
    expect(progress.A - progress.B).toBeCloseTo(progress.B - progress.C, 4);
  });

  it('places bunched buses closer together than evenly spaced ones', () => {
    const bunched = busProgress([2, 2, 24], 0, 0);
    const even = busProgress([10, 10, 10], 0, 0);
    expect(bunched.A - bunched.C).toBeLessThan(even.A - even.C);
  });

  it('advances the lead bus with simulated time', () => {
    expect(busProgress([10, 10, 10], 10, 0).A).toBeGreaterThan(busProgress([10, 10, 10], 0, 0).A);
  });

  it('stalls the lead bus while it is losing time to a disturbance', () => {
    const running = busProgress([10, 10, 10], 5, 0).A;
    const stalled = busProgress([10, 10, 10], 5, 5).A;
    expect(stalled).toBeLessThan(running);
  });
});

describe('formatting', () => {
  it('renders hold durations as operational instructions', () => {
    expect(formatDuration(2)).toBe('02:00');
    expect(formatDuration(1.5)).toBe('01:30');
    expect(formatDuration(0.25)).toBe('00:15');
    expect(formatDuration(-1.75)).toBe('01:45');
  });

  it('renders the simulated clock', () => {
    expect(formatSimClock(0)).toBe('T+00:00');
    expect(formatSimClock(25)).toBe('T+25:00');
  });

  it('offsets a terminal departure time by signed minutes', () => {
    expect(addMinutesToClock('10:10', 0)).toBe('10:10');
    expect(addMinutesToClock('10:10', 5)).toBe('10:15');
    expect(addMinutesToClock('10:10', 3.75)).toBe('10:13:45');
  });
});

describe('scenario catalogue', () => {
  it('offers six scenarios with unique ids and 4–6 iterations each', () => {
    expect(SCENARIOS).toHaveLength(6);
    expect(new Set(SCENARIOS.map((scenario) => scenario.id)).size).toBe(6);
    for (const scenario of SCENARIOS) {
      expect(scenario.iterations).toBeGreaterThanOrEqual(4);
      expect(scenario.iterations).toBeLessThanOrEqual(6);
    }
  });

  it('resolves scenarios by id and rejects unknown ones', () => {
    expect(getScenario('multi-bus-bunch').initialHeadways).toEqual([2, 2, 24]);
    // @ts-expect-error — deliberately probing the runtime guard.
    expect(() => getScenario('does-not-exist')).toThrow();
  });

  it('has no scenario that relies on traffic-signal control', () => {
    const text = JSON.stringify(SCENARIOS).toLowerCase();
    for (const forbidden of ['traffic signal', 'traffic light', 'green wave', 'signal priority']) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe('simulation runs', () => {
  it('starts both policies from the identical disturbed state', () => {
    for (const scenario of SCENARIOS) {
      const run = buildSimulation(scenario);
      const without = run.withoutAI.iterations[0];
      const with_ = run.withAI.iterations[0];
      expect(without?.headways).toEqual(scenario.initialHeadways);
      expect(with_?.headways).toEqual(scenario.initialHeadways);
      expect(without?.natural).toEqual(with_?.natural);
      expect(without?.simMinutes).toBe(with_?.simMinutes);
    }
  });

  it('keeps both policies on the same simulated clock', () => {
    for (const scenario of SCENARIOS) {
      const run = buildSimulation(scenario);
      expect(run.withoutAI.iterations).toHaveLength(scenario.iterations);
      expect(run.withAI.iterations).toHaveLength(scenario.iterations);
      run.withoutAI.iterations.forEach((iteration, index) => {
        expect(iteration.simMinutes).toBe(run.withAI.iterations[index]?.simMinutes);
      });
    }
  });

  it('is deterministic — the same scenario always produces the same run', () => {
    const first = buildSimulation(getScenario('traffic-shock'));
    const second = buildSimulation(getScenario('traffic-shock'));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('applies no control at all on the uncontrolled side', () => {
    for (const scenario of SCENARIOS) {
      for (const iteration of buildSimulation(scenario).withoutAI.iterations) {
        for (const bus of BUS_IDS) expect(iteration.controls[bus]).toBe(0);
        expect(iteration.plan).toBeNull();
        expect(iteration.recoveryProgress).toBeNull();
        expect(iteration.observation).not.toBeNull();
      }
    }
  });

  it('deteriorates without control and recovers with it, in every scenario', () => {
    for (const scenario of SCENARIOS) {
      const run = buildSimulation(scenario);
      const withoutFirst = run.withoutAI.iterations[0]?.metrics.mae as number;
      const withoutLast = run.withoutAI.iterations[scenario.iterations - 1]?.metrics.mae as number;
      const withLast = run.withAI.iterations[scenario.iterations - 1] as NonNullable<
        (typeof run.withAI.iterations)[number]
      >;

      expect(withoutLast).toBeGreaterThan(withoutFirst);
      expect(withLast.metrics.mae).toBeLessThan(withoutLast);
      expect(withLast.status).toBe('stable');
      expect(withLast.metrics.regularity).toBeGreaterThan(90);
      expect(withLast.metrics.minHeadway).toBeGreaterThan(MIN_SAFE_HEADWAY_MINUTES);
      expect(withLast.recoveryProgress as number).toBeGreaterThan(60);
    }
  });

  it('does not solve bunching in a single step', () => {
    for (const scenario of SCENARIOS) {
      const run = buildSimulation(scenario);
      const second = run.withAI.iterations[1] as NonNullable<
        (typeof run.withAI.iterations)[number]
      >;
      // One iteration in, the corridor has improved but is not yet restored.
      expect(second.metrics.mae).toBeGreaterThan(0.05);
      const iterationsToStable = run.withAI.iterations.findIndex(
        (iteration) => iteration.status === 'stable',
      );
      expect(iterationsToStable).toBeGreaterThan(1);
    }
  });

  it('reduces the passenger wait proxy relative to no control', () => {
    for (const scenario of SCENARIOS) {
      const run = buildSimulation(scenario);
      const last = scenario.iterations - 1;
      expect(run.withAI.iterations[last]?.metrics.waitProxy as number).toBeLessThan(
        run.withoutAI.iterations[last]?.metrics.waitProxy as number,
      );
    }
  });

  it('redistributes the 24-minute gap across the chain in the multi-bus bunch', () => {
    const run = buildSimulation(getScenario('multi-bus-bunch'));
    const last = run.withAI.iterations[run.withAI.iterations.length - 1] as NonNullable<
      (typeof run.withAI.iterations)[number]
    >;
    const uncontrolled = run.withoutAI.iterations[
      run.withoutAI.iterations.length - 1
    ] as NonNullable<(typeof run.withoutAI.iterations)[number]>;

    // Controlled: the gap shrinks towards target and the cluster opens up.
    expect(last.headways[2]).toBeLessThan(12);
    expect(last.headways[0]).toBeGreaterThan(9);
    expect(last.headways[1]).toBeGreaterThan(9);
    // Uncontrolled: the cluster tightens and the desert grows.
    expect(uncontrolled.headways[2]).toBeGreaterThan(24);
    expect(uncontrolled.metrics.minHeadway).toBeLessThan(2);
  });

  it('keeps the disturbance identical on both sides at every iteration', () => {
    for (const scenario of SCENARIOS) {
      const run = buildSimulation(scenario);
      run.withoutAI.iterations.forEach((iteration, index) => {
        const exogenous = disturbanceAt(scenario, index);
        const counterpart = run.withAI.iterations[index];
        for (const bus of BUS_IDS) {
          // The feedback part differs because the states differ; the exogenous
          // disturbance must not.
          expect(iteration.natural[bus] - feedbackDeltas(iteration.headways)[bus]).toBeCloseTo(
            exogenous[bus],
            6,
          );
          expect(
            (counterpart?.natural[bus] as number) -
              feedbackDeltas(counterpart?.headways as HeadwayVector)[bus],
          ).toBeCloseTo(exogenous[bus], 6);
        }
      });
    }
  });

  it('derives every iteration metric from its own headway vector', () => {
    for (const scenario of SCENARIOS) {
      const run = buildSimulation(scenario);
      for (const policy of ['withoutAI', 'withAI'] as const) {
        for (const iteration of run[policy].iterations) {
          expect(iteration.metrics).toEqual(calculateMetrics(iteration.headways));
        }
      }
    }
  });

  it('links each iteration to the next by the applied deltas', () => {
    for (const scenario of SCENARIOS) {
      const run = buildSimulation(scenario);
      for (const policy of ['withoutAI', 'withAI'] as const) {
        const iterations = run[policy].iterations;
        iterations.forEach((iteration, index) => {
          const expected = advance(iteration.headways, iteration.natural, iteration.controls);
          if (index === iterations.length - 1) {
            expect(iteration.nextHeadways).toBeNull();
          } else {
            expect(iteration.nextHeadways).toEqual(expected.headways);
            expect(iterations[index + 1]?.headways).toEqual(expected.headways);
          }
        });
      }
    }
  });

  it('clears the temporary stoppage while the bunching it caused persists', () => {
    const run = buildSimulation(getScenario('temporary-stoppage'));
    const later = run.withoutAI.iterations[4] as NonNullable<
      (typeof run.withoutAI.iterations)[number]
    >;
    expect(later.incident.cleared).toBe(true);
    expect(later.status).toBe('bunched');
    // Still getting worse after the cause has gone.
    expect(later.metrics.mae).toBeGreaterThan(
      run.withoutAI.iterations[2]?.metrics.mae as number,
    );
  });

  it('escalates a stationary bus only while it is still stalled', () => {
    const run = buildSimulation(getScenario('temporary-stoppage'));
    expect(run.withAI.iterations[1]?.incident.escalated).toBe(true);
    expect(run.withAI.iterations[3]?.incident.escalated).toBe(false);
  });

  it('recomputes terminal departures as a set in the late-departure scenario', () => {
    const run = buildSimulation(getScenario('late-departure'));
    const dispatch = run.withAI.iterations[0]?.dispatch;
    expect(dispatch).toBeDefined();
    const rows = dispatch as NonNullable<typeof dispatch>;
    expect(rows).toHaveLength(4);
    // A left 7 minutes late: 10 minutes of scheduled gap less the 3 it started with.
    expect(rows.find((row) => row.bus === 'A')?.actual).toBe('10:07');
    // Followers are released later than their timetable so the corridor spaces out.
    for (const bus of ['B', 'C', 'D'] as BusId[]) {
      expect(rows.find((row) => row.bus === bus)?.offsetMinutes as number).toBeGreaterThan(0);
    }
    // Under schedule priority nothing is offset.
    const uncontrolled = run.withoutAI.iterations[0]?.dispatch as NonNullable<typeof dispatch>;
    for (const bus of ['B', 'C', 'D'] as BusId[]) {
      expect(uncontrolled.find((row) => row.bus === bus)?.offsetMinutes).toBe(0);
    }
  });

  it('tracks occupancy against the gap ahead of each bus', () => {
    const run = buildSimulation(getScenario('passenger-surge'));
    const first = run.withoutAI.iterations[0]?.occupancy as NonNullable<
      (typeof run.withoutAI.iterations)[number]['occupancy']
    >;
    const later = run.withoutAI.iterations[3]?.occupancy as NonNullable<
      (typeof run.withoutAI.iterations)[number]['occupancy']
    >;
    // The late lead bus keeps filling; the bus closing behind it keeps emptying.
    expect(later.A).toBeGreaterThan(first.A);
    expect(later.B).toBeLessThan(first.B);
  });
});
