import { formatRupeesPerKm } from './revenuePageModel';
import type { EconomicsComponentKey } from './types';

/*
 * How the economics page writes a component: its label, its value, and the
 * difference from the peer median with the word that says whether it is better.
 */

export const DASH = '—';
export const MINUS = '−';
export const PERCENT = 100;
export const TENTH = 10;
export const HUNDREDTH = 100;

export interface ComponentSpec {
  readonly key: EconomicsComponentKey;
  readonly label: string;
  readonly higherIsBetter: boolean;
  readonly unit: 'rupees' | 'share';
  /** The table's short header and its unit ("EARNINGS ₹/KM"), so cells carry bare numbers. */
  readonly header: string;
  readonly headerUnit: string;
}

export const ECONOMICS_COMPONENT_SPECS: readonly ComponentSpec[] = [
  { key: 'earningsPerKm', label: 'Earnings per km', higherIsBetter: true, unit: 'rupees', header: 'Earnings', headerUnit: '₹/km' },
  { key: 'costPerKm', label: 'Fuel cost per km', higherIsBetter: false, unit: 'rupees', header: 'Fuel', headerUnit: '₹/km' },
  { key: 'loadFactor', label: 'Load factor', higherIsBetter: true, unit: 'share', header: 'Load', headerUnit: '%' },
];

export const specOf = (key: EconomicsComponentKey): ComponentSpec =>
  ECONOMICS_COMPONENT_SPECS.find((s) => s.key === key) as ComponentSpec;

export const roundTo = (n: number, scale: number): number => Math.round(n * scale) / scale;

/** One formatter for rupees per kilometre, shared with the revenue page. */
const rupees = formatRupeesPerKm;

function pointsText(ratio: number): string {
  return roundTo(ratio * PERCENT, TENTH).toFixed(1);
}

export function formatComponentValue(key: EconomicsComponentKey, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  return specOf(key).unit === 'rupees' ? rupees(value) : `${pointsText(value)}%`;
}

/** The raw sign of value minus peer median, in the component's own unit. */
export function formatComponentDifference(key: EconomicsComponentKey, delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return DASH;
  if (specOf(key).unit === 'rupees') {
    const rounded = roundTo(delta, HUNDREDTH);
    return rounded === 0 ? rupees(0) : `${rounded > 0 ? '+' : MINUS}${rupees(Math.abs(rounded))}`;
  }
  const rounded = roundTo(delta * PERCENT, TENTH);
  return rounded === 0 ? '0.0 pp' : `${rounded > 0 ? '+' : MINUS}${Math.abs(rounded).toFixed(1)} pp`;
}

/** A table cell's bare number: the unit is in the header ("40.81", "74.2"). */
export function bareComponentValue(key: EconomicsComponentKey, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  return specOf(key).unit === 'rupees' ? roundTo(value, HUNDREDTH).toFixed(2) : pointsText(value);
}

/** The muted suffix: the signed change against the peer median, bare ("+6.04", "−0.42", "+3.1"). */
export function bareComponentDifference(key: EconomicsComponentKey, delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return '';
  const rupeeUnit = specOf(key).unit === 'rupees';
  const rounded = rupeeUnit ? roundTo(delta, HUNDREDTH) : roundTo(delta * PERCENT, TENTH);
  const digits = rupeeUnit ? 2 : 1;
  if (rounded === 0) return (0).toFixed(digits);
  return `${rounded > 0 ? '+' : MINUS}${Math.abs(rounded).toFixed(digits)}`;
}

export type DifferenceDirection = 'better' | 'worse' | 'level' | 'unknown';

export interface DifferenceWording {
  readonly text: string;
  readonly direction: DifferenceDirection;
}

/** The word comes from whether higher is better; the sign alone never carries the meaning. */
export function describeDifference(
  key: EconomicsComponentKey,
  delta: number | null,
  higherIsBetter: boolean,
): DifferenceWording {
  if (delta === null || !Number.isFinite(delta)) return { text: 'no peer median', direction: 'unknown' };
  const rupeeUnit = specOf(key).unit === 'rupees';
  const rounded = rupeeUnit ? roundTo(delta, HUNDREDTH) : roundTo(delta * PERCENT, TENTH);
  if (rounded === 0) return { text: 'level with peers', direction: 'level' };
  const good = rounded > 0 === higherIsBetter;
  const size = rupeeUnit ? rupees(Math.abs(rounded)) : `${Math.abs(rounded).toFixed(1)} pp`;
  return {
    text: `${size} ${good ? 'better' : 'worse'} than peers`,
    direction: good ? 'better' : 'worse',
  };
}
