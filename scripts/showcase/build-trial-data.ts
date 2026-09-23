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