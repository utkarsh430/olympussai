/**
 * The depot console's rail sections.
 *
 * A PLAIN module with no `'use client'`, for the reason
 * control-room/console/consoleTabs.ts carries at length: the page above the
 * console is a Server Component and needs `isDepotTab` to validate a `?tab=`
 * parameter. A value imported out of a `'use client'` module from a Server
 * Component is a client-reference proxy, and calling it is a hard 500 that
 * typecheck, lint, build and unit tests all pass. `pnpm check:client-boundary`
 * is the check that catches it; keeping this file plain is what makes it pass.
 */
export const DEPOT_TAB_ORDER = [
  'running',
  'bunching',
  'schedule',
  'standby',
  'roster',
  'reports',
] as const;

export type DepotTabId = (typeof DEPOT_TAB_ORDER)[number];

/**
 * The rail's words.
 *
 * The ids are URL surface and stay put — a depot supervisor's bookmark to
 * `?tab=bunching` keeps working — while the labels say what the section is
 * about. "Bunching" is the one that mattered: it is this industry's word for
 * buses closing up on each other, and it is not a word a reader outside the
 * industry can guess from. "Standby" and "Roster" go the same way; each is a
 * noun the screen never explains.
 */
export const DEPOT_TAB_LABEL: Record<DepotTabId, string> = {
  running: 'Running order',
  bunching: 'Buses closing up',
  schedule: 'Timetable',
  standby: 'Buses free',
  roster: 'All buses',
  reports: 'Breakdowns',
};

export function isDepotTab(value: string | undefined): value is DepotTabId {
  return value !== undefined && (DEPOT_TAB_ORDER as readonly string[]).includes(value);
}
