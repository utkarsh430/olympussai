// The evaluation harness's entry point.
//
//   pnpm sim:run --corridors synthetic --scenarios none --seeds 5
//   pnpm sim:run --config experiments/baseline.json --out experiments/runs/baseline
//   pnpm sim:run --sweep --corridors sample:10 --out experiments/runs/sweep
//
// Writes nothing to any database. `--corridors sample:N` and explicit route
// direction ids read from Postgres (SELECTs only, through the same reader the
// live detection path uses); `--corridors synthetic` needs no database at
// all, which is what lets the harness be run and tested anywhere.
//
// A sweep PRINTS the SQL its recommendation implies and does not run it. See
// `sweep.ts#renderApplySql` for why that is not a missing feature.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { selectCorridors } from './corridors.js';
import { parseExperimentSpec, type ExperimentSpec } from './spec.js';
import { runExperiment } from './runner.js';
import { buildReport, renderCsv, renderMarkdown } from './report.js';
import { sweepCorridor, renderApplySql, DEFAULT_COARSE_GRID } from './sweep.js';
import { runComplianceSweep, runVariabilitySweep, renderCurve } from './robustness.js';
import { calibrateCorridor, describeCalibration, type CorridorCalibration } from './calibrate.js';
import { DERIVED_PEAK_LOAD_SHARE } from './demand.js';
import { resolveInputs } from './spec.js';
import { REHEARSAL_DISTURBANCES } from '../rehearsal/run.js';
import { AppError } from '../lib/errors.js';

interface Flags {
  config?: string;
  corridors?: string;
  scenarios?: string;
  seeds?: string;
  out?: string;
  demand?: string;
  peakLoadShare?: string;
  sweep: boolean;
  calibrate: boolean;
  quiet: boolean;
  help: boolean;
}

function parseFlags(argv: readonly string[]): Flags {
  const flags: Flags = { sweep: false, calibrate: false, quiet: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--sweep') flags.sweep = true;
    else if (arg === '--calibrate') flags.calibrate = true;
    else if (arg === '--quiet') flags.quiet = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--config') flags.config = argv[++i];
    else if (arg === '--corridors') flags.corridors = argv[++i];
    else if (arg === '--scenarios') flags.scenarios = argv[++i];
    else if (arg === '--seeds') flags.seeds = argv[++i];
    else if (arg === '--out') flags.out = argv[++i];
    else if (arg === '--demand') flags.demand = argv[++i];
    else if (arg === '--peak-load-share') flags.peakLoadShare = argv[++i];
    else if (arg?.startsWith('--')) throw new Error(`Unknown flag ${arg}`);
  }
  return flags;
}

const USAGE = `
Evaluate the deployed bunching control laws in the mesoscopic simulator.

  --config <path>       experiment spec JSON. Every other flag overrides it.
  --corridors <source>  "synthetic", "synthetic:N", "sample:N", "eligible[:N]",
                        "in-band[:N]", "preset", or a comma-separated list of
                        route-direction ids. Default: synthetic:1
                          eligible  the corridors sim:eligibility passes: calibrated,
                                    inside the controllable band AT THIS RUN'S assumed
                                    running-time spread, and carrying two live buses.
                          in-band   the same without the live-vehicle snapshot, which
                                    is the corridor-intrinsic and reproducible question.
                          preset    the three fleet-trial shapes, each under its own
                                    published inputs, for comparing against the network.
  --scenarios <list>    comma-separated, or "all". One of: ${REHEARSAL_DISTURBANCES.join(', ')}
  --seeds <n>           seeds per cell. Default 20.
  --sweep               search the gain grid instead of comparing fixed arms.
  --calibrate           fit dwell and link travel time from recorded stop visits
                        instead of using the invented demand profile. Needs a
                        database and a populated stop_visits; a corridor with no
                        visits stays modelled and the report says so.
  --out <dir>           write results.json, summary.csv, summary.md and spec.json here.
  --demand <mode>       "derived" (default) sizes each corridor's boarding rate from its
                        own headway, stop count, alighting fraction and seats; "global"
                        applies the one invented rate to every corridor, which is what
                        this harness did before and what saturated every real corridor.
  --peak-load-share <s> load the derived rate aims at, as a share of the seats.
                        Default ${DERIVED_PEAK_LOAD_SHARE}. Sweep it: a verdict that moves a
                        long way across it is a verdict about this assumption.
  --quiet               suppress the console summary.

Everything is read-only. A sweep prints the SQL it would apply; it never applies it.
`;

