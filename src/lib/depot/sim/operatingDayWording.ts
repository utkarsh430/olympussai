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
}

/** Why a depot has no modelled day; every page with nothing to show starts with these words. */
export const NO_DUTIES_REASON =
  'No duties are modelled for this depot today (no route is seen running from it)';

const count = (n: number, one: string, many: string): string =>
  `${formatCount(n)} ${n === 1 ? one : many}`;

/**
 * "The live feed carries a schedule for 5 of 200 of this depot's buses today.
 * This page is built on the modelled day: 158 duties on 14 routes."
 */
export function modelledDaySentence(reference: ModelledDayReference): string {
  const { scheduled, duties, routes } = reference;
  const live =
    scheduled === null
      ? ''
      : `The live feed carries a schedule for ${formatCount(scheduled.n)} of ${formatCount(scheduled.of)} of this depot's buses today. `;
  if (duties === 0) return `${live}${NO_DUTIES_REASON}, so this page has no modelled day to show.`;
  return `${live}This page is built on the modelled day: ${count(duties, 'duty', 'duties')} on ${count(routes, 'route', 'routes')}.`;
}
