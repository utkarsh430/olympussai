// What an evaluation run says, and the three forms it says it in.
//
//   results.json  every cell and the spec that produced it (the raw per-decision
//                 log is summarised into coverage, not repeated - `cli.ts#cellForOutput`)
//   summary.csv   one row per (corridor, scenario, arm), for a spreadsheet
//   summary.md    the readable verdict, which is also what prints to console
//
// ─── THE SATURATION WARNING ──────────────────────────────────────────────
//
// The single most dangerous output this harness can produce is "control makes
// no difference" on a corridor where the headline metric was incapable of
// moving. MEASURED on the 215 km fixture with the default modelled inputs:
// 2,042 of 3,359 offered passengers were denied boarding, the buses ran at
// capacity end to end, and EWT moved 242.0 -> 239.5 while headway CV moved
// 0.708 -> 0.557. The controller was working; the metric was saturated. A
// reader who saw only the EWT row would have concluded the opposite, so the
// report refuses to present a headline EWT verdict without saying that the
// corridor was overloaded.
import { KPI_METRICS, type MetricKey } from './metrics.js';
import { pairedDifference, isImprovement, type PairedDifference } from './statistics.js';
import { summarizeCoverage, silentLaws, type CoverageReport } from './coverage.js';
import { describeCalibration, isCalibrated } from './calibrate.js';
import { describeDemand } from './demand.js';
import type { CorridorDemand } from './demand.js';
import type { CorridorProvenance } from './corridors.js';
import type { Controllability } from '../lib/controllability.js';
import type { ExperimentRun, RunCell } from './runner.js';

export interface ArmSummary {
  routeDirectionId: string;
  scenario: string;
  armName: string;
  seeds: number;
  metrics: Record<MetricKey, PairedDifference>;
  coverage: CoverageReport;
  /** Share of offered demand that could not board, on the controlled arm. Above `SATURATION_WARN_SHARE` the wait metrics cannot respond. */
  deniedShare: number | null;
  meanAppliedHoldSeconds: number;
  meanRefusedHoldSeconds: number;
}

/**
 * The network-level verdict, pooled ONLY over the groups control could move.
 *
 * ─── WHY A SCOPE AND NOT A MEAN ──────────────────────────────────────────
 *
 * A corridor above the denied-boarding line has a headline metric that cannot
 * respond to control at all - waiting time there is bounded by seats, not by
 * spacing - so pooling it into a top line does not average an effect, it
 * DILUTES one. `FleetTrialReport.headlineScope` reached the same conclusion
 * from the other end (`oversaturated` is a scenario built to prove the harness
 * reports nothing) and it is measured there: on urban at 500 buses all
 * nineteen scenarios gave +0.95% and the eighteen readable ones +2.46%, so a
 * reader comparing across weeks would read a controller three times worse when
 * only the test set had changed.
 *
 * Same rule here, decided from the measured `deniedShare` and never from a
 * list of corridor ids. The excluded groups are NAMED and still carried in
 * `summaries`, never dropped: a saturated corridor is a finding about the
 * demand model, and hiding it would be the original defect in a new place.
 */
export interface HeadlineScope {
  /** 'all' only when nothing saturated; otherwise the pool is the readable groups. */
  scope: 'all' | 'readable_only';
  pooledGroups: number;
  excludedGroups: number;
  /** Corridors with at least one saturated group. Named, because a reader needs to know which. */
  excludedCorridors: string[];
  /**
   * Mean of the per-group RELATIVE differences, per metric, over the pooled
   * groups - never a mean of the absolute ones. Corridors on this network run
   * from a 300 s headway to a 12,497 s one, so an absolute second of excess
   * wait means something different on each and a pooled absolute mean is
   * dominated by the longest corridor in the set.
   */
  metrics: Record<
    MetricKey,
    {
      meanRelativeDifference: number | null;
      groupsBetter: number;
      groupsWorse: number;
      groupsNoEffect: number;
    }
  >;
}

