/**
 * The console's tab vocabulary, deliberately in a module with NO directive.
 *
 * ─── WHY THIS IS ITS OWN FILE ────────────────────────────────────────────
 *
 * These exports used to live in ControlRoomConsole.tsx, which carries
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

/**
 * What each tab is called, and what it holds.
 *
 * ─── WHY THESE WORDS ─────────────────────────────────────────────────────
 *
 * The previous six were "Decisions", "Approvals", "Fleet", "Copilot", "Kill
 * switches", "Reports". Four of the six named an internal concept rather than
 * the thing behind them: "Decisions" held the engine's proposal and the list
 * of buses closing up; "Approvals" held three separate surfaces including the
 * form that actually sends an instruction to a driver; "Copilot" is not a word
 * in this audience's vocabulary at all; and "Kill switches" both is jargon and
 * OVERSTATES what the control does — it stops NEW instructions, and ones
 * already sent still stand.
 *
 * A tab label on a console is not decoration. It is the only thing an operator
 * reads before deciding whether the thing they need is behind it, and on this
 * rail five of the six panels are one click from being invisible.
 *
 * `hint` is rendered under the strip for the ACTIVE tab, so the rail can stay
 * short without the panel underneath being unexplained.
 */
export const TAB_LABEL: Record<ConsoleTabId, string> = {
  decisions: 'What to do now',
  approvals: 'Send an instruction',
  fleet: 'Find a bus',
  copilot: 'Ask the assistant',
  safety: 'Stop instructions',
  reports: 'Breakdowns',
};

/** One line under the strip saying what the open panel actually holds. */
export const TAB_HINT: Record<ConsoleTabId, string> = {
  decisions: 'What the engine suggests for this corridor, and the buses closing up on it now.',
  approvals: 'Approve or refuse what dispatchers have asked for, send an instruction, and follow one already sent.',
  fleet: 'Search every bus in the state by registration, route or depot.',
  copilot: 'Ask about this corridor, or have an incident explained from the evidence recorded for it.',
  safety: 'Stop new instructions being sent, across the whole state or on one corridor.',
  reports: 'Breakdowns filed by drivers from their own console, across the whole fleet.',
};

/** Whether a `?tab=` value names a real tab. A stale bookmark degrades to the default view rather than an empty rail. */
export function isConsoleTab(value: string | undefined): value is ConsoleTabId {
  return value !== undefined && (TAB_ORDER as string[]).includes(value);
}
