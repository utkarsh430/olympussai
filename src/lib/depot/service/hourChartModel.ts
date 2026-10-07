import { formatPercent } from '../format';
import {
  DASH,
  busFigure,
  feedDelayFigure,
  gapFigure,
  gapWords,
  hourLabel,
} from './serviceWording';
import type { RouteHourFigures, RouteHourlyBody } from './types';

/*
 * The hour chart as data: 24 columns, one per hour of the operating day, from which the
 * bars, the lines, the gap row under the axis and the text table are all drawn, so the
 * gap row can never fall out of step with the columns.
 *
 * Each hour's deployed figure sits in exactly one bar series by what it rests on:
 * observed and the current hour solid, modelled hours ahead of now hatched, and hours
 * before now that this server did not observe as an empty outline (the modelled day's
 * figure, which nobody saw run).
 */

export type HourColumnKind = 'observed' | 'current' | 'modelled' | 'not_observed';
export type GapTone = 'short' | 'over' | 'even';

export interface HourColumn {
  readonly hour: number;
  readonly label: string;
  readonly kind: HourColumnKind;
  readonly deployed: number;
  /** The deployed figure in the series that draws it; the other two are null. */
  readonly solid: number | null;
  readonly hatched: number | null;
  readonly outlined: number | null;
  readonly scheduled: number | null;
  readonly needed: number;
  /** The needed figure's range, scaled from the demand band; low and high. */
  readonly neededBand: readonly [number, number];
  readonly gap: number;
  readonly gapText: string;
  readonly gapTone: GapTone;
  /**
   * True when the hour's deployment was seen in the feed (observed, or the current hour):
   * only then is its gap a measured shortfall worth its tone. Elsewhere both sides of the
   * gap are modelled.
   */
  readonly gapSeen: boolean;
  readonly figures: RouteHourFigures;
}

export interface HourChartModel {
  readonly columns: readonly HourColumn[];
  /** Hour labels on the axis, every 3 hours. */
  readonly xTicks: readonly string[];
  /** The current hour's label, or null without a feed clock. */
  readonly nowLabel: string | null;
  readonly yDomain: readonly [number, number];
  readonly yTicks: readonly number[];
}

const TICK_EVERY_HOURS = 3;
const MAX_Y_INTERVALS = 5;
const NICE_STEPS = [1, 2, 5] as const;
const TENTHS = 10;

function kindOf(figures: RouteHourFigures, currentHour: number | null): HourColumnKind {
  if (figures.deployedBasis !== 'modelled') return figures.deployedBasis;
  return currentHour !== null && figures.hour < currentHour ? 'not_observed' : 'modelled';
}

function toTenths(n: number): number {
  return Math.round(n * TENTHS) / TENTHS;
}

function neededBand(figures: RouteHourFigures): readonly [number, number] {
  if (figures.demand <= 0) return [figures.needed, figures.needed];
  const scale = figures.needed / figures.demand;
  return [toTenths(figures.demandBand.low * scale), toTenths(figures.demandBand.high * scale)];
}

function gapTone(gap: number): GapTone {
  const whole = Math.round(gap);
  if (whole === 0) return 'even';
  return whole > 0 ? 'short' : 'over';
}

function column(figures: RouteHourFigures, currentHour: number | null): HourColumn {
  const kind = kindOf(figures, currentHour);
  const solid = kind === 'observed' || kind === 'current';
  return {
    hour: figures.hour,
    label: hourLabel(figures.hour),
    kind,
    deployed: figures.deployed,
    solid: solid ? figures.deployed : null,
    hatched: kind === 'modelled' ? figures.deployed : null,
    outlined: kind === 'not_observed' ? figures.deployed : null,
    scheduled: figures.scheduled,
    needed: figures.needed,
    neededBand: neededBand(figures),
    gap: figures.gap,
    gapText: gapFigure(figures.gap),
    gapTone: gapTone(figures.gap),
    gapSeen: solid,
    figures,
  };
}

/** The smallest 1, 2 or 5 step that spans the top in at most five intervals. */
function niceStep(top: number): number {
  for (let magnitude = 1; ; magnitude *= TENTHS) {
    const step = NICE_STEPS.map((s) => s * magnitude).find((s) => top / s <= MAX_Y_INTERVALS);
    if (step !== undefined) return step;
  }
}

function yScale(columns: readonly HourColumn[]): Pick<HourChartModel, 'yDomain' | 'yTicks'> {
  // A figure that is not a finite number is left out, so the step search always ends.
  const top = Math.max(
    1,
    ...columns
      .flatMap((c) => [c.deployed, c.scheduled ?? 0, c.needed, c.neededBand[1]])
      .filter(Number.isFinite),
  );
  const step = niceStep(top);
  const max = Math.ceil(top / step) * step;
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step);
  return { yDomain: [0, max], yTicks: ticks };
}

export function buildHourChartModel(body: Pick<RouteHourlyBody, 'hours' | 'currentHour'>): HourChartModel {
  const columns = [...body.hours]
    .sort((a, b) => a.hour - b.hour)
    .map((figures) => column(figures, body.currentHour));
  return {
    columns,
    xTicks: columns.filter((c) => c.hour % TICK_EVERY_HOURS === 0).map((c) => c.label),
    nowLabel: body.currentHour === null ? null : hourLabel(body.currentHour),
    ...yScale(columns),
  };
}

export const BASIS_WORD: Readonly<Record<HourColumnKind, string>> = {
  observed: 'Observed',
  current: 'Current hour',
  modelled: 'Modelled',
  not_observed: 'Not observed',
};

const MODELLED_GAP_TITLE = 'Modelled: the deployment in this hour is modelled.';

/** One hour of the text table that stands in for the chart. */
export interface HourTableRow {
  readonly key: string;
  readonly hour: string;
  readonly deployed: string;
  readonly basis: string;
  readonly scheduled: string;
  readonly needed: string;
  readonly neededRange: string;
  readonly gap: string;
  /** Set for an hour whose deployment is modelled, so its gap is modelled too. */
  readonly gapTitle: string | undefined;
  readonly delay: string;
  readonly lateShare: string;
}

export function hourTableRows(model: HourChartModel): readonly HourTableRow[] {
  return model.columns.map((c) => ({
    key: c.label,
    hour: c.label,
    deployed: busFigure(c.deployed),
    basis: BASIS_WORD[c.kind],
    scheduled: busFigure(c.scheduled),
    needed: busFigure(c.needed),
    neededRange: `${busFigure(c.neededBand[0])} to ${busFigure(c.neededBand[1])}`,
    gap: `${c.gapText} ${gapWords(c.gap)}`,
    gapTitle: c.gapSeen ? undefined : MODELLED_GAP_TITLE,
    delay: feedDelayFigure(c.figures.delayMedianMin),
    lateShare: c.figures.lateShare === null ? DASH : formatPercent(c.figures.lateShare),
  }));
}
