import type { DepotBusRow } from '@/models/depotLive';
import { haversineKm, isUsablePosition } from '../infer/geo';

/*
 * Odometer calibration arithmetic.
 *
 * The feed's `distance` field has no documented unit. Between two snapshots
 * taken minutes apart, a bus that moved has covered at least the straight-line
 * distance between its two fixes, so the change in `distance` divided by that
 * path (in km) is about 1 if the field is kilometres and about 1000 if it is
 * metres. The straight line is a lower bound on the road travelled, so real
 * ratios sit somewhat above the unit's nominal value; the bands below allow for
 * that. This module produces evidence for a person to judge; it never confirms
 * a unit by itself.
 */

/** A bus that moved less than this between the two fixes is treated as stationary. */
export const MIN_PATH_KM = 0.3;
/** Fixes closer in time than this are dominated by GPS jitter. */
export const MIN_ELAPSED_MIN = 2;
/** Fixes further apart than this let the road wander far from the straight line. */
export const MAX_ELAPSED_MIN = 30;
/** Fewer usable pairs than this and no reading is offered. */
export const MIN_USABLE_PAIRS = 30;

/** Median change in distance per km of straight-line path that fits each unit. */
export const KILOMETRE_BAND = { min: 0.7, max: 2.5 } as const;
export const METRE_BAND = { min: 700, max: 2500 } as const;

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const NO_SPEED_KM = 0;

export type CalibrationReading = 'kilometres' | 'metres' | 'inconclusive' | 'too_few';

export interface Distribution {
  readonly n: number;
  readonly min: number;
  readonly p10: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  readonly p90: number;
  readonly max: number;
}

export interface CalibrationExclusions {
  /** In one snapshot only. */
  readonly unmatched: number;
  readonly noDistance: number;
  readonly noPosition: number;
  readonly noTime: number;
  readonly elapsedOutOfRange: number;
  readonly stationary: number;
}

export interface CalibrationReport {
  readonly firstCount: number;
  readonly secondCount: number;
  readonly paired: number;
  readonly usable: number;
  readonly excluded: CalibrationExclusions;
  /** Pairs whose distance went down; kept out of the ratios and counted here. */
  readonly backwards: number;
  /** Change in distance per km of straight-line path. */
  readonly pathRatio: Distribution | null;
  /** Change in distance per km implied by the mean reported speed over the elapsed time. */
  readonly speedRatio: Distribution | null;
  readonly elapsedMin: Distribution | null;
  readonly reading: CalibrationReading;
}

function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] as number;
  const high = sorted[upper] as number;
  return low + (high - low) * (position - lower);
}

/** Null for an empty sample. */
export function distributionOf(values: readonly number[]): Distribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0] as number,
    p10: quantile(sorted, 0.1),
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
    max: sorted[sorted.length - 1] as number,
  };
}

function readingOf(usable: number, pathRatio: Distribution | null): CalibrationReading {
  if (usable < MIN_USABLE_PAIRS || pathRatio === null) return 'too_few';
  const { median } = pathRatio;
  if (median >= KILOMETRE_BAND.min && median <= KILOMETRE_BAND.max) return 'kilometres';
  if (median >= METRE_BAND.min && median <= METRE_BAND.max) return 'metres';
  return 'inconclusive';
}

const isNumber = (value: number | null): value is number =>
  value !== null && Number.isFinite(value);

/**
 * Compares the change in `distance` with the path between two positions, and
 * with the reported speed over the elapsed time, for every bus present in both
 * snapshots. Aggregates only: no registration number leaves this function.
 */
