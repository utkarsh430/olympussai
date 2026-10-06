import { formatCount } from '../format';
import type { Coverage } from '../types';

/*
 * The one cross-reference every modelled depot page carries (crew, fuel,
 * revenue and the duty board's notice), built here and nowhere else, so the
 * pages describe the same day in the same words.
 */

export interface ModelledDayReference {
  /** Buses carrying a live schedule for the feed date, out of the depot's buses; null while unknown. */
  readonly scheduled: Coverage | null;
  readonly duties: number;
  /** Routes with at least one duty. */
  readonly routes: number;
  /** The operating date the day is modelled for; the sentence names it when given. */
  readonly operatingDate?: string;
}

/*
 * Tense-neutral and dated (review M2, M6): the day is a model for an operating
 * date, rebuilt from the live fleet as of the feed time, so no sentence says
 * "today" or that a bus "ran". Every sentence keeps the word "modelled".
 */

/** Why a depot has no modelled day; every page with nothing to show starts with these words. */
export const NO_DUTIES_REASON =
  'No duties are modelled for this depot (no route is seen running from it)';

/** The same reason, naming the operating date when it is known. */
export function noDutiesReason(operatingDate?: string): string {
  return operatingDate === undefined
    ? NO_DUTIES_REASON
    : `No duties are modelled for this depot for ${operatingDate} (no route is seen running from it)`;
}

const count = (n: number, one: string, many: string): string =>
  `${formatCount(n)} ${n === 1 ? one : many}`;

/**
 * "The live feed carries a schedule for 5 of 200 of this depot's buses at the
 * feed time. This page is built on the modelled day for 2026-10-06, rebuilt
 * from the live fleet as of the feed time: 158 duties on 14 routes."
 */
export function modelledDaySentence(reference: ModelledDayReference): string {
  const { scheduled, duties, routes, operatingDate } = reference;
  const live =
    scheduled === null
      ? ''
      : `The live feed carries a schedule for ${formatCount(scheduled.n)} of ${formatCount(scheduled.of)} of this depot's buses at the feed time. `;
  if (duties === 0) {
    return `${live}${noDutiesReason(operatingDate)}, so this page has no modelled day to show.`;
  }
  const day = operatingDate === undefined ? 'the modelled day' : `the modelled day for ${operatingDate}`;
  return `${live}This page is built on ${day}, rebuilt from the live fleet as of the feed time: ${count(duties, 'duty', 'duties')} on ${count(routes, 'route', 'routes')}.`;
}
