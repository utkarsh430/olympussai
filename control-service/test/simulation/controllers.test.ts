import { describe, it, expect } from 'vitest';
import { simulate } from '../../src/simulation/engine.js';
import { noControlController, createSelfEqualizingController } from '../../src/simulation/controllers.js';
import { SAMPLE_ROUTE_DIRECTION, SAMPLE_DISPATCHES } from '../../src/simulation/fixtures/sampleRouteDirection.js';
import type { ScenarioConfig } from '../../src/simulation/types.js';

const selfEqualizing = createSelfEqualizingController({ gain: 0.6 });

/**
 * A corridor that actually comes apart, and a fleet long enough to feel it.
 *
 * ─── WHY THE SAMPLE FIXTURE IS NOT ENOUGH ────────────────────────────────
 *
 * `SAMPLE_ROUTE_DIRECTION` with `SAMPLE_DISPATCHES` is four buses over six
 * stops with mild link variance. MEASURED: the self-equalizing controller
 * applies about SIXTY SECONDS of hold across a whole run on it, and beats the
 * uncontrolled arm on 50% of sixty seeds - a coin flip, because there is
 * almost no dispersion for it to remove. An assertion that the controller
 * reduces CV on that fixture is not a claim about the controller; it is a
 * claim about which side of the noise the current draw order happens to land.
 *
 * Doubling the link standard deviation and running ten buses gives the law
 * something to correct: hold rises to ~370 s per run and the controlled arm
 * wins on 62% of seeds with a clearly lower mean CV. Same law, same gain -
 * the difference is a corridor where control is the thing being measured.
 */
function unstableRouteDirection() {
  return {
    ...SAMPLE_ROUTE_DIRECTION,
    links: SAMPLE_ROUTE_DIRECTION.links.map((link) => ({
      ...link,
      stddevSeconds: link.stddevSeconds * 2,
    })),
  };
}

const LONG_FLEET = Array.from({ length: 10 }, (_, index) => ({
  vehicleId: `SIM-${String(index + 1).padStart(2, '0')}`,
  scheduledDispatchSeconds: index * SAMPLE_ROUTE_DIRECTION.targetHeadwaySeconds,
}));

function configWithDisturbance(): ScenarioConfig {
  return {
    name: 'controllers-test',
    routeDirection: SAMPLE_ROUTE_DIRECTION,
    dispatches: SAMPLE_DISPATCHES,
    // Demand burst pushes a vehicle's dwell up, opening a gap - exactly
    // the kind of deviation a self-equalizing controller should correct.
    disturbances: [{ type: 'demand_burst', stopId: 'stop-3', startSeconds: 0, endSeconds: 900, multiplier: 10 }],
    seed: 7,
  };
}

function unstableConfig(): ScenarioConfig {
  return {
    ...configWithDisturbance(),
    routeDirection: unstableRouteDirection(),
    dispatches: LONG_FLEET,
  };
}

describe('pluggable controller interface: no-control vs controlled comparison', () => {
  it('noControlController never issues a hold', () => {
    const result = simulate(configWithDisturbance(), noControlController);
    expect(result.visits.every((v) => v.appliedHoldSeconds === 0)).toBe(true);
    expect(result.visits.every((v) => v.intendedHoldSeconds === 0)).toBe(true);
  });

  it('the same scenario run under two controllers produces comparable, independently attributable results', () => {
    const noControlResult = simulate(configWithDisturbance(), noControlController);
    const controlledResult = simulate(configWithDisturbance(), selfEqualizing);

    expect(noControlResult.controllerName).toBe('no-control');
    expect(controlledResult.controllerName).toBe('self-equalizing');
    // Same scenario (same seed/inputs) means any difference is attributable to the controller alone.
    expect(controlledResult.visits.some((v) => v.appliedHoldSeconds > 0)).toBe(true);
  });

  // ACROSS SEEDS, NOT ON ONE. This assertion used to run a single seed and
  // require the controlled arm to win on it, which is a claim about one
  // realisation of a stochastic process rather than about the controller -
  // `algo_new.md` section 8.3 rules out exactly that comparison. It passed
  // only because the engine's draw order happened to produce a favourable
  // day; the day it changed, the assertion failed while the controller was
  // still better on average. Paired seeds (each seed drives both arms) make
  // the difference attributable to the controller alone.
  it('self-equalizing controller reduces mean headway CV across paired seeds', () => {
    const SEEDS = 60;
    let noControlTotal = 0;
    let controlledTotal = 0;
    let controlledWins = 0;
    let compared = 0;

    for (let seed = 1; seed <= SEEDS; seed++) {
      const noControlResult = simulate({ ...unstableConfig(), seed }, noControlController);
      const controlledResult = simulate({ ...unstableConfig(), seed }, selfEqualizing);
      const before = noControlResult.kpis.headwayCv;
      const after = controlledResult.kpis.headwayCv;
      if (before === null || after === null) continue;
      compared++;
      noControlTotal += before;
      controlledTotal += after;
      if (after <= before) controlledWins++;
    }

    expect(compared).toBeGreaterThan(SEEDS / 2);
    expect(controlledTotal / compared).toBeLessThan(noControlTotal / compared);
    // A control law that helps on average but loses on most days is not a
    // control law, it is a lottery with a good mean.
    expect(controlledWins / compared).toBeGreaterThan(0.5);
  });

  it('never issues a hold when the vehicle state is stale (gps dropout guardrail)', () => {
    const config: ScenarioConfig = {
      name: 'gps-dropout-guardrail',
      routeDirection: SAMPLE_ROUTE_DIRECTION,
      dispatches: SAMPLE_DISPATCHES,
      disturbances: [
        { type: 'demand_burst', stopId: 'stop-3', startSeconds: 0, endSeconds: 900, multiplier: 10 },
        { type: 'gps_dropout', vehicleId: 'veh-2', startSeconds: 0, endSeconds: 3600 },
      ],
      seed: 7,
    };
    const result = simulate(config, selfEqualizing);
    const staleVisits = result.visits.filter((v) => v.isStateStale);
    expect(staleVisits.length).toBeGreaterThan(0);
    expect(staleVisits.every((v) => v.appliedHoldSeconds === 0)).toBe(true);
  });

  it('clamps holds to the route-direction max hold', () => {
    const aggressive = createSelfEqualizingController({ gain: 50 });
    const result = simulate(configWithDisturbance(), aggressive);
    for (const v of result.visits) {
      expect(v.appliedHoldSeconds).toBeLessThanOrEqual(SAMPLE_ROUTE_DIRECTION.maxHoldSeconds);
      expect(v.intendedHoldSeconds).toBeLessThanOrEqual(SAMPLE_ROUTE_DIRECTION.maxHoldSeconds);
    }
  });
});
