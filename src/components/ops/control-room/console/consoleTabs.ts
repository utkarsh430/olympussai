/**
 * The console's tab vocabulary, deliberately in a module with NO directive.
 *
 * ─── WHY THIS IS ITS OWN FILE ────────────────────────────────────────────
 *
 * These four exports used to live in ControlRoomConsole.tsx, which carries
 * 'use client'. The page above it is a Server Component and needs exactly one
 * of them — `isConsoleTab`, to sanity-check `?tab=` before passing it down.
 * Imported across that boundary, `isConsoleTab` is not the function: it is a
 * client-reference proxy, and calling it throws
 *
 *     Attempted to call isConsoleTab() from the server but isConsoleTab is
 *     on the client.
 *
 * on every render. /ops/control-room was a hard HTTP 500 on 100% of requests
 * — in `next dev` and `next start` alike — while `tsc`, `next lint`,
 * `next build` and the whole unit suite stayed green, because none of them
 * models that boundary (the page is `force-dynamic`, so the build never
 * renders it).
 *
 * A plain module both sides import is the whole fix. The values below are
 * ordinary shared constants: the server may call them, the client may call
 * them, and neither gets a proxy. `scripts/lib/clientBoundary.ts` now fails
 * the build if any server module reaches for a value in a 'use client' module
 * again, and points here for the shape of the remedy.
 */

export type ConsoleTabId = 'decisions' | 'approvals' | 'fleet' | 'copilot' | 'safety' | 'reports';

/** Left-to-right order of the rail's tab strip. Also the membership list `isConsoleTab` checks against, so the two can never disagree. */
export const TAB_ORDER: ConsoleTabId[] = [
  'decisions',
  'approvals',
  'fleet',
  'copilot',
  'safety',
  'reports',
];

export const TAB_LABEL: Record<ConsoleTabId, string> = {
  decisions: 'Decisions',
  approvals: 'Approvals',
  fleet: 'Fleet',
  copilot: 'Copilot',
  safety: 'Kill switches',
  reports: 'Reports',
};

/** Whether a `?tab=` value names a real tab. A stale bookmark degrades to the default view rather than an empty rail. */
export function isConsoleTab(value: string | undefined): value is ConsoleTabId {
  return value !== undefined && (TAB_ORDER as string[]).includes(value);
}
