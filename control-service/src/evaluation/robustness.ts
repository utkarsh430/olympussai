// Does the recommendation survive the world it will be deployed into?
//
// A gain set found on a well-behaved corridor where every driver obeys is a
// gain set found in a place that does not exist. `algo_new.md` section 8.4
// requires two degradation curves before any comparison is reportable, and
// they are the two below.
//
// ─── COMPLIANCE ──────────────────────────────────────────────────────────
//
// The literature is unanimous that driver compliance is the dominant
// real-world failure mode. The CTA deployment (`algo_new.md` section 4.1) -
// the only real-world RL deployment the reference cites - achieved -8.7% AM
// and -19.9% PM wait at **35% and 57% compliance**, and Phillips et al.
// (2015) find ~88% of maximum benefit is retained at 50% PROVIDED
// non-compliance is random. So the interesting question is never "does it
// work at 100%", it is "where does the curve fall off".
//
// This sweeps every vehicle at the same probability, which is the random
// non-compliance those results assume. It does NOT model the case both
// sources flag as the real danger - a permanently non-compliant vehicle -
// because the simulator's `non_compliance` disturbance is a per-decision coin
// flip, not a driver who never complies. Stated rather than glossed: a flat
// curve here is evidence about random refusal only.
//
// ─── TRAVEL-TIME VARIABILITY ─────────────────────────────────────────────
//
// The other axis, and the cheaper one: a controller tuned on a quiet corridor
// can be actively harmful on a variable one, because every hold it adds is
// spent against noise it cannot predict.
import { runCell, fleetWideNonCompliance, resolveCorridorInputs } from './runner.js';
import { pairedDifference, type PairedDifference } from './statistics.js';
import { seedsFor } from './spec.js';
import { HEADLINE_METRIC } from './metrics.js';
import { KPI_METRICS } from './metrics.js';
import type { CorridorInputs } from '../rehearsal/corridor.js';
import type { ArmSpec, ExperimentSpec } from './spec.js';
import type { RehearsalDisturbance } from '../rehearsal/run.js';

export interface RobustnessPoint {
  /** The swept value: a compliance probability, or a travel-time variation fraction. */
  level: number;
  headline: PairedDifference;
  /** Seconds of hold the drivers refused, averaged over seeds. Zero at full compliance by construction. */
  meanRefusedHoldSeconds: number;
}

export interface RobustnessCurve {
  axis: 'compliance' | 'travel_time_variation';
  points: RobustnessPoint[];
  /**
   * The lowest level at which the arm still beats no control on the headline
   * metric with an interval excluding zero. Null when it never does, which is
   * the finding rather than a missing value.
   */
  holdsDownTo: number | null;
}

const headlineMetric = KPI_METRICS.find((m) => m.key === HEADLINE_METRIC);

function curveFor(
  axis: RobustnessCurve['axis'],
  points: RobustnessPoint[],
): RobustnessCurve {
  const lowerIsBetter = headlineMetric?.lowerIsBetter ?? true;
  const surviving = points.filter(
    (point) =>
      point.headline.significant &&
      point.headline.meanDifference !== null &&
      (lowerIsBetter ? point.headline.meanDifference < 0 : point.headline.meanDifference > 0),
  );
  const levels = surviving.map((point) => point.level);
  // The two axes get harder in opposite directions: LESS compliance is
  // worse, MORE travel-time variation is worse. Taking the minimum on both
  // would report "survives down to 10% variation" - the easiest level tested
  // - as though it were a robustness finding.
  const worstSurvived =
    levels.length === 0 ? null : axis === 'compliance' ? Math.min(...levels) : Math.max(...levels);
  return {
    axis,
    points: [...points].sort((a, b) => b.level - a.level),
    holdsDownTo: worstSurvived,
  };
}

