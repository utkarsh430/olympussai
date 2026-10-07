import { MINUS, formatCount } from '../format';
import type { ImpactRange, ProposalImpact } from './types';

/*
 * What a proposal's expanded row adds to its row: the band figures the table at this width
 * hides, the impact as four labelled ranges, and the net a day (revenue less cost), the
 * fact a planner decides on. Nothing the visible cells already say is repeated.
 */

export type ImpactPair = readonly [label: string, value: string];

export interface NetWords {
  readonly text: string;
  /** True when even the best case loses money: the row prints it in the worse tone. */
  readonly loss: boolean;
}

export function money(n: number): string {
  return n < 0 ? `${MINUS}₹${formatCount(-n)}` : `₹${formatCount(n)}`;
}

function range(r: ImpactRange, figure: (n: number) => string): string {
  return `${figure(r.low)} to ${figure(r.high)}`;
}

export function impactPairs(i: ProposalImpact): readonly ImpactPair[] {
  return [
    ['Passengers a day', range(i.passengersPerDay, formatCount)],
    ['Revenue a day', range(i.revenuePerDay, money)],
    ['Bus-km a day', range(i.busKmPerDay, formatCount)],
    ['Cost a day', range(i.costPerDay, money)],
  ];
}

/** Revenue less cost, worst case to best; a range wholly below zero is said as a loss. */
export function netWords(i: ProposalImpact): NetWords {
  const low = i.revenuePerDay.low - i.costPerDay.high;
  const high = i.revenuePerDay.high - i.costPerDay.low;
  if (high < 0) return { text: `Net a day: a loss of ${money(-high)} to ${money(-low)}`, loss: true };
  return { text: `Net a day: ${money(low)} to ${money(high)}`, loss: false };
}

export interface BandFigureWords {
  readonly deployed: string;
  readonly scheduled: string;
  readonly needed: string;
}

const FIGURE_KEYS = ['deployed', 'scheduled', 'needed'] as const;

/** The band means the shown columns leave out, in one sentence; null when every one is shown. */
export function hiddenFigures(row: BandFigureWords, shown: readonly string[]): string | null {
  const hidden = FIGURE_KEYS.filter((key) => !shown.includes(key));
  if (hidden.length === 0) return null;
  const words = hidden.map((key, i) => {
    const name = i === 0 ? `${key[0]!.toUpperCase()}${key.slice(1)}` : key;
    return `${name} ${row[key]}`;
  });
  return `${words.join(', ')} (band ${hidden.length === 1 ? 'mean' : 'means'}).`;
}