function corridorsFromFlag(value: string | undefined): ExperimentSpec['corridors'] {
  if (!value || value === 'synthetic') return { source: 'synthetic', count: 1 };
  if (value === 'preset') return { source: 'preset' };
  if (value.startsWith('synthetic:')) {
    return { source: 'synthetic', count: Number(value.slice('synthetic:'.length)) };
  }
  if (value.startsWith('sample:')) {
    return { source: 'db', sample: Number(value.slice('sample:'.length)) };
  }
  for (const [prefix, requireLivePair] of [
    ['eligible', true],
    ['in-band', false],
  ] as const) {
    if (value === prefix) return { source: 'eligible', requireLivePair };
    if (value.startsWith(`${prefix}:`)) {
      return { source: 'eligible', requireLivePair, sample: Number(value.slice(prefix.length + 1)) };
    }
  }
  return { source: 'db', routeDirectionIds: value.split(',').map((id) => id.trim()).filter(Boolean) };
}

function buildSpec(flags: Flags): ExperimentSpec {
  const base: unknown = flags.config
    ? JSON.parse(readFileSync(resolve(flags.config), 'utf8'))
    : {
        name: flags.sweep ? 'gain-sweep' : 'baseline',
        corridors: { source: 'synthetic', count: 1 },
        seeds: { count: 20, base: 20260820 },
        // As configured today: the arm every sweep candidate is measured
        // against, and on its own a straight answer to "does the deployed
        // controller help at all".
        arms: [{ name: 'as-deployed', policyOverrides: {} }],
      };

  const spec = parseExperimentSpec(base);
  if (flags.corridors) spec.corridors = corridorsFromFlag(flags.corridors);
  if (flags.scenarios) {
    spec.scenarios =
      flags.scenarios === 'all'
        ? [...REHEARSAL_DISTURBANCES]
        : flags.scenarios.split(',').map((s) => s.trim());
  }
  if (flags.seeds) spec.seeds = { ...spec.seeds, count: Number(flags.seeds) };
  if (flags.demand) {
    if (flags.demand !== 'derived' && flags.demand !== 'global') {
      throw new Error(`--demand takes "derived" or "global", got ${flags.demand}`);
    }
    spec.demand = { ...spec.demand, mode: flags.demand };
  }
  if (flags.peakLoadShare) {
    spec.demand = { ...spec.demand, peakLoadShare: Number(flags.peakLoadShare) };
  }
  return parseExperimentSpec(spec);
}