export function calibrateOdometer(
  first: readonly DepotBusRow[],
  second: readonly DepotBusRow[],
): CalibrationReport {
  const earlier = new Map(first.map((row) => [row.registrationNumber, row]));
  const excluded = {
    unmatched: 0,
    noDistance: 0,
    noPosition: 0,
    noTime: 0,
    elapsedOutOfRange: 0,
    stationary: 0,
  };
  let paired = 0;
  let backwards = 0;
  const pathRatios: number[] = [];
  const speedRatios: number[] = [];
  const elapsed: number[] = [];
  const seen = new Set<string>();

  for (const later of second) {
    const before = earlier.get(later.registrationNumber);
    if (before === undefined || seen.has(later.registrationNumber)) {
      excluded.unmatched += 1;
      continue;
    }
    seen.add(later.registrationNumber);
    paired += 1;
    if (!isNumber(before.odometerRaw) || !isNumber(later.odometerRaw)) {
      excluded.noDistance += 1;
      continue;
    }
    if (!isUsablePosition(before) || !isUsablePosition(later)) {
      excluded.noPosition += 1;
      continue;
    }
    const t0 = before.gpsTimestamp === null ? NaN : Date.parse(before.gpsTimestamp);
    const t1 = later.gpsTimestamp === null ? NaN : Date.parse(later.gpsTimestamp);
    if (Number.isNaN(t0) || Number.isNaN(t1)) {
      excluded.noTime += 1;
      continue;
    }
    const minutes = (t1 - t0) / MS_PER_MINUTE;
    if (minutes < MIN_ELAPSED_MIN || minutes > MAX_ELAPSED_MIN) {
      excluded.elapsedOutOfRange += 1;
      continue;
    }
    const pathKm = haversineKm(before.latitude, before.longitude, later.latitude, later.longitude);
    if (pathKm < MIN_PATH_KM) {
      excluded.stationary += 1;
      continue;
    }
    const change = later.odometerRaw - before.odometerRaw;
    if (change < 0) {
      backwards += 1;
      continue;
    }
    pathRatios.push(change / pathKm);
    elapsed.push(minutes);
    const meanSpeed = ((before.speedKmph ?? NO_SPEED_KM) + (later.speedKmph ?? NO_SPEED_KM)) / 2;
    const speedKm = (meanSpeed * minutes) / MINUTES_PER_HOUR;
    if (speedKm > 0) speedRatios.push(change / speedKm);
  }

  excluded.unmatched += earlier.size - seen.size;
  const pathRatio = distributionOf(pathRatios);
  return {
    firstCount: first.length,
    secondCount: second.length,
    paired,
    usable: pathRatios.length,
    excluded,
    backwards,
    pathRatio,
    speedRatio: distributionOf(speedRatios),
    elapsedMin: distributionOf(elapsed),
    reading: readingOf(pathRatios.length, pathRatio),
  };
}

/** The most pairs that may go backwards before an inconclusive reading says so. */
export const BACKWARDS_NOTE_SHARE = 0.1;

/** Pairs whose distance fell, as a share of the pairs that reached the comparison. */
export function backwardsShare(report: CalibrationReport): number {
  const compared = report.usable + report.backwards;
  return compared === 0 ? 0 : report.backwards / compared;
}

const fixed = (value: number): string =>
  Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);

function distributionLine(label: string, d: Distribution | null): string {
  if (d === null) return `${label}: no usable pairs`;
  return (
    `${label} (n=${d.n}): min ${fixed(d.min)}, p10 ${fixed(d.p10)}, p25 ${fixed(d.p25)}, ` +
    `median ${fixed(d.median)}, p75 ${fixed(d.p75)}, p90 ${fixed(d.p90)}, max ${fixed(d.max)}`
  );
}

const READING_TEXT: Readonly<Record<CalibrationReading, string>> = {
  kilometres: 'The median ratio is close to 1 per km of path, which fits kilometres.',
  metres: 'The median ratio is close to 1000 per km of path, which fits metres.',
  inconclusive: 'The median ratio fits neither kilometres nor metres; read the distribution.',
  too_few: 'No reading is offered.',
};

/** The report as printable lines: aggregates only, no registration, no raw row. */
export function describeCalibration(report: CalibrationReport): string[] {
  const { excluded } = report;
  const lines = [
    `Buses in first snapshot: ${report.firstCount}; second: ${report.secondCount}; in both: ${report.paired}.`,
    `Usable pairs: ${report.usable}. Distance went backwards: ${report.backwards} (reported separately).`,
    `Left out: ${excluded.unmatched} in one snapshot only, ${excluded.noDistance} without a ` +
      `distance, ${excluded.noPosition} without a position, ${excluded.noTime} without a fix ` +
      `time, ${excluded.elapsedOutOfRange} with fixes outside ${MIN_ELAPSED_MIN} to ` +
      `${MAX_ELAPSED_MIN} minutes apart, ${excluded.stationary} that did not move.`,
    distributionLine('Minutes between fixes', report.elapsedMin),
    distributionLine('Change in distance per km of straight-line path', report.pathRatio),
    distributionLine('Change in distance per km implied by reported speed', report.speedRatio),
  ];
  if (report.reading === 'too_few') {
    lines.push(
      `Too few usable pairs (need ${MIN_USABLE_PAIRS}); take the snapshots further apart or at a busier hour.`,
    );
  }
  if (report.reading === 'inconclusive' && backwardsShare(report) > BACKWARDS_NOTE_SHARE) {
    lines.push(
      `${report.backwards} of ${report.usable + report.backwards} compared pairs went backwards, ` +
        'more than a tenth: some buses may report a trip distance that resets rather than a ' +
        'running odometer, which would explain the mixed ratio.',
    );
  }
  lines.push(
    `${READING_TEXT[report.reading]} This is evidence for a person to judge, not a confirmation of the unit.`,
  );
  return lines;
}
