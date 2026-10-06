import { formatCount } from '../format';
import type { FuelResponse } from './api';
import { formatRupees } from './format';
import {
  COST_NOTE,
  formatCostPerKm,
  formatKm,
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

/** The depot's day as five figures; "N of M buses ran" is the first. */
export function fuelBand(data: FuelResponse): readonly BandFigure[] {
  const { totals, day } = data;
  const notRun =
    data.notRunCount > 0 ? `${formatCount(data.notRunCount)} did not run` : 'every bus ran';
  return [
    {
      key: 'ran',
      label: 'Buses ran',
      value: `${formatCount(totals.busCount)} of ${formatCount(day.buses)}`,
      caption: notRun,
    },
    {
      key: 'distance',
      label: 'Distance',
      value: formatKm(totals.distanceKm),
      caption: 'run in the day',
    },
    {
      key: 'fuel',
      label: 'Fuel issued',
      value: formatLitres(totals.fuelLitres),
      caption: 'for the day',
    },
    {
      key: 'cost',
      label: 'Cost',
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
      distanceText: row.distanceKm > 0 ? formatKm(row.distanceKm) : DASH,
      kmPerLitre: row.kmPerLitre,
      valueText: has ? formatKmPerLitre(row.kmPerLitre) : DASH,
      costPerKmText: has ? formatCostPerKm(row.costPerKm) : DASH,
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
    ? `Cost uses a planning price of ${unit}, not a quoted price.`
    : `Cost uses ${unit}.`;
  return [
    modelledStatement(),
    COST_NOTE,
    price,
    ruleSentence(data.rule.thresholdPct, data.rule.minPeers),
    notRunNote(data.notRunCount) ?? '',
    'Kilometres per litre is distance over fuel issued; cost per kilometre is cost over distance.',
  ].filter((p) => p !== '');
}
