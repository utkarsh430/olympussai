// The evaluation harness, and the two things it exists to stop happening.
//
// 1. A law going silent without the report saying so. Two-way holding
//    generated nothing on every simulated run this repo ever performed, for
//    a structural reason nobody could see in a KPI table. The coverage
//    assertions below fail the moment that is true again.
// 2. A difference being reported as real on the strength of its mean. Every
//    verdict here goes through a paired bootstrap interval, and the tests
//    pin that a wide interval is reported as no effect however large the
//    mean it surrounds.
import { describe, it, expect } from 'vitest';
import { selectCorridors } from '../../src/evaluation/corridors.js';
import { parseExperimentSpec, resolveInputs, seedsFor } from '../../src/evaluation/spec.js';
import { runCell, runExperiment } from '../../src/evaluation/runner.js';
import { buildReport, renderCsv, renderMarkdown, SATURATION_WARN_SHARE } from '../../src/evaluation/report.js';
import { summarizeCoverage, silentLaws } from '../../src/evaluation/coverage.js';
import { pairedDifference, isImprovement } from '../../src/evaluation/statistics.js';
import { runComplianceSweep, runVariabilitySweep, renderCurve } from '../../src/evaluation/robustness.js';
import type { ExperimentSpec } from '../../src/evaluation/spec.js';

function spec(overrides: Record<string, unknown> = {}): ExperimentSpec {
  return parseExperimentSpec({
    name: 'test',
    corridors: { source: 'synthetic', count: 1 },
    scenarios: ['none'],
    seeds: { count: 6, base: 4242 },
    arms: [{ name: 'as-deployed', policyOverrides: {} }],
    ...overrides,
  });
}

async function syntheticCorridor() {
  const { corridors } = await selectCorridors({ source: 'synthetic', count: 1 });
  const corridor = corridors[0];
  if (!corridor) throw new Error('no synthetic corridor');
  return corridor;
}