export interface ExperimentReport {
  name: string;
  corridorProvenance: CorridorProvenance;
  generatedAt: string;
  durationMs: number;
  summaries: ArmSummary[];
  emptyCorridors: string[];
  /** Every corridor/arm whose runs were capacity-saturated, so its wait metrics are not informative. */
  saturated: Array<{ routeDirectionId: string; armName: string; deniedShare: number }>;
  /** One line per corridor saying what was fitted from observation and what stayed invented. */
  calibration: Array<{ routeDirectionId: string; calibrated: boolean; description: string }>;
  /**
   * What boarding rate each corridor ran at and where it came from.
   *
   * Read it beside the saturation table. A corridor whose modelled peak load
   * is over its seat count is saturated BY CONSTRUCTION, before any scenario
   * or seed, and this row is where that is visible.
   */
  demand: Array<{ routeDirectionId: string; demand: CorridorDemand; description: string }>;
  /** The pooled verdict, and what it excludes. Read this instead of averaging the table below. */
  headlineScope: HeadlineScope;
  /**
   * Where each corridor sits on the controllability curve.
   *
   * Read it BEFORE the KPI table. Below the band nothing comes apart, so
   * holding has no dispersion to remove and makes things worse; above it, more
   * deviation accumulates between two stops than a hold at either can remove.
   * In neither case is a bad number a statement about the control laws, and
   * this harness reported nothing that would let a reader tell.
   */
  controllability: Array<{ routeDirectionId: string; controllability: Controllability }>;
}

/**
 * Above this share of offered passengers denied, the corridor is overloaded
 * and EWT is bounded by capacity rather than by spacing. Not a physical
 * constant - a threshold above which this harness declines to present a wait
 * verdict without a caveat.
 */
export const SATURATION_WARN_SHARE = 0.2;

/**
 * A composite key that cannot collide, whatever a route-direction is called.
 *
 * The separator is a NUL, written as the ESCAPE `\u0000` rather than as a
 * literal byte. Written literally - which it was - the whole file reads as
 * binary to `file`, `grep` and every other text tool, so a search for
 * anything below this line silently returned nothing. Same string at runtime,
 * and the source stays greppable.
 */
function groupKey(cell: RunCell): string {
  return `${cell.routeDirectionId}\u0000${cell.scenario}\u0000${cell.armName}`;
}

/** A group is readable when its wait metrics were free to move - which is to say, when it did not saturate. */
function isReadable(summary: ArmSummary): boolean {
  return summary.deniedShare === null || summary.deniedShare <= SATURATION_WARN_SHARE;
}

function buildHeadlineScope(summaries: readonly ArmSummary[]): HeadlineScope {
  const readable = summaries.filter(isReadable);
  const excluded = summaries.filter((summary) => !isReadable(summary));
  const pooled = excluded.length > 0 ? readable : summaries;

  const metrics = {} as HeadlineScope['metrics'];
  for (const metric of KPI_METRICS) {
    const relatives: number[] = [];
    let groupsBetter = 0;
    let groupsWorse = 0;
    let groupsNoEffect = 0;
    for (const summary of pooled) {
      const difference = summary.metrics[metric.key];
      if (difference.sampleCount === 0) continue;
      if (difference.meanRelativeDifference !== null) {
        relatives.push(difference.meanRelativeDifference);
      }
      if (isImprovement(difference, metric.lowerIsBetter)) groupsBetter += 1;
      else if (difference.significant) groupsWorse += 1;
      else groupsNoEffect += 1;
    }
    metrics[metric.key] = {
      meanRelativeDifference:
        relatives.length > 0 ? relatives.reduce((a, b) => a + b, 0) / relatives.length : null,
      groupsBetter,
      groupsWorse,
      groupsNoEffect,
    };
  }

  return {
    scope: excluded.length > 0 ? 'readable_only' : 'all',
    pooledGroups: pooled.length,
    excludedGroups: excluded.length,
    excludedCorridors: [...new Set(excluded.map((summary) => summary.routeDirectionId))].sort(),
    metrics,
  };
}

