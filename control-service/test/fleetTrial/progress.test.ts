// What a running trial says about itself, and the one rule that keeps it
// honest: the count and the total it is counted against are one expression.
//
// The failure this guards is specific and was live before it. The trial's
// original progress callback fired once per (phase, scenario) - 38 events on
// the inter-city preset - and the trial then spent 87% of its 32 seconds in
// the policy studies, silently. A console wired to that callback fills to
// "38 of 38" in four seconds and then shows a finished-looking trial for
// another twenty-eight. That is not a smaller lie than a timer bar; it is the
// same one.
import { describe, it, expect } from 'vitest';
import { runFleetTrial, DEFAULT_FLEET_TRIAL_SPEC } from '../../src/fleetTrial/run.js';
import { eligibleScenarioCount } from '../../src/fleetTrial/progress.js';
import type { FleetTrialProgress, FleetTrialStage } from '../../src/fleetTrial/progress.js';

/**
 * Deliberately tiny. Every rule in this file is about the SHAPE of the
 * reporting - one event per run, a total known up front, four stages - and
 * none of it is size-dependent, so the spec is sized to keep a suite that
 * already has wall-clock timeouts fast rather than to be representative.
 */
const SMALL = {
  ...DEFAULT_FLEET_TRIAL_SPEC,
  vehiclesPerPhase: 12,
  scenarios: ['steady_variability', 'slow_bus', 'traffic_shock'] as const,
} as unknown as typeof DEFAULT_FLEET_TRIAL_SPEC;

function collect(spec = SMALL): FleetTrialProgress[] {
  const events: FleetTrialProgress[] = [];
  runFleetTrial(spec, (progress) => events.push({ ...progress }));
  return events;
}

describe('a trial reporting its own progress', () => {
  const events = collect();

  it('reports exactly as many runs as it promised at the start', () => {
    // THE load-bearing assertion. Every other honest-progress claim on the
    // console rests on the denominator being the real amount of work, so this
    // fails the moment a new study is added to `run.ts` and not to the plan -
    // which is the only way the two can drift apart.
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)?.done).toBe(events.at(-1)?.total);
    expect(events.length).toBe(events[0]!.total);
  });

  it('knows the total before the first run finishes, and never revises it', () => {
    // A denominator that grows mid-run is a denominator that was guessed. It
    // is computable up front - the variant lists are built from the corridor
    // spec - so it is computed up front.
    const totals = new Set(events.map((e) => e.total));
    expect([...totals]).toEqual([events[0]!.total]);
  });

  it('counts every run once, in order, with no gaps', () => {
    expect(events.map((e) => e.done)).toEqual(
      Array.from({ length: events.length }, (_, i) => i + 1),
    );
  });

  it('says which part of the trial it is in, and reaches all four', () => {
    // The stage is what an operator reads while the count moves slowly. A
    // trial that reported only a number would leave "142 of 437" meaning
    // nothing for the twenty-eight seconds the studies take.
    const stages = new Set<FleetTrialStage>(events.map((e) => e.stage));
    expect(stages).toEqual(
      new Set<FleetTrialStage>([
        'phases',
        'policy_study',
        'occupancy_contrast',
        'self_equalizing',
      ]),
    );
  });

  it('labels every run in words, never with an empty string', () => {
    expect(events.every((e) => e.label.trim().length > 0)).toBe(true);
  });

  it('spends most of its runs outside the phases, which is why the old count lied', () => {
    // Pins the SHAPE of the problem this change exists to fix, so a future
    // reader cannot conclude the phases were ever most of the work.
    const phaseUnits = events.filter((e) => e.stage === 'phases').length;
    expect(phaseUnits).toBeLessThan(events.length / 2);
  });
});

describe('progress reporting and what the trial computes', () => {
  it('does not change a single number in the report', () => {
    // The hard rule on this change: reporting is an addition, never an
    // alteration. Same spec, one run watched and one not, compared field by
    // field with only the wall-clock fields removed.
    const watched = runFleetTrial(SMALL, () => {});
    const unwatched = runFleetTrial(SMALL);
    const strip = (r: typeof watched) => {
      const { generatedAt: _g, durationMs: _d, ...rest } = r;
      return rest;
    };
    expect(strip(watched)).toEqual(strip(unwatched));
  });

  it('runs identically with no reporter at all', () => {
    expect(() => runFleetTrial(SMALL)).not.toThrow();
  });
});

describe('eligibleScenarioCount', () => {
  it('counts only the scenarios a fleet can give two buses', () => {
    // Two is the floor because a single bus has no pair to measure a headway
    // between. The studies skip such a scenario, so the plan must too or the
    // count stalls short of its total forever.
    expect(eligibleScenarioCount(20, 10)).toBe(10);
    expect(eligibleScenarioCount(10, 10)).toBe(0);
    expect(eligibleScenarioCount(15, 10)).toBe(5);
    expect(eligibleScenarioCount(0, 10)).toBe(0);
  });

  it('is zero when there are no scenarios, rather than dividing by zero', () => {
    expect(eligibleScenarioCount(100, 0)).toBe(0);
  });
});
