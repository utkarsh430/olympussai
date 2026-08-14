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
export const DEPOT_TAB_ORDER = ['running', 'bunching', 'schedule', 'standby', 'roster', 'reports'] as const;

export type DepotTabId = (typeof DEPOT_TAB_ORDER)[number];

export const DEPOT_TAB_LABEL: Record<DepotTabId, string> = {
  running: 'Running order',
  bunching: 'Bunching',
  schedule: 'Schedule',
  standby: 'Standby',
  roster: 'Roster',
  reports: 'Reports',
};

export function isDepotTab(value: string | undefined): value is DepotTabId {
  return value !== undefined && (DEPOT_TAB_ORDER as readonly string[]).includes(value);
}