export function runComplianceSweep(
  spec: ExperimentSpec,
  corridor: CorridorInputs,
  arm: ArmSpec,
  levels: readonly number[],
  scenario: RehearsalDisturbance = 'none',
): RobustnessCurve {
  const seeds = seedsFor(spec);
  const points = levels.map((level) => {
    const pairs: Array<{ baseline: number | null; controlled: number | null }> = [];
    let refused = 0;
    for (const seed of seeds) {
      // Through `resolveCorridorInputs`, so the curve is drawn at the demand
      // `runExperiment` gives this corridor. A curve drawn at a different
      // demand from the run it qualifies is a curve about another corridor.
      const { inputs } = resolveCorridorInputs(spec, corridor, seed, scenario);
      const result = runCell(
        corridor,
        arm,
        inputs,
        fleetWideNonCompliance(corridor, inputs, level),
      );
      pairs.push({
        baseline: headlineMetric?.read(result.baseline) ?? null,
        controlled: headlineMetric?.read(result.controlled) ?? null,
      });
      refused += result.refusedHoldSeconds;
    }
    return {
      level,
      headline: pairedDifference(pairs, headlineMetric?.lowerIsBetter ?? true, Math.round(level * 1000)),
      meanRefusedHoldSeconds: refused / Math.max(1, seeds.length),
    };
  });
  return curveFor('compliance', points);
}

export function runVariabilitySweep(
  spec: ExperimentSpec,
  corridor: CorridorInputs,
  arm: ArmSpec,
  levels: readonly number[],
  scenario: RehearsalDisturbance = 'none',
): RobustnessCurve {
  const seeds = seedsFor(spec);
  const points = levels.map((level) => {
    const pairs: Array<{ baseline: number | null; controlled: number | null }> = [];
    let refused = 0;
    for (const seed of seeds) {
      const { inputs } = resolveCorridorInputs(spec, corridor, seed, scenario, {
        travelTimeVariation: level,
      });
      const result = runCell(corridor, arm, inputs);
      pairs.push({
        baseline: headlineMetric?.read(result.baseline) ?? null,
        controlled: headlineMetric?.read(result.controlled) ?? null,
      });
      refused += result.refusedHoldSeconds;
    }
    return {
      level,
      headline: pairedDifference(pairs, headlineMetric?.lowerIsBetter ?? true, Math.round(level * 1000)),
      meanRefusedHoldSeconds: refused / Math.max(1, seeds.length),
    };
  });
  return curveFor('travel_time_variation', points);
}

export function renderCurve(curve: RobustnessCurve): string {
  const lines: string[] = [];
  const isCompliance = curve.axis === 'compliance';
  lines.push(isCompliance ? '**Compliance degradation**' : '**Travel-time variability**');
  lines.push('');
  lines.push(
    isCompliance
      ? '| Compliance | Excess-wait change | 95% CI | Wins | Hold refused |'
      : '| Variation | Excess-wait change | 95% CI | Wins | Hold refused |',
  );
  lines.push('|---|---|---|---|---|');
  for (const point of curve.points) {
    const d = point.headline;
    const verdict = d.significant ? '' : ' *(n.s.)*';
    lines.push(
      `| ${(point.level * 100).toFixed(0)}% | ${d.meanDifference?.toFixed(2) ?? '-'}s${verdict} | ${d.ciLow?.toFixed(2) ?? '-'} … ${d.ciHigh?.toFixed(2) ?? '-'} | ${((d.winRate ?? 0) * 100).toFixed(0)}% | ${point.meanRefusedHoldSeconds.toFixed(0)}s |`,
    );
  }
  lines.push('');
  if (curve.holdsDownTo === null) {
    lines.push(
      isCompliance
        ? '> The benefit is not significant at ANY compliance level tested, including full compliance. Do not deploy this on the strength of its mean.'
        : '> The benefit is not significant at any variability level tested.',
    );
  } else if (isCompliance) {
    lines.push(
      `> Benefit survives down to **${(curve.holdsDownTo * 100).toFixed(0)}% compliance**. For reference, the CTA deployment in \`algo_new.md\` §4.1 achieved its results at 35-57%, so a curve that dies above ~50% is a curve that would not have survived that deployment.`,
    );
  } else {
    lines.push(
      `> Benefit survives up to **${(curve.holdsDownTo * 100).toFixed(0)}% travel-time variation**.`,
    );
  }
  return lines.join('\n');
}
