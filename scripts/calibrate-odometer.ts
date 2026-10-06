/**
 * Odometer calibration: is the feed's `distance` field metres, kilometres or
 * something else?
 *
 * Run: npx tsx scripts/calibrate-odometer.ts --live [--wait-min 5] [--out report.json] [--force]
 *      npx tsx scripts/calibrate-odometer.ts first.json second.json [--out report.json] [--force]
 *
 * Read-only evidence. It takes two snapshots some minutes apart (from the live
 * feed through the same repository the app uses, or from two saved files),
 * compares each moving bus's change in `distance` with the straight-line path
 * between its two fixes and with its reported speed, and prints the
 * distribution of the ratio. Aggregates only: no registration number, no
 * credential and no raw row is printed. Nothing is written unless `--out` names
 * a file, and then only the aggregate report. The arithmetic lives in
 * src/lib/depot/maintenance/calibration.ts.
 *
 * Live mode needs the same environment the app runs with. It makes exactly two
 * upstream requests, at least one minute apart, and stops before waiting if the
 * app is serving its sample data. An existing output file is never replaced
 * unless `--force` is given. Only messages this script raised are printed; any
 * other error prints a fixed sentence and the error's name.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { DepotBusRow } from '../src/models/depotLive';
import { calibrateOdometer, describeCalibration } from '../src/lib/depot/maintenance/calibration';
import {
  CalibrationError,
  describeFailure,
  outputPathProblem,
  parseCalibrationArgs,
  parseSnapshotText,
  snapshotSourceProblem,
} from '../src/lib/depot/maintenance/calibrationCli';

const MS_PER_MINUTE = 60_000;

const say = (text: string): void => {
  process.stdout.write(`${text}\n`);
};
const warn = (text: string): void => {
  process.stderr.write(`${text}\n`);
};

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new CalibrationError(`${path}: the file could not be read.`);
  }
}

function loadFile(path: string): readonly DepotBusRow[] {
  const parsed = parseSnapshotText(readText(path));
  if (!parsed.ok) throw new CalibrationError(`${path}: ${parsed.message}`);
  return parsed.rows;
}

async function liveSnapshots(
  waitMin: number,
): Promise<[readonly DepotBusRow[], readonly DepotBusRow[]]> {
  // Imported here so reading saved files needs no environment at all.
  const { liveFleetRepository } = await import('../src/lib/depot/repositories/liveFleetRepository');
  const first = await liveFleetRepository.snapshot();
  // Check before waiting: sample data would make the whole wait pointless.
  const problem = snapshotSourceProblem(first.source);
  if (problem !== null) throw new CalibrationError(problem);
  warn(`First snapshot taken (${first.rows.length} buses, source ${first.source}).`);
  warn(`Waiting ${waitMin} minutes for the second.`);
  await new Promise((resolve) => setTimeout(resolve, waitMin * MS_PER_MINUTE));
  const second = await liveFleetRepository.snapshot();
  const secondProblem = snapshotSourceProblem(second.source);
  if (secondProblem !== null) throw new CalibrationError(secondProblem);
  if (first.rows === second.rows) {
    throw new CalibrationError('Both snapshots are the same cached payload; wait longer.');
  }
  return [first.rows, second.rows];
}

async function main(): Promise<void> {
  const args = parseCalibrationArgs(process.argv.slice(2));
  if (!args.ok) {
    warn(args.message);
    process.exitCode = 2;
    return;
  }
  // Refuse before any request or wait, not after the evidence has been gathered.
  const outProblem = outputPathProblem(args.outPath, args.force, existsSync);
  if (outProblem !== null) {
    warn(outProblem);
    process.exitCode = 2;
    return;
  }
  const { mode } = args;
  const [first, second] =
    mode.kind === 'live'
      ? await liveSnapshots(mode.waitMin)
      : [loadFile(mode.first), loadFile(mode.second)];
  const report = calibrateOdometer(first, second);
  for (const line of describeCalibration(report)) say(line);
  if (args.outPath !== null) {
    // 'wx' fails if the file appeared since the check, unless --force was given.
    writeFileSync(args.outPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: args.force ? 'w' : 'wx',
    });
    warn(`Aggregate report written to ${args.outPath}.`);
  }
}

main().catch((error: unknown) => {
  warn(describeFailure(error));
  process.exitCode = 1;
});
