import { formatCount, signFor } from '../format';
import type { FuelFlaggedBus, FuelResponse } from './api';
import { noComparisonNote, noDistanceNote, peersDifferNote } from './fuelPageModel';
import { TENTH } from '@/lib/depot/units';

/*
 * "Buses that stand out": the variance is FUEL USED PER KILOMETRE against the peers'
 * median, so a bus that stands out uses MORE fuel per kilometre. Consumption is shown
 * in litres per 100 km so the bus figure, the peers' figure and the signed variance all
 * rise together and cannot be read the other way. A variance, never a cause or a person.
 */

const DASH = '—';
const HUNDREDTH = 100;
const PER_100_KM = 100;

export interface StandOutHeader {
  readonly header: string;
  readonly unit?: string;
}

/** The consumption columns: the bus, its peers' median, then the signed variance. */
export const STAND_OUT_HEADERS: Readonly<Record<'bus' | 'peers' | 'variance', StandOutHeader>> = {
  bus: { header: 'L / 100 km' },
  peers: { header: "Peers' median", unit: 'L / 100 km' },
  variance: { header: 'Variance' },
};

/** Litres per 100 km from km per litre, one decimal; a dash when there is no rate. */
export function formatLitresPer100Km(kmPerLitre: number): string {
  if (!Number.isFinite(kmPerLitre) || kmPerLitre <= 0) return DASH;
  return (PER_100_KM / kmPerLitre).toFixed(1);
}

/**
 * Signed variance: "+18.8%". A listed bus is above the threshold, so a value that would
 * round to or under it is shown to the hundredth, rounded up ("+15.04%").
 */
export function formatVariance(pct: number, thresholdPct: number): string {
  const tenth = Math.round(pct * TENTH) / TENTH;
  // A negative variance (never listed today) would take the module's minus, not a hyphen.
  const sign = pct > 0 ? '+' : signFor(tenth);
  if (pct > thresholdPct && tenth <= thresholdPct) {
    return `${sign}${(Math.ceil(pct * HUNDREDTH) / HUNDREDTH).toFixed(2)}%`;
  }
  return `${sign}${Math.abs(tenth).toFixed(1)}%`;
}

/** The rule, once, as the section's one-line note. */
export function standOutNote(thresholdPct: number): string {
  return `Uses more than ${thresholdPct}% more fuel per kilometre than the median of its peers`;
}

/** The nil result inside the section, in the same direction as the note. */
export function nothingStandsOut(thresholdPct: number): string {
  return `No bus uses more than ${thresholdPct}% more fuel per kilometre than the median of its peers`;
}

export const BASIS_LABEL: Readonly<Record<FuelFlaggedBus['comparison'], string>> = {
  route: 'route peers',
  depot: 'class in depot',
};

/** A route cell with no route is a dash. */
export function routeDash(routeName: string | null): string {
  return routeName === null ? DASH : routeName;
}

/** The route column is dropped from the stand-out table when most rows have no route. */
export function showRouteColumn(rows: readonly FuelFlaggedBus[]): boolean {
  if (rows.length === 0) return false;
  const without = rows.filter((r) => r.routeName === null).length;
  return without * 2 <= rows.length;
}

/** What is under the list, as one line: what was listed in part, and what could not be compared. */
export function standOutFooter(data: FuelResponse): string | null {
  const parts = [
    data.flagged.length < data.flaggedTotal
      ? `The ${formatCount(data.flagged.length)} with the largest variance are listed.`
      : null,
    peersDifferNote(data.peersDifferCount, data.rule.thresholdPct),
    noComparisonNote(data.noComparisonCount),
    noDistanceNote(data.noDistanceCount),
  ].filter((p): p is string => p !== null);
  return parts.length === 0 ? null : parts.join(' ');
}