export function buildReport(run: ExperimentRun): ExperimentReport {
  const groups = new Map<string, RunCell[]>();
  for (const cell of run.cells) {
    const key = groupKey(cell);
    const bucket = groups.get(key) ?? [];
    bucket.push(cell);
    groups.set(key, bucket);
  }

  const summaries: ArmSummary[] = [];
  const saturated: ExperimentReport['saturated'] = [];

  for (const [key, cells] of groups) {
    const [routeDirectionId = '', scenario = '', armName = ''] = key.split('\u0000');
    const metrics = {} as Record<MetricKey, PairedDifference>;
    for (const metric of KPI_METRICS) {
      metrics[metric.key] = pairedDifference(
        cells.map((cell) => ({
          baseline: metric.read(cell.baseline),
          controlled: metric.read(cell.controlled),
        })),
        metric.lowerIsBetter,
        // Seeded from the group so an interval is reproducible for that group
        // specifically, not merely reproducible for the run as a whole.
        cells.length + key.length,
      );
    }

    const offered = cells.reduce(
      (total, cell) => total + cell.controlled.totalBoardings + cell.controlled.deniedBoardings,
      0,
    );
    const denied = cells.reduce((total, cell) => total + cell.controlled.deniedBoardings, 0);
    const deniedShare = offered > 0 ? denied / offered : null;

    const coverage = summarizeCoverage(cells.flatMap((cell) => cell.decisions));

    summaries.push({
      routeDirectionId,
      scenario,
      armName,
      seeds: cells.length,
      metrics,
      coverage,
      deniedShare,
      meanAppliedHoldSeconds:
        cells.reduce((t, c) => t + c.appliedHoldSeconds, 0) / Math.max(1, cells.length),
      meanRefusedHoldSeconds:
        cells.reduce((t, c) => t + c.refusedHoldSeconds, 0) / Math.max(1, cells.length),
    });

    if (deniedShare !== null && deniedShare > SATURATION_WARN_SHARE) {
      saturated.push({ routeDirectionId, armName, deniedShare });
    }
  }

  summaries.sort(
    (a, b) =>
      a.routeDirectionId.localeCompare(b.routeDirectionId) ||
      a.scenario.localeCompare(b.scenario) ||
      a.armName.localeCompare(b.armName),
  );

  return {
    name: run.spec.name,
    corridorProvenance: run.corridorProvenance,
    generatedAt: new Date().toISOString(),
    durationMs: run.durationMs,
    summaries,
    emptyCorridors: run.emptyCorridors,
    saturated,
    demand: [...run.demand.values()].map((demand) => ({
      routeDirectionId: demand.routeDirectionId,
      demand,
      description: describeDemand(demand),
    })),
    headlineScope: buildHeadlineScope(summaries),
    calibration: [...run.calibration.values()].map((entry) => ({
      routeDirectionId: entry.routeDirectionId,
      calibrated: isCalibrated(entry),
      description: describeCalibration(entry),
    })),
    controllability: [...run.controllability.entries()].map(([routeDirectionId, controllability]) => ({
      routeDirectionId,
      controllability,
    })),
  };
}

// ─── Rendering ───────────────────────────────────────────────────────────

function fmt(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return value.toFixed(digits);
}

function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

function verdict(difference: PairedDifference, lowerIsBetter: boolean): string {
  if (difference.sampleCount === 0) return 'no data';
  if (isImprovement(difference, lowerIsBetter)) return 'better';
  if (!difference.significant) return 'no effect';
  return 'WORSE';
}

export function renderCsv(report: ExperimentReport): string {
  const header = [
    'route_direction_id',
    'scenario',
    'arm',
    'seeds',
    ...KPI_METRICS.flatMap((m) => [
      `${m.key}_baseline`,
      `${m.key}_controlled`,
      `${m.key}_mean_diff`,
      `${m.key}_ci_low`,
      `${m.key}_ci_high`,
      `${m.key}_significant`,
      `${m.key}_win_rate`,
    ]),
    'denied_share',
    'boarding_rate_per_minute',
    'demand_provenance',
    'modelled_peak_load_share',
    'target_headway_seconds',
    'mean_applied_hold_seconds',
    'decisions',
    ...['terminal_dispatch', 'two_way', 'self_equalizing', 'cost_optimal', 'boarding_limit'].map(
      (law) => `coverage_${law}`,
    ),
  ];

  const demandByCorridor = new Map(report.demand.map((entry) => [entry.routeDirectionId, entry.demand]));
  const rows = report.summaries.map((summary) => [
    summary.routeDirectionId,
    summary.scenario,
    summary.armName,
    String(summary.seeds),
    ...KPI_METRICS.flatMap((m) => {
      const d = summary.metrics[m.key];
      return [
        fmt(d.meanBaseline, 4),
        fmt(d.meanControlled, 4),
        fmt(d.meanDifference, 4),
        fmt(d.ciLow, 4),
        fmt(d.ciHigh, 4),
        String(d.significant),
        fmt(d.winRate, 3),
      ];
    }),
    fmt(summary.deniedShare, 4),
    fmt(demandByCorridor.get(summary.routeDirectionId)?.boardingRatePerMinute ?? null, 4),
    demandByCorridor.get(summary.routeDirectionId)?.provenance ?? '-',
    fmt(demandByCorridor.get(summary.routeDirectionId)?.peakLoadShare ?? null, 4),
    String(demandByCorridor.get(summary.routeDirectionId)?.targetHeadwaySeconds ?? '-'),
    fmt(summary.meanAppliedHoldSeconds, 1),
    String(summary.coverage.decisions),
    ...summary.coverage.laws.map((law) =>
      summary.coverage.decisions > 0
        ? fmt(law.generatedAt / summary.coverage.decisions, 4)
        : '-',
    ),
  ]);

  return [header, ...rows].map((row) => row.join(',')).join('\n') + '\n';
}

