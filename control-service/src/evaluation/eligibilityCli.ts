// The corridor-eligibility report's entry point.
//
//   pnpm sim:eligibility
//   pnpm sim:eligibility --out experiments/runs/eligibility
//   pnpm sim:eligibility --travel-time-variation 0.20 --quiet
//   pnpm sim:eligibility --calibrate --verdict out_of_band --limit 40
//
// Writes nothing to any database - SELECTs only, exactly like `sim:run`. It
// answers ONE question per route-direction: should the controller be deployed
// on this corridor at all? The verdict comes from `evaluation/eligibility.ts`
// and the band it rests on comes from `lib/controllability.ts`; nothing here
// defines a threshold of its own.
//
// ─── READ THE PROVENANCE LINE BEFORE THE VERDICTS ────────────────────────
//
// sigma_leg is `meanLeg / cruiseSpeed x travelTimeVariation`. The target
// headway and the geometry are measured, but those two running-time inputs are
// fitted only where `stop_visits` has enough recorded traversals - and on a
// network whose stop-visit log is empty they are assumptions, which makes the
// BAND an assumption too. The report says which for every row, prints a
// sensitivity table over the assumed variation when nothing was fitted, and
// refuses to present a modelled verdict as a measured one.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '../config/env.js';
import { closePool } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import { CONTROLLABLE_BAND } from '../lib/controllability.js';
import { calibrateCorridor } from './calibrate.js';
import {
  assessCorridorEligibility,
  measuredAssumptionsFromFittedLinks,
  summariseEligibility,
  MINIMUM_VEHICLES_FOR_A_DECISION,
  type ControllabilityAssumptions,
  type CorridorEligibility,
  type CorridorShape,
  type EligibilityVerdict,
} from './eligibility.js';
import {
  loadCorridorShapes,
  loadRecommendationVolume,
} from './eligibilityRepository.js';

const VERDICTS: readonly EligibilityVerdict[] = [
  'eligible',
  'out_of_band',
  'uncalibrated',
  'too_few_vehicles',
];

/** Variations the sensitivity table is re-run at. Spans the three trial corridors' fitted spreads (0.14-0.18) and beyond. */
const SENSITIVITY_VARIATIONS = [0.06, 0.09, 0.12, 0.16, 0.2, 0.3] as const;

interface Flags {
  routeDirectionIds?: string[];
  freshness?: number;
  cruiseSpeed?: number;
  travelTimeVariation?: number;
  recommendationsSinceHours: number;
  calibrate: boolean;
  verdicts?: EligibilityVerdict[];
  limit: number;
  out?: string;
  quiet: boolean;
  help: boolean;
}

const USAGE = `
Which corridors the bunching controller should be deployed on, and which it cannot help.

  --route-directions <ids>       comma-separated route-direction ids. Default: every ACTIVE one.
  --freshness <s>                live-vehicle window. Default HEADWAY_VEHICLE_FRESHNESS_SECONDS.
  --cruise-speed <kmph>          assumed cruise speed. Default ELIGIBILITY_CRUISE_SPEED_KMPH.
  --travel-time-variation <v>    assumed running-time spread, 0-1. Default ELIGIBILITY_TRAVEL_TIME_VARIATION.
  --calibrate                    derive both of the above per corridor from fitted link travel
                                 times where enough of the corridor fitted. Needs a populated
                                 stop_visits; a corridor with too few stays modelled and says so.
  --verdict <list>               comma-separated filter for the per-corridor table:
                                 ${VERDICTS.join(', ')}
  --limit <n>                    rows in the console table. Default 25. The dump is never limited.
  --recommendations-since <h>    lookback for the recommendation-volume share. Default 720 (30 days).
  --out <dir>                    write eligibility.json, eligibility.csv and eligibility.md here.
  --quiet                        suppress the console report.

Everything is read-only. This report decides nothing on its own: the decision cycle
only acts on it when DECISION_CYCLE_ELIGIBILITY_GATE_ENABLED is turned on, and it ships off.
`;

