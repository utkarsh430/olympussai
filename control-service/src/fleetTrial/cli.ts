// The fleet trial's command line.
//
//   pnpm sim:fleet
//   pnpm sim:fleet --vehicles 200 --out experiments/runs/fleet
//   pnpm sim:fleet --speed link_average --scenarios slow_bus,traffic_shock
//
// Needs no database and no environment: the corridor is arithmetic and the
// demand is a model, so this runs anywhere. Writes nothing unless `--out` is
// given, and then only the report it just produced.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runFleetTrial, DEFAULT_FLEET_TRIAL_SPEC } from './run.js';
import { CORRIDOR_PRESETS } from './presets.js';
import type { CorridorPresetId } from './presets.js';
import { BUNCHING_SCENARIOS } from './scenarios.js';
import type { BunchingScenarioId } from './scenarios.js';
import type { ArmContrast, ArmReport, FleetTrialReport, PhaseReport } from './types.js';

const USAGE = `
Run the deployed control laws against a thousand buses on a 400 km corridor.

  --vehicles <n>     buses per phase (default ${DEFAULT_FLEET_TRIAL_SPEC.vehiclesPerPhase}); two phases, so twice this many in all
  --scenarios <list> comma-separated (default: all ${BUNCHING_SCENARIOS.length})
                     ${BUNCHING_SCENARIOS.map((s) => s.id).join(', ')}
  --corridor <shape> intercity | urban (default ${DEFAULT_FLEET_TRIAL_SPEC.corridorPreset})
                     ${Object.values(CORRIDOR_PRESETS).map((p) => `${p.id}: ${p.title}`).join('\n                     ')}
  --alighting        ACT on alighting-only proposals. Off by default, matching
                     production - measured, acting on them costs passenger time
  --seed <n>         base seed (default ${DEFAULT_FLEET_TRIAL_SPEC.seed})
  --speed <source>   link_average | vehicle_state (default ${DEFAULT_FLEET_TRIAL_SPEC.followerSpeedSource})
                     which end of production's speed-reporting range to run against
  --out <dir>        write report.json here
  --quiet            summary only
`;

interface Flags {
  corridor?: string;
  alighting: boolean;
  vehicles?: number;
  scenarios?: string;
  seed?: number;
  speed?: string;
  out?: string;
  quiet: boolean;
  help: boolean;
}

function parseFlags(argv: readonly string[]): Flags {
  const flags: Flags = { quiet: false, help: false, alighting: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--quiet') flags.quiet = true;
    else if (arg === '--alighting') flags.alighting = true;
    else if (arg === '--corridor') flags.corridor = argv[++i];
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--vehicles') flags.vehicles = Number(argv[++i]);
    else if (arg === '--scenarios') flags.scenarios = argv[++i];
    else if (arg === '--seed') flags.seed = Number(argv[++i]);
    else if (arg === '--speed') flags.speed = argv[++i];
    else if (arg === '--out') flags.out = argv[++i];
    else if (arg?.startsWith('--')) throw new Error(`Unknown flag ${arg}`);
  }
  return flags;
}

const hours = (seconds: number): string => `${(seconds / 3600).toFixed(0)}h`;
const pct = (value: number | null): string => (value === null ? '  -  ' : `${value.toFixed(1)}%`);

function renderArm(label: string, arm: ArmReport): string {
  return [
    `    ${label.padEnd(14)}`,
    `EWT ${arm.spacing.ewtSeconds?.toFixed(0) ?? '-'}s`.padEnd(12),
    `CV ${arm.spacing.headwayCv?.toFixed(3) ?? '-'}`.padEnd(11),
    `bunched ${(arm.spacing.bunchingRate * 100).toFixed(1)}%`.padEnd(15),
    `denied ${arm.spacing.deniedBoardings}`.padEnd(14),
    `incidents ${arm.incidents.detected} (${arm.incidents.resolved} resolved)`,
    arm.spacing.saturated ? '  [SATURATED - see report]' : '',
  ].join('');
}

function renderContrast(c: ArmContrast): string[] {
  return [
    `    excess wait      ${pct(c.ewtImprovementPercent)} better  (${c.ewtImprovementSeconds?.toFixed(0) ?? '-'}s per passenger)`,
    `    total passenger time  ${pct(c.passengerSecondsSavedPercent)}   waiting saved ${hours(c.waitSecondsSaved)}, onboard delay added ${hours(c.onboardDelayImposed)}`,
    `    punctuality      ${c.addedJourneySecondsPerVehicle === null ? '-' : `${(c.addedJourneySecondsPerVehicle / 60).toFixed(1)} min added per bus`}`,
    `    denied boardings ${c.additionalDeniedBoardings > 0 ? '+' : ''}${c.additionalDeniedBoardings}`,
  ];
}

