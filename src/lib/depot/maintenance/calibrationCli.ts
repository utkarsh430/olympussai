import { z } from 'zod';
import type { UpstreamSource } from '@/models/canonical';
import { depotBusRowSchema, type DepotBusRow } from '@/models/depotLive';

/** Gap between the two live snapshots when the owner does not choose one. */
export const DEFAULT_WAIT_MIN = 5;

/** Closer snapshots than this only measure GPS jitter and the app's own short cache. */
export const MIN_WAIT_MIN = 1;

const USAGE =
  'Usage: npx tsx scripts/calibrate-odometer.ts <first.json> <second.json> ' +
  '[--out report.json] [--force]\n' +
  '   or: npx tsx scripts/calibrate-odometer.ts --live [--wait-min N] [--out report.json] [--force]';

/** A failure whose message the script wrote itself, so it is safe to print. */
export class CalibrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalibrationError';
  }
}

/**
 * What the script prints for a failure. Its own messages are printed as they
 * are; anything else (a network or file-system error can carry a host or a
 * token in its message) becomes a fixed sentence and the error's name.
 */
export function describeFailure(error: unknown): string {
  if (error instanceof CalibrationError) return error.message;
  const name = error instanceof Error ? error.name : 'unknown error';
  return `Calibration failed (${name}). The error message is not shown.`;
}

/** Why a snapshot cannot be used for calibration, or null when it can. */
export function snapshotSourceProblem(source: UpstreamSource): string | null {
  return source === 'fixture'
    ? 'The app is serving its built-in sample data, which says nothing about the unit. ' +
        'Connect it to the live feed and run this again.'
    : null;
}

/** An existing output file is never replaced unless `--force` was given. */
export function outputPathProblem(
  outPath: string | null,
  force: boolean,
  exists: (path: string) => boolean,
): string | null {
  if (outPath === null || force || !exists(outPath)) return null;
  return 'The output file already exists. Choose another path, or add --force to replace it.';
}

export type CalibrationMode =
  | { readonly kind: 'files'; readonly first: string; readonly second: string }
  | { readonly kind: 'live'; readonly waitMin: number };

export type ParsedArgs =
  | {
      readonly ok: true;
      readonly mode: CalibrationMode;
      readonly outPath: string | null;
      readonly force: boolean;
    }
  | { readonly ok: false; readonly message: string };

const fail = (reason: string): ParsedArgs => ({ ok: false, message: `${reason}\n${USAGE}` });

/** The script's command line; pure so the shell around it stays thin. */
export function parseCalibrationArgs(argv: readonly string[]): ParsedArgs {
  let live = false;
  let waitMin = DEFAULT_WAIT_MIN;
  let outPath: string | null = null;
  let force = false;
  const files: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--live') live = true;
    else if (arg === '--force') force = true;
    else if (arg === '--wait-min') {
      const value = Number(argv[(i += 1)]);
      if (!Number.isFinite(value) || value < MIN_WAIT_MIN) {
        return fail(`--wait-min needs a number of at least ${MIN_WAIT_MIN} minute.`);
      }
      waitMin = value;
    } else if (arg === '--out') {
      const value = argv[(i += 1)];
      if (value === undefined || value.startsWith('--')) return fail('--out needs a file path.');
      outPath = value;
    } else if (arg.startsWith('--')) return fail('Unknown option.');
    else files.push(arg);
  }
  if (live) {
    if (files.length > 0) return fail('Use either --live or two files, not both.');
    return { ok: true, mode: { kind: 'live', waitMin }, outPath, force };
  }
  if (files.length !== 2) return fail('Give exactly two snapshot files, or --live.');
  return {
    ok: true,
    mode: { kind: 'files', first: files[0] as string, second: files[1] as string },
    outPath,
    force,
  };
}

export type SnapshotParse =
  | { readonly ok: true; readonly rows: readonly DepotBusRow[] }
  | { readonly ok: false; readonly message: string };

const rowsSchema = z.array(depotBusRowSchema);
const fileSchema = z.union([rowsSchema, z.object({ rows: rowsSchema })]);

/**
 * A saved snapshot: an array of depot bus rows, or an object holding them under
 * `rows`. Failures name the problem, never the content, so a registration or a
 * credential in a bad file is not echoed to the terminal.
 */
export function parseSnapshotText(text: string): SnapshotParse {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, message: 'The snapshot file is not valid JSON.' };
  }
  const parsed = fileSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, message: 'The snapshot file does not hold depot bus rows.' };
  }
  return { ok: true, rows: Array.isArray(parsed.data) ? parsed.data : parsed.data.rows };
}