describe('evaluation harness', () => {
  it('runs without a database when the corridors are synthetic', async () => {
    const selection = await selectCorridors({ source: 'synthetic', count: 2 });
    expect(selection.provenance).toBe('synthetic');
    expect(selection.corridors).toHaveLength(2);
    // Two corridors of different length, so a result is not one shape's accident.
    expect(selection.corridors[0]?.totalDistanceMeters).not.toBe(
      selection.corridors[1]?.totalDistanceMeters,
    );
  });

  it('is deterministic: the same spec produces the same numbers', async () => {
    const corridor = await syntheticCorridor();
    const first = buildReport(runExperiment(spec(), [corridor], 'synthetic'));
    const second = buildReport(runExperiment(spec(), [corridor], 'synthetic'));
    expect(first.summaries[0]?.metrics.ewtSeconds).toEqual(second.summaries[0]?.metrics.ewtSeconds);
    expect(first.summaries[0]?.coverage).toEqual(second.summaries[0]?.coverage);
  });

  it('pairs every arm against a no-control baseline on the identical seed', async () => {
    const corridor = await syntheticCorridor();
    const run = runExperiment(spec(), [corridor], 'synthetic');
    const seeds = seedsFor(spec());
    expect(run.cells).toHaveLength(seeds.length);
    // Same seed, same scenario, run twice: the baseline must be identical,
    // because it is the same simulation. If it drifts, the pairing is a lie.
    for (const cell of run.cells) {
      const repeat = runCell(
        corridor,
        spec().arms[0]!,
        resolveInputs(spec(), cell.seed, 'none'),
      );
      expect(repeat.baseline).toEqual(cell.baseline);
    }
  });

  // ─── THE REGRESSION THAT MATTERS ───────────────────────────────────────
  //
  // `simulation/engine.ts` used to advance one vehicle's complete trip at a
  // time, so at every decision the bus BEHIND had not been simulated and
  // `ControllerKinematics.trailer` was always null. h_bwd was therefore
  // always null, `mpc/twoWayHold.ts` declined every pair, and every run
  // measured the self-equalizing fallback alone while looking like a verdict
  // on the controller. Reverting the single-clock engine would restore that
  // silently; these two assertions are what makes it loud.
  it('exercises two-way holding, which was structurally unreachable before the single-clock engine', async () => {
    const corridor = await syntheticCorridor();
    const run = runExperiment(spec({ seeds: { count: 4, base: 11 } }), [corridor], 'synthetic');
    const coverage = summarizeCoverage(run.cells.flatMap((cell) => cell.decisions));

    expect(coverage.decisions).toBeGreaterThan(0);
    expect(coverage.withTrailer).toBeGreaterThan(0);

    const twoWay = coverage.laws.find((law) => law.law === 'two_way');
    expect(twoWay?.generatedAt).toBeGreaterThan(0);
    expect(twoWay?.selectedAt).toBeGreaterThan(0);
  });

  // The companion regression to the two-way one above. Terminal dispatch read
  // `h_fwd`, which for a stationary bus is `gap / 1 km/h` - hours - so
  // `H* - h_fwd` was always negative and Algorithm A generated nothing on
  // every corridor and every cycle. It is the highest-return lever in the
  // reference architecture, and it was silently dead.
  it('exercises terminal dispatch regulation on a corridor whose origin is a control point', async () => {
    const corridor = await syntheticCorridor();
    expect(corridor.stops[0]?.isControlPoint).toBe(true);

    const run = runExperiment(spec({ seeds: { count: 4, base: 13 } }), [corridor], 'synthetic');
    const coverage = summarizeCoverage(run.cells.flatMap((cell) => cell.decisions));

    expect(coverage.atTerminal).toBeGreaterThan(0);
    const terminal = coverage.laws.find((law) => law.law === 'terminal_dispatch');
    expect(terminal?.generatedAt).toBeGreaterThan(0);
    expect(terminal?.selectedAt).toBeGreaterThan(0);
    // It must not fire on EVERY terminal decision either. Measuring the
    // elapsed gap at arrival rather than at release made each hold pay for a
    // gap its own dwell was about to close, and the error compounded down the
    // line - 20s, 80s, 118s, 168s, 208s on buses dispatched exactly one
    // target headway apart. A law that always wants to hold is that bug.
    expect(terminal?.generatedAt).toBeLessThan(coverage.atTerminal);
  });

  it('reports a law that never ran, rather than leaving it as an empty row', async () => {
    const corridor = await syntheticCorridor();
    const run = runExperiment(spec({ seeds: { count: 2, base: 5 } }), [corridor], 'synthetic');
    const coverage = summarizeCoverage(run.cells.flatMap((cell) => cell.decisions));
    for (const entry of silentLaws(coverage)) {
      // A silence without a reason is the thing this whole mechanism exists
      // to prevent; every silent law must name why.
      expect(entry.reason).not.toBeNull();
    }
    expect(renderMarkdown(buildReport(run))).toContain('Algorithm coverage');
  });

  it('declines to generate two-way candidates when the corridor has no gains, and says which', async () => {
    const corridor = await syntheticCorridor();
    const ungained = { ...corridor, policy: { ...corridor.policy, kf: null, kb: null } };
    const run = runExperiment(spec({ seeds: { count: 2, base: 7 } }), [ungained], 'synthetic');
    const coverage = summarizeCoverage(run.cells.flatMap((cell) => cell.decisions));
    const twoWay = coverage.laws.find((law) => law.law === 'two_way');
    expect(twoWay?.generatedAt).toBe(0);
    expect(twoWay?.declineReasons[0]?.reason).toBe('gains_unset');
  });

  it('warns when the corridor is capacity-saturated, because the wait metric cannot respond there', async () => {
    const corridor = await syntheticCorridor();
    // The rehearsal's own demand profile against a small bus: steady-state
    // load far exceeds the seats, so the run saturates by construction.
    const saturating = spec({
      inputs: { vehicleCapacity: 12, boardingRatePerMinute: 3, alightingFraction: 0.1 },
      seeds: { count: 3, base: 9 },
    });
    const report = buildReport(runExperiment(saturating, [corridor], 'synthetic'));
    expect(report.saturated.length).toBeGreaterThan(0);
    expect(report.saturated[0]?.deniedShare).toBeGreaterThan(SATURATION_WARN_SHARE);
    expect(renderMarkdown(report)).toContain('Saturation warning');
  });

  it('emits a CSV whose header and rows agree in width', async () => {
    const corridor = await syntheticCorridor();
    const csv = renderCsv(buildReport(runExperiment(spec({ seeds: { count: 2, base: 3 } }), [corridor], 'synthetic')));
    const [header, ...rows] = csv.trim().split('\n');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.split(',')).toHaveLength(header!.split(',').length);
    }
  });

  it('refuses an out-of-range parameter rather than clamping it', () => {
    expect(() => spec({ arms: [{ name: 'bad', policyOverrides: { kf: 99 } }] })).toThrow();
    expect(() => spec({ seeds: { count: 0, base: 1 } })).toThrow();
    // Unknown keys are refused too: a typo'd knob must not be silently ignored.
    expect(() => spec({ arms: [{ name: 'typo', policyOverrides: { kF: 0.5 } }] })).toThrow();
  });
});

