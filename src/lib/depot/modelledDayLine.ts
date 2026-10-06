import { formatPlainDate } from './format';
import { modelledDaySentence } from './provenanceLine';
import type { Coverage } from './types';

/*
 * The provenance line's extension on EVERY page built on the modelled operating day (duty
 * board, crew, fuel and cost, revenue and ridership), worded once so they say it word for
 * word. No page builds this sentence itself.
 * Dated from the response's `operatingDate` (ruling: a page on the modelled day prints
 * the date it is for), with the feed's schedule coverage from the depot detail.
 */

export interface ModelledDayLineInput {
  /** The response's operating date, YYYY-MM-DD. */
  readonly operatingDate: string;
  readonly duties: number;
  readonly routes: number;
  /** The feed's schedule coverage for the depot; null until the depot detail has loaded. */
  readonly scheduled: Coverage | null;
}

/** The network pages' form (economics): "Built on the modelled day for 6 Oct 2026 of every operating depot." */
export function networkModelledDayLine(operatingDate: string): string {
  return `Built on the modelled day for ${formatPlainDate(operatingDate)} of every operating depot.`;
}

/** "Built on the modelled day for 6 Oct 2026: 163 duties on 4 routes; the feed schedules 5 of 200 buses." */
export function modelledDayLine(input: ModelledDayLineInput): string {
  const date = formatPlainDate(input.operatingDate);
  if (input.scheduled === null) return `Built on the modelled day for ${date}.`;
  return modelledDaySentence({
    date,
    duties: input.duties,
    routes: input.routes,
    scheduled: input.scheduled.n,
    fleet: input.scheduled.of,
  });
}
