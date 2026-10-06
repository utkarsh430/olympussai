import { z } from 'zod';
import { depotBusRowSchema, type DepotBusRow } from '@/models/depotLive';

/** Gap between the two live snapshots when the owner does not choose one. */
export const DEFAULT_WAIT_MIN = 5;

const USAGE =
  'Usage: npx tsx scripts/calibrate-odometer.ts <first.json> <second.json> [--out report.json]\n' +
  '   or: npx tsx scripts/calibrate-odometer.ts --live [--wait-min N] [--out report.json]';

export type CalibrationMode =
  | { readonly kind: 'files'; readonly first: string; readonly second: string }
  | { readonly kind: 'live'; readonly waitMin: number };

export type ParsedArgs =
  | { readonly ok: true; readonly mode: CalibrationMode; readonly outPath: string | null }
  | { readonly ok: false; readonly message: string };

const fail = (reason: string): ParsedArgs => ({ ok: false, message: `${reason}\n${USAGE}` });

/** The script's command line; pure so the shell around it stays thin. */
export function parseCalibrationArgs(argv: readonly string[]): ParsedArgs {
  let live = false;
  let waitMin = DEFAULT_WAIT_MIN;
  let outPath: string | null = null;
  const files: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--live') live = true;
    else if (arg === '--wait-min') {
      const value = Number(argv[(i += 1)]);
      if (!Number.isFinite(value) || value <= 0) return fail('--wait-min needs a positive number.');
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
    return { ok: true, mode: { kind: 'live', waitMin }, outPath };
  }
  if (files.length !== 2) return fail('Give exactly two snapshot files, or --live.');
  return {
    ok: true,
    mode: { kind: 'files', first: files[0] as string, second: files[1] as string },
    outPath,
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