export function renderMarkdown(report: ExperimentReport): string {
  const lines: string[] = [];
  lines.push(`# Evaluation: ${report.name}`);
  lines.push('');
  lines.push(
    `${report.summaries.length} corridor/scenario/arm groups, generated ${report.generatedAt}, ${(report.durationMs / 1000).toFixed(1)}s.`,
  );
  lines.push('');

  if (report.corridorProvenance === 'synthetic') {
    lines.push(
      '> **Synthetic corridors.** These corridors do not exist. Their geometry is arithmetic, not survey. Use this run to check that the harness and the control laws behave, never as evidence about the network.',
    );
    lines.push('');
  }
  if (report.corridorProvenance === 'preset') {
    lines.push(
      '> **The three trial presets, not the network.** These are the urban / suburban / inter-city shapes from `fleetTrial/presets.ts` run through THIS harness, each under its own published modelled inputs. They exist here to be compared against the real corridors, and a preset row is evidence about a preset.',
    );
    lines.push('');
  }

  const outOfBand = report.controllability.filter((c) => c.controllability.band !== 'controllable');
  if (outOfBand.length > 0) {
    lines.push(
      `> **${outOfBand.length === report.controllability.length ? 'This corridor is' : `${outOfBand.length} corridor(s) are`} outside the band where holding can do anything.** ${outOfBand
        .map(
          (c) =>
            `\`${c.routeDirectionId}\`: one leg's running time varies by ${c.controllability.legTimeSigmaSeconds.toFixed(0)}s, ${(c.controllability.disturbanceRatio * 100).toFixed(0)}% of the headway [${c.controllability.band}]`,
        )
        .join('; ')}. ${outOfBand[0]!.controllability.note} **Read the uncontrolled arm before crediting or blaming the laws.**`,
    );
    lines.push('');
  }
  if (report.calibration.length === 0) {
    lines.push(
      '> **The traffic is modelled, the control is deployed.** Running time between stops, boarding and alighting rates, dwell, capacity and occupancy are invented (`rehearsal/run.ts#DEFAULT_MODELLED_INPUTS`); nothing in this system has ever recorded them. The control laws, their gains and their thresholds are the deployed ones. A gain tuned here is tuned against a demand model, and is a hypothesis to test on the network rather than a setting to trust. Run with `--calibrate` to fit dwell and travel time from recorded stop visits instead.',
    );
    lines.push('');
  } else {
    lines.push('## Calibration');
    lines.push('');
    lines.push(
      'Dwell and link travel time fitted from `stop_visits`; the boarding rate derived from the fitted `beta_h`. **The control laws are the deployed ones either way** — what changes here is whether the traffic they act on was observed or invented.',
    );
    lines.push('');
    for (const entry of report.calibration) {
      lines.push(`- **${entry.routeDirectionId}** — ${entry.description}`);
    }
    lines.push('');
    const uncalibrated = report.calibration.filter((entry) => !entry.calibrated);
    if (uncalibrated.length > 0) {
      lines.push(
        `> ${uncalibrated.length} of ${report.calibration.length} corridor(s) did not reach the calibration threshold, so their demand is still largely invented and their rows below are a hypothesis rather than a measurement.`,
      );
      lines.push('');
    }
  }
  if (report.demand.length > 0) {
    const overloaded = report.demand.filter((entry) => entry.demand.peakLoadShare >= 1);
    lines.push('## Demand');
    lines.push('');
    lines.push(
      'A stop boards `lambda x H` passengers and sheds `alightingFraction` of the load, so the load a modelled bus carries is **proportional to the corridor\'s own target headway**. One global boarding rate therefore runs a 3,600 s corridor at four times the load of a 900 s one, and this network\'s measured headways span 300 s to 12,497 s. Each corridor\'s rate and its modelled peak load against the seats:',
    );
    lines.push('');
    lines.push('| Corridor | H* (s) | Stops | Boardings/min | Provenance | Peak load / seats |');
    lines.push('|---|---:|---:|---:|---|---:|');
    for (const entry of report.demand) {
      lines.push(
        `| ${entry.routeDirectionId} | ${entry.demand.targetHeadwaySeconds} | ${entry.demand.stopCount} | ${fmt(entry.demand.boardingRatePerMinute, 3)} | \`${entry.demand.provenance}\` | ${entry.demand.peakLoad.toFixed(0)} / ${entry.demand.vehicleCapacity} (${pct(entry.demand.peakLoadShare)}) |`,
      );
    }
    lines.push('');
    if (overloaded.length > 0) {
      lines.push(
        `> **${overloaded.length} of ${report.demand.length} corridor(s) are over their seat count before any scenario runs.** Their wait metrics cannot respond to control whatever the laws do, and the saturation table below is the consequence, not a separate finding.`,
      );
      lines.push('');
    }
    const derived = report.demand.filter((entry) => entry.demand.provenance === 'derived').length;
    if (derived > 0) {
      lines.push(
        `> ${derived} corridor(s) ran on a DERIVED rate: inverted out of the corridor's own headway, stop count, alighting fraction and seats to hit a stated share of the seats. That is not a measurement - it is the same invention applied per corridor instead of once - and the share it targets is the one free parameter left (\`demand.ts#DERIVED_PEAK_LOAD_SHARE\`). A rate fitted from \`stop_visits\` beats it wherever one exists.`,
      );
      lines.push('');
    }
  }

  lines.push(
    '> **Not modelled: the command lifecycle.** Cooldowns, minimum action time, `max_concurrent_actions`, acknowledgement and TTL live in the command path. These numbers are what the control laws INTEND, not the rate at which instructions would reach a driver.',
  );
  lines.push('');

  if (report.saturated.length > 0) {
    lines.push('## Saturation warning');
    lines.push('');
    lines.push(
      `On the following, more than ${pct(SATURATION_WARN_SHARE)} of offered passengers could not board. When buses run at capacity, waiting time is bounded by how many seats exist rather than by how they are spaced, so **the EWT rows below cannot respond to control** and a "no effect" verdict on them is a statement about the demand model, not the controller. Read headway CV and bunching rate instead, and re-run with a capacity or boarding rate that leaves headroom.`,
    );
    lines.push('');
    lines.push('| Corridor | Arm | Denied share |');
    lines.push('|---|---|---|');
    for (const entry of report.saturated) {
      lines.push(`| ${entry.routeDirectionId} | ${entry.armName} | ${pct(entry.deniedShare)} |`);
    }
    lines.push('');
  }

  if (report.emptyCorridors.length > 0) {
    lines.push('## Corridors with no headway samples');
    lines.push('');
    lines.push(
      `Nothing is measurable on these and they contribute to no figure below: ${report.emptyCorridors.join(', ')}`,
    );
    lines.push('');
  }

  lines.push(renderHeadline(report.headlineScope));
  lines.push('');

  lines.push('## Control quality');
  lines.push('');
  lines.push(
    'Every figure is a **paired** difference: each seed drives the controlled arm and the no-control baseline on the identical corridor, scenario and demand draw, so the difference is the controller and nothing else. The interval is a 95% percentile bootstrap over seeds; a difference whose interval spans zero is reported as no effect however large its mean.',
  );
  lines.push('');

  for (const summary of report.summaries) {
    lines.push(
      `### ${summary.routeDirectionId} — ${summary.scenario} — arm \`${summary.armName}\` (${summary.seeds} seeds)`,
    );
    lines.push('');
    lines.push('| Metric | No control | Controlled | Change | 95% CI | Wins | Verdict |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const metric of KPI_METRICS) {
      const d = summary.metrics[metric.key];
      const change =
        d.meanRelativeDifference !== null
          ? `${fmt(d.meanDifference, 2)} (${pct(d.meanRelativeDifference)})`
          : fmt(d.meanDifference, 2);
      lines.push(
        `| ${metric.label}${metric.diagnostic ? ' *(diagnostic)*' : ''} | ${fmt(d.meanBaseline, 3)} | ${fmt(d.meanControlled, 3)} | ${change} | ${fmt(d.ciLow, 2)} … ${fmt(d.ciHigh, 2)} | ${pct(d.winRate)} | ${verdict(d, metric.lowerIsBetter)} |`,
      );
    }
    lines.push('');
    lines.push(
      `Mean hold applied per run: ${fmt(summary.meanAppliedHoldSeconds, 0)}s; refused by drivers: ${fmt(summary.meanRefusedHoldSeconds, 0)}s.`,
    );
    lines.push('');
    lines.push(renderCoverage(summary.coverage));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * The pooled verdict, and the pool it was taken over.
 *
 * The scope line comes FIRST because it is the thing that makes the number
 * below it readable. A top line pooled over saturated corridors is not a
 * weaker version of the truth; it is a different quantity, and one that moves
 * when the corridor set changes rather than when the controller does.
 */
function renderHeadline(scope: HeadlineScope): string {
  const lines: string[] = [];
  lines.push('## Network headline');
  lines.push('');
  if (scope.pooledGroups === 0) {
    lines.push(
      '**Nothing readable.** Every corridor/scenario group saturated, so there is no group whose wait metrics were free to respond to control. This is a statement about the demand model, not about the controller.',
    );
    return lines.join('\n');
  }
  lines.push(
    scope.scope === 'all'
      ? `Pooled over all ${scope.pooledGroups} corridor/scenario/arm groups; none saturated.`
      : `Pooled over the **${scope.pooledGroups}** corridor/scenario/arm groups whose wait metrics could respond to control. **${scope.excludedGroups}** group(s) on ${scope.excludedCorridors.length} corridor(s) are excluded because they saturated — they are still in the table below, and they are named in the saturation section above. Excluding them is the same rule the fleet trial's \`headlineScope\` applies, and for the same measured reason: pooling a group that cannot move does not average an effect, it dilutes one.`,
  );
  lines.push('');
  lines.push('| Metric | Good direction | Mean change | Groups better | No effect | Groups WORSE |');
  lines.push('|---|---|---:|---:|---:|---:|');
  for (const metric of KPI_METRICS) {
    const entry = scope.metrics[metric.key];
    lines.push(
      `| ${metric.label}${metric.diagnostic ? ' *(diagnostic)*' : ''} | ${metric.lowerIsBetter ? 'lower ↓' : 'higher ↑'} | ${pct(entry.meanRelativeDifference)} | ${entry.groupsBetter} | ${entry.groupsNoEffect} | ${entry.groupsWorse} |`,
    );
  }
  lines.push('');
  lines.push(
    'The change column is the mean of each group\'s own RELATIVE difference, never a mean of absolute seconds: these corridors run from a five-minute headway to a three-hour one, so a second of excess wait does not mean the same thing on each. A group counts as better only when its bootstrap interval excludes zero.',
  );
  lines.push('');
  lines.push(
    "**The change is `controlled - no control`, so read it against the direction column** — a *positive* total-passenger-time change means the controller SPENT passenger time, not saved it. The fleet trial publishes the same guardrail with the opposite sign (`passengerSecondsSavedPercent`, where positive means saved), and the two are easy to confuse in a handover.",
  );
  return lines.join('\n');
}

function renderCoverage(coverage: CoverageReport): string {
  const lines: string[] = [];
  lines.push('**Algorithm coverage**');
  lines.push('');
  if (coverage.decisions === 0) {
    lines.push('No decision points at all — no control point was reached with a bus ahead.');
    return lines.join('\n');
  }
  const share = (n: number) => pct(n / coverage.decisions);
  lines.push(
    `${coverage.decisions} decision points; ${share(coverage.withLeader)} had a bus ahead, ${share(coverage.withTrailer)} a bus behind (the precondition for two-way holding), ${share(coverage.atTerminal)} were at the origin terminal. ${share(coverage.actionsProposed)} ended in a hold.`,
  );
  lines.push('');
  lines.push('| Law | Generated | Selected | Most common reason for silence |');
  lines.push('|---|---|---|---|');
  for (const law of coverage.laws) {
    const reason = law.declineReasons[0];
    lines.push(
      `| \`${law.law}\` | ${share(law.generatedAt)} | ${share(law.selectedAt)} | ${reason ? `\`${reason.reason}\` (${share(reason.count)})` : '—'} |`,
    );
  }
  lines.push('');

  const silent = silentLaws(coverage);
  if (silent.length > 0) {
    lines.push(
      `> **${silent.length} law(s) never ran:** ${silent
        .map((entry) => `\`${entry.law}\` (${entry.reason ?? 'unknown'})`)
        .join(', ')}. The KPI table above is a verdict on the laws that DID run, not on the controller as a whole.`,
    );
    lines.push('');
  }

  if (coverage.safetyRejectionReasons.length > 0) {
    lines.push(
      `Safety filter rejections: ${coverage.safetyRejectionReasons
        .map((entry) => `\`${entry.reason}\` ${entry.count}`)
        .join(', ')}.`,
    );
  }
  return lines.join('\n');
}