function parseFlags(argv: readonly string[]): Flags {
  const flags: Flags = {
    calibrate: false,
    limit: 25,
    recommendationsSinceHours: 720,
    quiet: false,
    help: false,
  };
  const number = (raw: string | undefined, name: string): number => {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${name} needs a number, got ${raw ?? '(nothing)'}`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--calibrate') flags.calibrate = true;
    else if (arg === '--quiet') flags.quiet = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--route-directions')
      flags.routeDirectionIds = (argv[++i] ?? '').split(',').map((v) => v.trim()).filter(Boolean);
    else if (arg === '--freshness') flags.freshness = number(argv[++i], '--freshness');
    else if (arg === '--cruise-speed') flags.cruiseSpeed = number(argv[++i], '--cruise-speed');
    else if (arg === '--travel-time-variation')
      flags.travelTimeVariation = number(argv[++i], '--travel-time-variation');
    else if (arg === '--recommendations-since')
      flags.recommendationsSinceHours = number(argv[++i], '--recommendations-since');
    else if (arg === '--limit') flags.limit = number(argv[++i], '--limit');
    else if (arg === '--out') flags.out = argv[++i];
    else if (arg === '--verdict') {
      const requested = (argv[++i] ?? '').split(',').map((v) => v.trim()).filter(Boolean);
      const unknown = requested.filter((v) => !VERDICTS.includes(v as EligibilityVerdict));
      if (unknown.length > 0) throw new Error(`Unknown verdict(s): ${unknown.join(', ')}`);
      flags.verdicts = requested as EligibilityVerdict[];
    } else if (arg?.startsWith('--')) throw new Error(`Unknown flag ${arg}`);
  }
  return flags;
}

/** The band's own share of a set, as a percentage string. Zero-safe, because an empty network is a real answer. */
function share(part: number, whole: number): string {
  return whole === 0 ? '-' : `${((part / whole) * 100).toFixed(1)}%`;
}

interface ReportInput {
  verdicts: readonly CorridorEligibility[];
  shapes: readonly CorridorShape[];
  defaults: ControllabilityAssumptions;
  recommendationsByRouteDirection: ReadonlyMap<string, number>;
  recommendationsSinceHours: number;
  freshnessSeconds: number;
  calibrateRequested: boolean;
}

/**
 * The report, in Markdown, so it can be pasted into a decision record.
 *
 * Structured deliberately as: what would be excluded, then what that costs in
 * buses and in advice, then how sensitive it is to the assumed inputs, then
 * the corridors themselves. An operator reading only the first two sections
 * has the decision; a reader who distrusts it has the third.
 */
function renderMarkdown(input: ReportInput, limit: number, filter?: readonly EligibilityVerdict[]): string {
  const { verdicts, defaults } = input;
  const summary = summariseEligibility(verdicts);
  const measuredRows = verdicts.filter((v) => v.inputs.provenance === 'measured').length;

  const totalRecommendations = [...input.recommendationsByRouteDirection.values()].reduce(
    (a, b) => a + b,
    0,
  );
  const excludedRecommendations = verdicts
    .filter((v) => !v.eligible)
    .reduce((sum, v) => sum + (input.recommendationsByRouteDirection.get(v.routeDirectionId) ?? 0), 0);

  // What the GATE would exclude, as distinct from what is ineligible overall.
  // The gate sees only corridors the decision cycle already accepts - measured
  // and carrying a live pair - so the band is the only thing it removes.
  const gateVisible = verdicts.filter(
    (v) =>
      v.targetHeadwaySeconds !== null && v.vehicleCount >= MINIMUM_VEHICLES_FOR_A_DECISION,
  );
  const gateExcluded = gateVisible.filter((v) => v.controllability?.band !== 'controllable');

  const lines: string[] = [
    '# Corridor eligibility: where the controller can work',
    '',
    `Every ACTIVE route-direction on this network, ${verdicts.length} of them, placed against the`,
    'controllability band in `lib/controllability.ts`',
    `(\`CONTROLLABLE_BAND\` = ${CONTROLLABLE_BAND.low}-${CONTROLLABLE_BAND.high} of sigma_leg / H*).`,
    'Read-only; this report changes nothing.',
    '',
    '## Provenance of the running-time inputs',
    '',
    measuredRows === verdicts.length && verdicts.length > 0
      ? `Every corridor's cruise speed and running-time spread was FITTED from its own recorded stop visits.`
      : `> **${verdicts.length - measuredRows} of ${verdicts.length} verdicts rest on ASSUMED running-time inputs** ` +
        `(cruise ${defaults.cruiseSpeedKmph} km/h, variation ${defaults.travelTimeVariation}), because ` +
        `${input.calibrateRequested ? 'too little of those corridors fitted' : 'no fit was requested (`--calibrate`)'}. ` +
        'sigma_leg is `meanLeg / cruiseSpeed x travelTimeVariation`, so the BAND those corridors land in is a ' +
        'property of two numbers nobody measured on them. The sensitivity table below is how much that matters.',
    '',
    `Live-vehicle window: ${input.freshnessSeconds}s.`,
    '',
    '## Verdicts',
    '',
    '| Verdict | Corridors | Share | Vehicles |',
    '| --- | ---: | ---: | ---: |',
  ];

  for (const verdict of VERDICTS) {
    const rows = verdicts.filter((v) => v.verdict === verdict);
    const vehicles = rows.reduce((sum, v) => sum + v.vehicleCount, 0);
    lines.push(
      `| \`${verdict}\` | ${rows.length} | ${share(rows.length, verdicts.length)} | ${vehicles} |`,
    );
  }

  lines.push(
    '',
    '| Band | Corridors |',
    '| --- | ---: |',
    `| \`too_regular\` | ${summary.byBand.too_regular} |`,
    `| \`controllable\` | ${summary.byBand.controllable} |`,
    `| \`too_disturbed\` | ${summary.byBand.too_disturbed} |`,
    `| no band (uncalibrated) | ${summary.withoutBand} |`,
    '',
    '## What the eligibility gate would exclude',
    '',
    'The gate sits inside the decision cycle and sees only corridors that sweep already',
    'accepts - calibrated, and carrying at least two live vehicles - so the band is the only',
    'thing it removes. Everything else in the table above is already refused upstream.',
    '',
    `- Corridors the decision cycle reaches today: **${gateVisible.length}**`,
    `- Of those, outside the band: **${gateExcluded.length}** (${share(gateExcluded.length, gateVisible.length)})`,
    `- Vehicles on the excluded corridors: **${gateExcluded.reduce((s, v) => s + v.vehicleCount, 0)}** of ` +
      `${gateVisible.reduce((s, v) => s + v.vehicleCount, 0)}`,
    totalRecommendations === 0
      ? `- Recommendation volume in the last ${input.recommendationsSinceHours}h: **none recorded**, so no share can be reported.`
      : `- Recommendations written in the last ${input.recommendationsSinceHours}h that would not have been: ` +
        `**${excludedRecommendations} of ${totalRecommendations}** (${share(excludedRecommendations, totalRecommendations)})`,
    '',
    '## Sensitivity to the assumed running-time spread',
    '',
    'The band is a ratio of sigma_leg, which scales linearly with the assumed variation. If the',
    'verdict moves a long way across this row, the verdict is about the assumption and not about',
    'the network.',
    '',
    '| travelTimeVariation | too_regular | controllable | too_disturbed |',
    '| ---: | ---: | ---: | ---: |',
  );

  // The default in use is always one of the rows, whatever it is, so the
  // reader can see their own setting in the same column as the alternatives.
  const variations = [...new Set([...SENSITIVITY_VARIATIONS, defaults.travelTimeVariation])].sort(
    (a, b) => a - b,
  );
  for (const variation of variations) {
    const swept = summariseEligibility(
      input.shapes.map((shape) =>
        assessCorridorEligibility(shape, { ...defaults, travelTimeVariation: variation }),
      ),
    );
    const marker = variation === defaults.travelTimeVariation ? ' **(default)**' : '';
    lines.push(
      `| ${variation}${marker} | ${swept.byBand.too_regular} | ${swept.byBand.controllable} | ${swept.byBand.too_disturbed} |`,
    );
  }

  const shown = filter ? verdicts.filter((v) => filter.includes(v.verdict)) : verdicts;
  lines.push(
    '',
    `## Corridors${filter ? ` (${filter.join(', ')})` : ''}`,
    '',
    shown.length > limit
      ? `First ${limit} of ${shown.length}, worst-placed first. The \`--out\` dump carries all of them.`
      : `${shown.length} corridor(s), worst-placed first.`,
    '',
    '| route-direction | route | dir | H* (s) | calibration | stops | buses | sigma_leg (s) | sigma/H* | band | verdict |',
    '| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | --- | --- |',
  );

  for (const row of [...shown].sort(orderWorstFirst).slice(0, limit)) {
    lines.push(
      `| \`${row.routeDirectionId}\` | ${row.routeName ?? '-'} | ${row.directionCode} | ` +
        `${row.targetHeadwaySeconds ?? '-'} | ${row.calibrationSource ?? 'none'} | ${row.stopCount} | ` +
        `${row.vehicleCount} | ${row.controllability?.legTimeSigmaSeconds.toFixed(0) ?? '-'} | ` +
        `${row.controllability ? row.controllability.disturbanceRatio.toFixed(3) : '-'} | ` +
        `${row.controllability?.band ?? '-'} | \`${row.verdict}\` |`,
    );
  }

  lines.push(
    '',
    '## Acting on this',
    '',
    'Nothing here changes what the controller does. `DECISION_CYCLE_ELIGIBILITY_GATE_ENABLED`',
    'is the switch, it ships OFF, and its own docblock in `config/env.ts` carries the',
    'precondition for turning it on: the band must be decided on fitted running times, which',
    'needs a populated `stop_visits`. Until this report reads `measured` for the corridors it',
    'would exclude, it is a rollout PRIORITY ORDER - control the in-band corridors first - and',
    'not a licence to switch corridors off.',
    '',
  );

  return lines.join('\n');
}

/**
 * Worst-placed first, and "worst" means MOST ACTIONABLE rather than most
 * broken. `out_of_band` leads because it is the finding: a calibrated corridor
 * carrying a live pair that the controller is nonetheless spending effort on
 * for nothing. An uncalibrated corridor is already refused upstream and a
 * corridor with one bus is a scheduling fact, not a deployment decision.
 */
const TABLE_SEVERITY: Record<EligibilityVerdict, number> = {
  out_of_band: 0,
  uncalibrated: 1,
  too_few_vehicles: 2,
  eligible: 3,
};

function orderWorstFirst(a: CorridorEligibility, b: CorridorEligibility): number {
  return (
    TABLE_SEVERITY[a.verdict] - TABLE_SEVERITY[b.verdict] ||
    (b.controllability?.disturbanceRatio ?? 0) - (a.controllability?.disturbanceRatio ?? 0) ||
    a.routeDirectionId.localeCompare(b.routeDirectionId)
  );
}

function renderCsv(verdicts: readonly CorridorEligibility[]): string {
  const header = [
    'route_direction_id',
    'route_name',
    'direction_code',
    'target_headway_seconds',
    'calibration_source',
    'stop_count',
    'vehicle_count',
    'cruise_speed_kmph',
    'travel_time_variation',
    'inputs_provenance',
    'leg_time_sigma_seconds',
    'disturbance_ratio',
    'band',
    'verdict',
    'eligible',
    'reasons',
  ].join(',');

  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = [...verdicts].sort(orderWorstFirst).map((row) =>
    [
      row.routeDirectionId,
      escape(row.routeName ?? ''),
      row.directionCode,
      row.targetHeadwaySeconds ?? '',
      row.calibrationSource ?? '',
      row.stopCount,
      row.vehicleCount,
      row.inputs.cruiseSpeedKmph.toFixed(3),
      row.inputs.travelTimeVariation.toFixed(4),
      row.inputs.provenance,
      row.controllability?.legTimeSigmaSeconds.toFixed(3) ?? '',
      row.controllability?.disturbanceRatio.toFixed(6) ?? '',
      row.controllability?.band ?? '',
      row.verdict,
      row.eligible,
      escape(row.reasons.join(' ')),
    ].join(','),
  );
  return `${[header, ...rows].join('\n')}\n`;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    process.stdout.write(USAGE);
    return;
  }

  const env = loadEnv();
  const defaults: ControllabilityAssumptions = {
    cruiseSpeedKmph: flags.cruiseSpeed ?? env.ELIGIBILITY_CRUISE_SPEED_KMPH,
    travelTimeVariation: flags.travelTimeVariation ?? env.ELIGIBILITY_TRAVEL_TIME_VARIATION,
    provenance: 'modelled',
  };
  const freshnessSeconds = flags.freshness ?? env.HEADWAY_VEHICLE_FRESHNESS_SECONDS;
  const log = (message: string) => {
    if (!flags.quiet) process.stderr.write(`${message}\n`);
  };

  const shapes = await loadCorridorShapes({
    freshnessSeconds,
    routeDirectionIds: flags.routeDirectionIds,
  });
  if (shapes.length === 0) {
    throw new AppError(
      'no_active_route_directions',
      flags.routeDirectionIds
        ? `None of the ${flags.routeDirectionIds.length} requested route-direction(s) is active.`
        : 'No active route-direction exists to report on. Seed the network first.',
      404,
    );
  }
  log(`${shapes.length} active route-direction(s)`);

  // Fitted running times, when asked for. Per corridor rather than
  // all-or-nothing, and a corridor that fitted too little keeps the modelled
  // assumptions and SAYS so in its own row - the same rule `sim:run --calibrate`
  // follows, and for the same reason.
  const verdicts: CorridorEligibility[] = [];
  for (const shape of shapes) {
    let inputs = defaults;
    if (flags.calibrate) {
      const fitted = await calibrateCorridor({
        routeDirectionId: shape.routeDirectionId,
        stops: (shape.stopIds ?? []).map((stopId) => ({ stopId })),
      });
      inputs =
        measuredAssumptionsFromFittedLinks(
          shape,
          fitted.overrides.linkByToStopId ?? new Map(),
        ) ?? defaults;
    }
    verdicts.push(assessCorridorEligibility(shape, inputs));
  }

  const recommendationsByRouteDirection = await loadRecommendationVolume(
    flags.recommendationsSinceHours,
  );

  const markdown = renderMarkdown(
    {
      verdicts,
      shapes,
      defaults,
      recommendationsByRouteDirection,
      recommendationsSinceHours: flags.recommendationsSinceHours,
      freshnessSeconds,
      calibrateRequested: flags.calibrate,
    },
    flags.limit,
    flags.verdicts,
  );

  if (!flags.quiet) process.stdout.write(`${markdown}\n`);

  if (flags.out) {
    mkdirSync(flags.out, { recursive: true });
    const files: Record<string, string> = {
      'eligibility.md': `${markdown}\n`,
      'eligibility.csv': renderCsv(verdicts),
      'eligibility.json': `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          band: CONTROLLABLE_BAND,
          assumptions: defaults,
          freshnessSeconds,
          summary: summariseEligibility(verdicts),
          corridors: [...verdicts].sort(orderWorstFirst),
        },
        null,
        2,
      )}\n`,
    };
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(flags.out, name), contents, 'utf8');
    }
    log(`wrote ${flags.out}`);
  }
}

main()
  .catch((error: unknown) => {
    if (error instanceof AppError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
    } else {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    }
    process.exitCode = 1;
  })
  // The report is a one-shot read, so the pool must not hold the process open
  // the way a long-running service's does.
  .finally(() => closePool());
