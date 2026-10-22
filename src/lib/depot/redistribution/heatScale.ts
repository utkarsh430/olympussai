import { DEPOT_CYAN_RAMP, DEPOT_PALETTE, indexRampColour } from '../palette';

/*
 * The heat map's four views and their colour scales, each with the legend that says it in
 * words. A cell's figure is always in its title too, so colour never carries the meaning alone.
 */

export type HeatMode = 'gap' | 'demand' | 'availability' | 'coverage';

export const HEAT_MODES: readonly { readonly key: HeatMode; readonly label: string; readonly short: string }[] = [
  { key: 'gap', label: 'Bus Shortage / Surplus', short: 'Shortage / Surplus' },
  { key: 'demand', label: 'Passenger Demand', short: 'Demand' },
  { key: 'availability', label: 'Bus Availability', short: 'Availability' },
  { key: 'coverage', label: 'Demand Coverage %', short: 'Coverage' },
];

/** The midpoint of two palette colours, channel by channel. */
function mixHex(a: string, b: string): string {
  const pair = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round((pair(a, i) + pair(b, i)) / 2).toString(16).padStart(2, '0')).join('')}`;
}

/** The one step the dashboard's palette lacks: a shortage between amber and crimson, mixed from the two. */
const ORANGE = mixHex(DEPOT_PALETTE.amber, DEPOT_PALETTE.crimson);
/** Balanced: the cyan family's darkest step, as a dark teal wash. */
const BALANCED = `${DEPOT_PALETTE.deep}99`;
/** The wash of a cell that has no service in the hour. */
const IDLE = 'transparent';

export interface LegendStep {
  readonly colour: string;
  readonly label: string;
}

/** Shortage/surplus: green surplus by size, dark teal balanced, amber 1–2, orange 3–5, red 6+. */
export function gapColour(gap: number, required: number): string {
  if (required <= 0 && gap === 0) return IDLE;
  if (gap >= 6) return DEPOT_PALETTE.crimson;
  if (gap >= 3) return ORANGE;
  if (gap >= 1) return DEPOT_PALETTE.amber;
  if (gap === 0) return BALANCED;
  if (gap <= -6) return `${DEPOT_PALETTE.green}e6`;
  if (gap <= -3) return `${DEPOT_PALETTE.green}a6`;
  return `${DEPOT_PALETTE.green}66`;
}

export const GAP_LEGEND: readonly LegendStep[] = [
  { colour: `${DEPOT_PALETTE.green}a6`, label: 'Surplus capacity' },
  { colour: BALANCED, label: 'Balanced' },
  { colour: DEPOT_PALETTE.amber, label: 'Short 1–2 buses' },
  { colour: ORANGE, label: 'Short 3–5 buses' },
  { colour: DEPOT_PALETTE.crimson, label: 'Short 6+ buses' },
];

/** Five even steps of a ramp over 0 to `max`. */
function rampStep(value: number, max: number, ramp: readonly string[]): string {
  if (value <= 0 || max <= 0) return IDLE;
  const step = Math.min(ramp.length - 1, Math.floor((value / max) * ramp.length));
  return ramp[step] as string;
}

const TEAL_RAMP = [
  `${DEPOT_PALETTE.teal}33`,
  `${DEPOT_PALETTE.teal}59`,
  `${DEPOT_PALETTE.teal}8c`,
  `${DEPOT_PALETTE.teal}bf`,
  DEPOT_PALETTE.teal,
] as const;

export function demandColour(demand: number, maxDemand: number): string {
  return rampStep(demand, maxDemand, DEPOT_CYAN_RAMP);
}

export function availabilityColour(buses: number, maxBuses: number): string {
  return rampStep(buses, maxBuses, TEAL_RAMP);
}

/** Coverage on the dashboard's index ramp, crimson to green; a cell with no need is idle. */
export function coverageColour(coverage: number, required: number): string {
  if (required <= 0) return IDLE;
  return indexRampColour(coverage * 100);
}

function rampLegend(ramp: readonly string[], max: number, unit: string): LegendStep[] {
  const width = max / ramp.length;
  return ramp.map((colour, i) => {
    const from = Math.round(i * width);
    const to = Math.round((i + 1) * width);
    return { colour, label: i === ramp.length - 1 ? `${from}+ ${unit}` : `${from}–${to} ${unit}` };
  });
}

export const COVERAGE_LEGEND: readonly LegendStep[] = [
  { colour: indexRampColour(10), label: 'Under 20%' },
  { colour: indexRampColour(30), label: '20–39%' },
  { colour: indexRampColour(50), label: '40–59%' },
  { colour: indexRampColour(70), label: '60–79%' },
  { colour: indexRampColour(90), label: '80–100%' },
];

export interface HeatScale {
  readonly maxDemand: number;
  readonly maxBuses: number;
}

export function legendFor(mode: HeatMode, scale: HeatScale): readonly LegendStep[] {
  switch (mode) {
    case 'gap':
      return GAP_LEGEND;
    case 'demand':
      return rampLegend(DEPOT_CYAN_RAMP, scale.maxDemand, 'passengers');
    case 'availability':
      return rampLegend(TEAL_RAMP, scale.maxBuses, 'buses');
    case 'coverage':
      return COVERAGE_LEGEND;
  }
}

export interface CellFigures {
  readonly demand: number;
  readonly required: number;
  readonly available: number;
}

export function cellColour(mode: HeatMode, cell: CellFigures, scale: HeatScale): string {
  switch (mode) {
    case 'gap':
      return gapColour(cell.required - cell.available, cell.required);
    case 'demand':
      return demandColour(cell.demand, scale.maxDemand);
    case 'availability':
      return availabilityColour(cell.available, scale.maxBuses);
    case 'coverage':
      return coverageColour(cell.required <= 0 ? 1 : Math.min(1, cell.available / cell.required), cell.required);
  }
}