function writeOut(dir: string, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents, 'utf8');
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    process.stdout.write(USAGE);
    return;
  }

  const spec = buildSpec(flags);
  // The band a corridor lands in is a ratio of sigma_leg, which scales with
  // the running-time spread - so the corridors an `eligible` run selects have
  // to be selected under the spread that run will SIMULATE at, not under the
  // eligibility CLI's own default. Anything else selects one set of corridors
  // and reports on another.
  const runInputs = resolveInputs(spec, spec.seeds.base, 'none');
  const { corridors, provenance, presetInputs, excluded } = await selectCorridors(spec.corridors, {
    cruiseSpeedKmph: runInputs.cruiseSpeedKmph,
    travelTimeVariation: runInputs.travelTimeVariation,
    provenance: 'modelled',
  });
  const log = (message: string) => {
    if (!flags.quiet) process.stderr.write(`${message}\n`);
  };
  log(`${spec.name}: ${corridors.length} corridor(s) (${provenance}), ${spec.scenarios.length} scenario(s)`);
  if (excluded && excluded.length > 0) {
    log(`  ${excluded.length} route-direction(s) not evaluated (see spec.json / excluded.json)`);
  }
  // The resolved ids are written back with the run. `eligible` reads a LIVE
  // vehicle count inside a 300 s window, so the same flag on the same database
  // does not select the same corridors an hour later; a spec that carries the
  // ids it resolved to is the only thing that makes the run re-runnable.
  if (spec.corridors.source === 'eligible') {
    spec.corridors = {
      source: 'db',
      routeDirectionIds: corridors.map((corridor) => corridor.routeDirectionId),
    };
  }

  // Fitted demand, when asked for. Attempted per corridor rather than as an
  // all-or-nothing switch: a corridor with no recorded visits keeps the
  // invented profile and the report names it, because dropping it would
  // silently shrink the experiment and substituting another corridor's fit
  // would be worse than inventing.
  const calibration = new Map<string, CorridorCalibration>();
  if (flags.calibrate) {
    if (provenance === 'synthetic') {
      throw new AppError(
        'invalid_request',
        'Synthetic corridors have no recorded stop visits to calibrate from. Use --corridors sample:N or an explicit route-direction id.',
        400,
      );
    }
    for (const corridor of corridors) {
      const fitted = await calibrateCorridor(corridor);
      calibration.set(corridor.routeDirectionId, fitted);
      log(`  ${corridor.routeDirectionId}: ${describeCalibration(fitted)}`);
    }
  }

  if (flags.sweep) {
    const sql: string[] = [];
    const markdown: string[] = [`# Gain sweep: ${spec.name}`, ''];
    for (const corridor of corridors) {
      const result = sweepCorridor(spec, corridor, { onProgress: log });
      markdown.push(`## ${corridor.routeDirectionId}`, '');
      const baseHeadline = result.baselinePoint.headline;
      markdown.push(
        `As configured: excess-wait change vs no control ${baseHeadline?.toFixed(2) ?? '-'}s.`,
        '',
      );
      if (result.silentLaws.length > 0) {
        markdown.push(
          `> **A law being tuned never ran.** ${result.silentLaws
            .map((entry) => `\`${entry.law}\` (tuning ${entry.tunes.join(', ')})`)
            .join(', ')}. A flat response surface for those parameters means UNMEASURED, not insensitive — do not read "no better setting found" as "the setting does not matter".`,
          '',
        );
      }
      if (result.best) {
        markdown.push(
          `**Recommended:** \`${JSON.stringify(result.best.overrides)}\` — excess-wait change ${result.best.headline?.toFixed(2)}s.`,
          '',
        );
      } else {
        markdown.push(
          `**No recommendation.** Nothing beat the current setting with an interval excluding zero and every guardrail intact. Closest candidate was disqualified because: ${
            result.evaluated[0]?.disqualifiedBecause.join('; ') ?? 'nothing was evaluated'
          }`,
          '',
        );
      }
      // The robustness curves the reference architecture requires before a
      // recommendation is reportable, run on the WINNER only - they are the
      // expensive part, and a curve for a candidate nobody would deploy is
      // work spent on a question nobody asked.
      const winningArm = result.best
        ? { name: 'recommended', policyOverrides: result.best.overrides }
        : spec.arms[0];
      if (winningArm && spec.complianceSweep.length > 0) {
        markdown.push(renderCurve(runComplianceSweep(spec, corridor, winningArm, spec.complianceSweep)), '');
      }
      if (winningArm && spec.variabilitySweep.length > 0) {
        markdown.push(renderCurve(runVariabilitySweep(spec, corridor, winningArm, spec.variabilitySweep)), '');
      }

      sql.push(renderApplySql(result));
      log(
        `${corridor.routeDirectionId}: ${result.best ? `best ${JSON.stringify(result.best.overrides)}` : 'no recommendation'}`,
      );
    }
    markdown.push(
      '## Applying this',
      '',
      'The SQL in `apply.sql` is printed, not run. It is tuned against a modelled demand profile — running time, boarding rate and dwell are invented (`rehearsal/run.ts#DEFAULT_MODELLED_INPUTS`) because nothing in this system has recorded them. Treat a recommendation as a hypothesis to test on one corridor, not a setting to roll out.',
      '',
    );
    const rendered = markdown.join('\n');
    if (!flags.quiet) process.stdout.write(`${rendered}\n`);
    if (flags.out) {
      writeOut(flags.out, {
        'spec.json': `${JSON.stringify(spec, null, 2)}\n`,
        'sweep.md': `${rendered}\n`,
        'apply.sql': `${sql.join('\n')}\n`,
        'grid.json': `${JSON.stringify(DEFAULT_COARSE_GRID, null, 2)}\n`,
      });
      log(`wrote ${flags.out}`);
    }
    return;
  }

  const run = runExperiment(
    spec,
    corridors,
    provenance,
    (done, total) => log(`  ${done}/${total} cells`),
    calibration,
    presetInputs,
  );
  const report = buildReport(run);
  const markdown = renderMarkdown(report);
  if (!flags.quiet) process.stdout.write(`${markdown}\n`);

  if (flags.out) {
    writeOut(flags.out, {
      'spec.json': `${JSON.stringify(spec, null, 2)}\n`,
      'results.json': `${JSON.stringify({ report, cells: run.cells }, null, 2)}\n`,
      'summary.csv': renderCsv(report),
      'summary.md': `${markdown}\n`,
      'excluded.json': `${JSON.stringify(excluded ?? [], null, 2)}\n`,
    });
    log(`wrote ${flags.out}`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof AppError) {
    process.stderr.write(`${error.code}: ${error.message}\n`);
  } else {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  }
  process.exitCode = 1;
});
