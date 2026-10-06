/**
 * The routes page's headings and fixed sentences, in one place so they are
 * checked in tests (never "simulated") rather than scattered through markup.
 * Sentences built from figures live in `allocationWording` and `routeRowWording`.
 */
export const ROUTES_TEXT = {
  allocationTitle: 'Which depot should run each route',
  movesTitle: 'Recommended moves',
  movesNote: 'Largest saving first',
  savedLabel: 'Dead km saved',
  nowLabel: 'Dead km now',
  afterLabel: 'After the moves',
  kmADay: 'km a day',
  unmovedTitle: 'Routes that would not move',
  stayTitle: 'Would stay',
  outsideTitle: 'Outside the plan',
  noSingleDepot: 'no single depot',
  profileTitle: 'Routes without a profile',
  tableTitle: 'Every route in the feed',
  noRoutes:
    'The feed shows no bus carrying a route name right now, so there are no routes to list.',
} as const;

/** The word on a collapsed or expanded group's control. */
export function disclosureWord(open: boolean): string {
  return open ? 'Hide' : 'Show';
}