function renderPhase(phase: PhaseReport): string[] {
  const lines = [
    '',
    `  ${phase.title}  (${phase.vehicleCount} buses, occupancy ${phase.weighOccupancy ? 'weighed' : 'ignored'})`,
    renderArm('no control', phase.uncontrolled),
    renderArm('controlled', phase.controlled),
    ...renderContrast(phase.contrast),
    `    alighting-only   ${phase.controlled.punctuality.alightingOnlyActions} instructions, ${phase.controlled.punctuality.alightingOnlyPassengersPassed} passengers left for the bus behind`,
    '',
    '    law coverage (decisions where the law produced a candidate):',
  ];
  for (const law of phase.lawCoverage) {
    const share = law.decisionsTotal > 0 ? (law.decisionsGenerating / law.decisionsTotal) * 100 : 0;
    lines.push(
      `      ${law.law.padEnd(18)} ${String(law.decisionsGenerating).padStart(5)}/${law.decisionsTotal}  ${share.toFixed(1).padStart(5)}%` +
        (law.commonestDecline ? `   mostly: ${law.commonestDecline}` : ''),
    );
  }
  return lines;
}

function renderReport(report: FleetTrialReport): string {
  const lines = [
    '',
    `FLEET TRIAL  ${report.corridor.routeName}`,
    `  ${report.corridorPreset.description}`,
    `  ${(report.corridor.totalDistanceMeters / 1000).toFixed(0)} km, ${report.corridor.stationCount} stations (${report.corridor.holdingPointCount} of them holding points), H* ${(report.corridor.targetHeadwaySeconds / 60).toFixed(0)} min`,
    `  ${report.vehiclesSimulated} buses simulated in ${(report.durationMs / 1000).toFixed(1)}s`,
  ];
  for (const phase of report.phases) lines.push(...renderPhase(phase));
  for (const study of report.policyStudies) {
    lines.push('', `  ${study.title}  (${study.knob}, ${study.seedsPerRow} seeds each)`);
    lines.push(
      '    setting              excess wait   total passenger time   hold/bus   worst bus   denied   seeds',
    );
    for (const row of study.rows) {
      const mark = row.label === study.recommended ? ' <-' : row.isCurrent ? '  (configured)' : '';
      lines.push(
        `      ${row.label.padEnd(18)}` +
          `${pct(row.ewtImprovementPercent).padStart(8)} better` +
          `${pct(row.passengerSecondsSavedPercent).padStart(16)}` +
          `${(row.meanHoldSecondsPerVehicle / 60).toFixed(1).padStart(9)} min` +
          `${(row.worstBusHoldSeconds / 60).toFixed(1).padStart(9)} min` +
          `${String(row.deniedBoardings).padStart(9)}` +
          `   ${row.seedsAgreeingWithSign}/${row.seedCount}${mark}`,
      );
    }
    lines.push(`    ${study.verdict}`);
  }
  lines.push('', '  What weighing passenger load changed:', `    ${report.occupancyContrast.verdict}`);
  lines.push('', '  Per scenario (excess wait, no control -> controlled):');
  for (const phase of report.phases) {
    lines.push(`    ${phase.id}`);
    for (const scenario of phase.scenarios) {
      lines.push(
        `      ${scenario.id.padEnd(24)} ${scenario.uncontrolled.spacing.ewtSeconds?.toFixed(0).padStart(4) ?? '   -'}s -> ${scenario.controlled.spacing.ewtSeconds?.toFixed(0).padStart(4) ?? '   -'}s` +
          `   incidents ${String(scenario.uncontrolled.incidents.detected).padStart(4)} -> ${String(scenario.controlled.incidents.detected).padStart(4)}` +
          `   net passenger time ${pct(scenario.contrast.passengerSecondsSavedPercent)}`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const scenarios = flags.scenarios
    ? (flags.scenarios.split(',').map((s) => s.trim()) as BunchingScenarioId[])
    : DEFAULT_FLEET_TRIAL_SPEC.scenarios;
  const known = new Set(BUNCHING_SCENARIOS.map((s) => s.id));
  for (const id of scenarios) {
    if (!known.has(id)) throw new Error(`Unknown scenario "${id}". Known: ${[...known].join(', ')}`);
  }
  if (flags.speed !== undefined && flags.speed !== 'link_average' && flags.speed !== 'vehicle_state') {
    throw new Error(`--speed must be link_average or vehicle_state, got "${flags.speed}"`);
  }
  const followerSpeedSource = flags.speed ?? DEFAULT_FLEET_TRIAL_SPEC.followerSpeedSource;

  if (flags.corridor !== undefined && !(flags.corridor in CORRIDOR_PRESETS)) {
    throw new Error(
      `--corridor must be one of ${Object.keys(CORRIDOR_PRESETS).join(', ')}, got "${flags.corridor}"`,
    );
  }

  const report = runFleetTrial(
    {
      ...DEFAULT_FLEET_TRIAL_SPEC,
      corridorPreset: (flags.corridor ?? DEFAULT_FLEET_TRIAL_SPEC.corridorPreset) as CorridorPresetId,
      alightingOnlySelectable: flags.alighting,
      vehiclesPerPhase: flags.vehicles ?? DEFAULT_FLEET_TRIAL_SPEC.vehiclesPerPhase,
      scenarios,
      seed: flags.seed ?? DEFAULT_FLEET_TRIAL_SPEC.seed,
      followerSpeedSource,
    },
    flags.quiet
      ? undefined
      : (done, total, label) => process.stderr.write(`  ${done}/${total}  ${label}\n`),
  );

  process.stdout.write(renderReport(report));

  if (flags.out) {
    const dir = resolve(flags.out);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
    process.stdout.write(`  report written to ${join(dir, 'report.json')}\n\n`);
  }
}

main();
