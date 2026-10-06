import { formatCount } from '../format';
import type { FuelResponse } from './api';
import { formatRupees } from './format';
import {
  COST_NOTE,
  formatCostPerKm,
  formatKm,
  formatTenths,
  formatKmPerLitre,
  formatLitres,
  modelledStatement,
  notRunNote,
  ruleSentence,
} from './fuelPageModel';
import type { FuelGroupRow } from './types';

/*
 * The fuel page's layout models: the figure band, the stand-out table's
 * columns, the class table's bars, the line under the table and the closing
 * disclosure. All wording is a variance, never a cause and never a person.
 */

const DASH = '—';
const TENTH = 10;
const FULL_BAR_PCT = 100;
/** The shortest bar a class with a value gets, so the lowest class is still seen. */
const MIN_BAR_PCT = 6;
/** Bars start at this share of the lowest class's rate, so differences read. */
const FLOOR_SHARE = 0.5;

export interface BandFigure {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly caption: string;
}

/** The depot's modelled day as five figures; "N of M buses running duties" is the first. */
export function fuelBand(data: FuelResponse): readonly BandFigure[] {
  const { totals, day } = data;
  const notRun =
    data.notRunCount > 0 ? `${formatCount(data.notRunCount)} with no duty` : 'every bus has a duty';
  return [
    {
      key: 'ran',
      label: 'Buses running duties',
      value: `${formatCount(totals.busCount)} of ${formatCount(day.buses)}`,
      caption: notRun,
    },
    {
      key: 'distance',
      label: 'Distance',
      value: formatKm(totals.distanceKm),
      caption: 'run on duties',
    },
    {
      key: 'fuel',
      label: 'Fuel issued',
      value: formatLitres(totals.fuelLitres),
      caption: 'for the day',
    },
    {
      key: 'cost',
      label: 'Fuel cost',
      value: formatRupees(totals.cost),
      caption: `${formatCostPerKm(totals.costPerKm)} per km`,
    },
    {
      key: 'kmpl',
      label: 'Km per litre',
      value: formatKmPerLitre(totals.kmPerLitre),
      caption: data.priceDefaulted
        ? `planning price ${formatRupees(data.pricePerLitre)} a litre`
        : `${formatRupees(data.pricePerLitre)} a litre`,
    },
  ];
}

export interface ClassTableRow {
  readonly key: string;
  readonly label: string;
  readonly busCount: number;
  readonly distanceText: string;
  readonly kmPerLitre: number | null;
  readonly valueText: string;
  readonly costPerKmText: string;
  /** 0 to 100 from the floor; 0 when the class has no distance. */
  readonly widthPct: number;
}

/** Where the class bars start: half the lowest rate, to the tenth. */
export function classFloor(rows: readonly FuelGroupRow[]): number {
  const values = rows
    .filter((r) => r.kmPerLitre !== null && r.distanceKm > 0)
    .map((r) => r.kmPerLitre ?? 0);
  if (values.length === 0) return 0;
  return Math.floor(Math.min(...values) * FLOOR_SHARE * TENTH) / TENTH;
}

export function classTableRows(
  rows: readonly FuelGroupRow[],
  labelOf: (key: string | null) => string,
): readonly ClassTableRow[] {
  const floor = classFloor(rows);
  const values = rows
    .filter((r) => r.kmPerLitre !== null && r.distanceKm > 0)
    .map((r) => r.kmPerLitre ?? 0);
  const top = Math.max(0, ...values);
  return rows.map((row) => {
    const has = row.kmPerLitre !== null && row.distanceKm > 0;
    const span = top - floor;
    const share = !has ? 0 : span <= 0 ? FULL_BAR_PCT : ((row.kmPerLitre ?? 0) - floor) / span;
    return {
      key: row.key ?? '',
      label: labelOf(row.key),
      busCount: row.busCount,
      distanceText: row.distanceKm > 0 ? formatTenths(row.distanceKm) : DASH,
      kmPerLitre: row.kmPerLitre,
      valueText: has ? formatKmPerLitre(row.kmPerLitre) : DASH,
      costPerKmText: has && row.costPerKm !== null ? row.costPerKm.toFixed(2) : DASH,
      widthPct: has ? Math.round(Math.max(MIN_BAR_PCT, share * FULL_BAR_PCT)) : 0,
    };
  });
}

/** The note beside the class table: the bars do not start at zero, and where they start. */
export function classNote(rows: readonly FuelGroupRow[]): string {
  return `Bars start at ${classFloor(rows).toFixed(1)} km per litre, not zero`;
}

/** The closing disclosure's paragraphs: the modelled statement, the cost note, the price and the rule. */
export function fuelDisclosure(data: FuelResponse): readonly string[] {
  const unit = `${formatRupees(data.pricePerLitre)} per litre`;
  const price = data.priceDefaulted
    ? `Fuel cost uses a planning price of ${unit}, not a quoted price.`
    : `Fuel cost uses ${unit}.`;
  return [
    modelledStatement(),
    COST_NOTE,
    price,
    ruleSentence(data.rule.thresholdPct, data.rule.minPeers),
    notRunNote(data.notRunCount) ?? '',
    'Kilometres per litre is distance over fuel issued; fuel cost per kilometre is fuel cost over distance.',
  ].filter((p) => p !== '');
}

/** The empty modelled day's one muted line: what would bring figures to the page. */
export function emptyRemedy(day: FuelResponse['day']): string {
  return day.duties === 0
    ? 'Figures appear once a route is seen running from this depot in the live feed.'
    : 'Figures appear once a bus of this depot is free to run a duty.';
}
