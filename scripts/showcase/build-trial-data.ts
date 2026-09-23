/**
 * Build `src/lib/showcase/generated/trialData.json` from real fleet-trial reports.
 *
 *   pnpm showcase:build-data /tmp/trial/urban/report.json /tmp/trial/suburban/report.json
 *   pnpm showcase:build-data <report.json> [...] --sweep-points 40
 *   pnpm showcase:build-data <report.json> [...] --built-at 2026-09-23T00:00:00.000Z
 *   pnpm showcase:build-data <report.json> [...] --replay-presets urban,suburban
 *   pnpm showcase:build-data <report.json> [...] --all-phase-sweeps
 *
 * By default every corridor's replay scenarios carry trajectories in the
 * headline phase, and only the headline phase carries sweep curves;
 * `--replay-presets` narrows the first and `--all-phase-sweeps` widens the
 * second.
 *
 * Every report is parsed with the same Zod schema the console parses live
 * responses with, and the output is parsed with the showcase's own schema
 * before it is written, so a report that has drifted out of the wire contract
 * - or an extractor that has drifted out of the page's - fails here rather
 * than on stage.
 *
 * `--built-at` defaults to the newest report's `generatedAt`, never the
 * clock: two runs over the same reports must write the same bytes, so a diff
 * of the generated file only ever shows a change in the data.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { ZodError } from 'zod';
import {
  corridorPresetIdSchema,
  fleetTrialReportSchema,
  type CorridorPresetId,
  type FleetTrialReport,
} from '../../src/models/fleetTrial';
import { trialDataSchema } from '../../src/lib/showcase/trialData';
import {
  DEFAULT_EXTRACT_OPTIONS,
  extractTrialData,
  type ExtractOptions,
} from '../lib/showcaseTrialData';

const ROOT = join(import.meta.dirname, '..', '..');
const OUTPUT = join(ROOT, 'src', 'lib', 'showcase', 'generated', 'trialData.json');

const USAGE =
  'Usage: pnpm showcase:build-data <report.json> [<report.json> ...] [--sweep-points N] [--built-at ISO] [--replay-presets a,b] [--all-phase-sweeps]';

interface CliArgs {
  paths: string[];
  sweepPoints: number;
  builtAt: string | null;
  replayPresetIds: readonly CorridorPresetId[];
  sweepsForNonHeadlinePhase: boolean;
}

/** `urban,suburban` -> the presets named, refused rather than skipped when one is unknown. */
function parseReplayPresets(value: string | undefined): CorridorPresetId[] {
  const names = (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) {
    throw new Error(
      `--replay-presets needs a comma-separated list of ${corridorPresetIdSchema.options.join(', ')}.`,
    );
  }
  const presets: CorridorPresetId[] = [];
  for (const name of names) {
    const parsed = corridorPresetIdSchema.safeParse(name);
    if (!parsed.success) {
      throw new Error(
        `--replay-presets names "${name}", which is not one of ${corridorPresetIdSchema.options.join(', ')}.`,
      );
    }
    if (!presets.includes(parsed.data)) presets.push(parsed.data);
  }
  return presets;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const paths: string[] = [];
  let sweepPoints = DEFAULT_EXTRACT_OPTIONS.sweepPoints;
  let builtAt: string | null = null;
  let replayPresetIds: readonly CorridorPresetId[] = DEFAULT_EXTRACT_OPTIONS.replayPresetIds;
  let sweepsForNonHeadlinePhase = DEFAULT_EXTRACT_OPTIONS.sweepsForNonHeadlinePhase;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--sweep-points') {
      const value = argv[i + 1];
      const parsed = value === undefined ? Number.NaN : Number(value);
      if (!Number.isInteger(parsed) || parsed < 2) {
        throw new Error(`--sweep-points needs an integer of at least 2, got "${value ?? ''}".`);
      }
      sweepPoints = parsed;
      i += 1;
    } else if (arg === '--built-at') {
      const value = argv[i + 1];
      if (value === undefined || Number.isNaN(Date.parse(value))) {
        throw new Error(`--built-at needs an ISO timestamp, got "${value ?? ''}".`);
      }
      builtAt = value;
      i += 1;
    } else if (arg === '--replay-presets') {
      replayPresetIds = parseReplayPresets(argv[i + 1]);
      i += 1;
    } else if (arg === '--all-phase-sweeps') {
      sweepsForNonHeadlinePhase = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag ${arg}.\n${USAGE}`);
    } else {
      paths.push(arg);
    }
  }

  if (paths.length === 0) throw new Error(`No report given.\n${USAGE}`);
  return { paths, sweepPoints, builtAt, replayPresetIds, sweepsForNonHeadlinePhase };
}