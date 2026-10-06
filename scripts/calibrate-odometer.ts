/**
 * Odometer calibration: is the feed's `distance` field metres, kilometres or
 * something else?
 *
 * Run: npx tsx scripts/calibrate-odometer.ts --live [--wait-min 5] [--out report.json]
 *      npx tsx scripts/calibrate-odometer.ts first.json second.json [--out report.json]
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
 * upstream requests.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import type { DepotBusRow } from '../src/models/depotLive';
import { calibrateOdometer, describeCalibration } from '../src/lib/depot/maintenance/calibration';
import {
  parseCalibrationArgs,
  parseSnapshotText,
} from '../src/lib/depot/maintenance/calibrationCli';

const MS_PER_MINUTE = 60_000;

function loadFile(path: string): readonly DepotBusRow[] {
  const parsed = parseSnapshotText(readFileSync(path, 'utf8'));
  if (!parsed.ok) throw new Error(`${path}: ${parsed.message}`);
  return parsed.rows;
}

async function liveSnapshots(
  waitMin: number,
): Promise<[readonly DepotBusRow[], readonly DepotBusRow[]]> {
  // Imported here so reading saved files needs no environment at all.
  const { liveFleetRepository } = await import('../src/lib/depot/repositories/liveFleetRepository');
  const first = await liveFleetRepository.snapshot();
  console.error(`First snapshot taken (${first.rows.length} buses, source ${first.source}).`);
  console.error(`Waiting ${waitMin} minutes for the second.`);
  await new Promise((resolve) => setTimeout(resolve, waitMin * MS_PER_MINUTE));
  const second = await liveFleetRepository.snapshot();
  if (first.source === 'fixture' || second.source === 'fixture') {
    throw new Error('The feed answered from the built-in fixture, which says nothing about the unit.');
  }
  if (first.rows === second.rows) {
    throw new Error('Both snapshots are the same cached payload; wait longer.');
  }
  return [first.rows, second.rows];
}

async function main(): Promise<void> {
  const args = parseCalibrationArgs(process.argv.slice(2));
  if (!args.ok) {
    console.error(args.message);
    process.exitCode = 2;
    return;
  }
  const { mode } = args;
  const [first, second] =
    mode.kind === 'live'
      ? await liveSnapshots(mode.waitMin)
      : [loadFile(mode.first), loadFile(mode.second)];
  const report = calibrateOdometer(first, second);
  for (const line of describeCalibration(report)) console.log(line);
  if (args.outPath !== null) {
    writeFileSync(args.outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.error(`Aggregate report written to ${args.outPath}.`);
  }
}

main().catch((error: unknown) => {
  // The message is ours or a file-system / network error name; no row is attached.
  console.error(error instanceof Error ? error.message : 'Calibration failed.');
  process.exitCode = 1;
});