describe('paired statistics', () => {
  const pairs = (differences: number[]) =>
    differences.map((d, i) => ({ baseline: 100 + i, controlled: 100 + i + d }));

  it('calls a consistent improvement significant', () => {
    const result = pairedDifference(pairs(Array.from({ length: 30 }, () => -10)), true, 1);
    expect(result.meanDifference).toBeCloseTo(-10, 6);
    expect(result.significant).toBe(true);
    expect(result.winRate).toBe(1);
    expect(isImprovement(result, true)).toBe(true);
  });

  // The headline behaviour: a large mean built on a wide spread is not a
  // result. Reporting it as one is how a tuning exercise ships noise.
  it('refuses to call a large but unstable mean an improvement', () => {
    const noisy = [-200, 190, -180, 170, -160, 150, -140, 130, -120, 110];
    const result = pairedDifference(pairs(noisy), true, 1);
    expect(result.meanDifference).toBeLessThan(0);
    expect(result.significant).toBe(false);
    expect(isImprovement(result, true)).toBe(false);
  });

  it('refuses an improvement that wins on average but loses on most seeds', () => {
    // One enormous win, nine small losses: mean is negative, most days are worse.
    const lopsided = [-500, 10, 10, 10, 10, 10, 10, 10, 10, 10];
    const result = pairedDifference(pairs(lopsided), true, 1);
    expect(result.winRate).toBeLessThan(0.5);
    expect(isImprovement(result, true)).toBe(false);
  });

  it('reports no interval for a single seed rather than a zero-width one', () => {
    const result = pairedDifference(pairs([-5]), true, 1);
    expect(result.sampleCount).toBe(1);
    expect(result.ciLow).toBeNull();
    expect(result.significant).toBe(false);
  });

  it('drops pairs where either side is null, and says how many survived', () => {
    const result = pairedDifference(
      [
        { baseline: 10, controlled: 8 },
        { baseline: null, controlled: 8 },
        { baseline: 10, controlled: null },
      ],
      true,
      1,
    );
    expect(result.sampleCount).toBe(1);
  });

  it('is reproducible: the same pairs and seed give the same interval', () => {
    const input = pairs([-10, -5, -20, 3, -8, -12, -1, -30, -4, -6]);
    expect(pairedDifference(input, true, 42)).toEqual(pairedDifference(input, true, 42));
  });
});

describe('robustness curves', () => {
  const base = () =>
    parseExperimentSpec({
      name: 'robustness',
      corridors: { source: 'synthetic', count: 1 },
      scenarios: ['none'],
      seeds: { count: 5, base: 808 },
      arms: [{ name: 'as-deployed', policyOverrides: {} }],
    });

  it('sweeps compliance fleet-wide, and refusals rise as compliance falls', async () => {
    const corridor = await syntheticCorridor();
    const spec = base();
    const curve = runComplianceSweep(spec, corridor, spec.arms[0]!, [1, 0.5]);

    expect(curve.axis).toBe('compliance');
    // Sorted hardest-last, so a reader sees the curve fall.
    expect(curve.points.map((p) => p.level)).toEqual([1, 0.5]);
    // At full compliance no driver refuses anything, by construction.
    expect(curve.points[0]?.meanRefusedHoldSeconds).toBe(0);
    expect(curve.points[1]?.meanRefusedHoldSeconds).toBeGreaterThan(0);
  });

  it('reports the WORST surviving level on each axis, not the easiest', async () => {
    const corridor = await syntheticCorridor();
    const spec = base();
    const variability = runVariabilitySweep(spec, corridor, spec.arms[0]!, [0.1, 0.4]);
    // Higher variation is harder, so a surviving benefit is reported at the
    // top of the range. Taking a minimum here would advertise the easy level.
    if (variability.holdsDownTo !== null) {
      expect(variability.holdsDownTo).toBeGreaterThanOrEqual(0.1);
    }
    expect(variability.points.map((p) => p.level)).toEqual([0.4, 0.1]);
  });

  it('says plainly when a benefit is not significant at any level', async () => {
    const corridor = await syntheticCorridor();
    const spec = base();
    const curve = runComplianceSweep(spec, corridor, spec.arms[0]!, [0.05]);
    const rendered = renderCurve(curve);
    expect(rendered).toContain('Compliance degradation');
    if (curve.holdsDownTo === null) {
      expect(rendered).toContain('not significant at ANY compliance level');
    }
  });
});
