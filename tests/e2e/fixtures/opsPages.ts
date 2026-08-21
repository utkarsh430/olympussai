/**
 * Every guarded ops page, the role that owns it, and the heading its shell
 * renders.
 *
 * ─── WHY THIS IS A MODULE AND NOT A CONST IN THE SPEC ────────────────────
 *
 * It used to be a hand-maintained array inside ops-dashboard-pages.spec.ts,
 * and it drifted twice. The second time, the admin console was renamed into
 * plain English — "Admin · People" became "People", "Admin · Rollout stages"
 * became "Command permissions", "Admin · Network" became "Network coverage" —
 * the pages worked, the pathname assertions passed, and the suite went to
 * 20/23 because the table still expected the old headings.
 *
 * That drift was invisible until CI, for a specific and fixable reason: this
 * suite needs an ops database and a seeded account per role, so it SKIPS
 * locally. Every check inside it, including the one that cross-references the
 * App Router directory, only ever ran in CI. A contributor renaming a heading
 * had nothing that could tell them.
 *
 * So the table lives here, where a plain unit test can reach it without
 * Playwright, a database or a running server: src/tests/unit/opsPageTitles
 * .test.ts asserts every row's `title` against the `OpsShell title=` the page
 * actually declares, and every row's `role` against the guard the page
 * actually calls. `pnpm test` now fails in seconds on a rename that would
 * previously have gone red in CI, minutes later, on somebody else's branch.
 *
 * ─── WHY NOT DERIVE IT FROM THE NAV, OR FROM THE PAGES ───────────────────
 *
 * The nav is the wrong source: OPS_NAV's labels are deliberately NOT these
 * headings. `/ops/admin` is "Overview" in the nav and "Admin" as a heading,
 * `/ops/control-room/observability` is "One corridor" against "One Corridor
 * In Detail", `/ops/pilot-driver` is "Commands" against "Pilot Driver". A nav
 * entry is a sidebar word; a heading names the screen. Deriving one from the
 * other would force them to be the same word and lose that distinction.
 *
 * Generating these titles from the page sources at test time was the other
 * option, and it is rejected on purpose: the e2e assertion would then be
 * comparing a page against itself, and could no longer tell "the dashboard
 * rendered" from "something rendered". The expectation stays written down and
 * independent — a cheap, always-on test keeps it honest.
 */

/** The seven ops roles. One seeded account per role; every page belongs to one. */
export type OpsRoleName =
  | 'admin'
  | 'driver'
  | 'pilot_driver'
  | 'dispatcher'
  | 'depot'
  | 'control_room'
  | 'planner';

export interface OpsPageRow {
  /** The address an operator actually visits. Dynamic segments carry a concrete id. */
  readonly path: string;
  /** The role whose `requireOpsRolePage` guard this page calls. */
  readonly role: OpsRoleName;
  /**
   * The `<h1>` the page's OpsShell renders.
   *
   * This is what makes the e2e check an "it opened" one rather than an "it
   * answered 200" one: a redirect chain landing on the sign-in page is also a
   * 200. Kept in step with the pages by opsPageTitles.test.ts.
   */
  readonly title: string;
}

export const OPS_PAGES: readonly OpsPageRow[] = [
  { path: '/ops/driver', role: 'driver', title: 'Driver' },
  { path: '/ops/pilot-driver', role: 'pilot_driver', title: 'Pilot Driver' },
  { path: '/ops/dispatcher', role: 'dispatcher', title: 'Dispatcher' },
  { path: '/ops/depot', role: 'depot', title: 'Depot' },
  { path: '/ops/planner', role: 'planner', title: 'Planner' },
  { path: '/ops/control-room', role: 'control_room', title: 'Control Room' },
  { path: '/ops/control-room/copilot', role: 'control_room', title: 'Assistant' },
  // The network-wide alert inbox. Nothing is seeded for it either: an empty
  // list is a legitimate state and the assertion here is that the guarded
  // shell renders, not that a bunching incident exists to fill it.
  { path: '/ops/control-room/alerts', role: 'control_room', title: 'Alerts' },
  // Nothing seeded for this id on purpose: the timeline must still render its
  // shell (the point here is the guard, not the incident data).
  {
    path: '/ops/control-room/observability',
    role: 'control_room',
    title: 'One Corridor In Detail',
  },
  { path: '/ops/control-room/pilot', role: 'control_room', title: 'Rollout' },
  {
    path: '/ops/control-room/incidents/e2e-nonexistent-incident',
    role: 'control_room',
    title: 'Incident Timeline',
  },
  // `/ops/admin` was a 404 for as long as the admin role existed — the segment
  // had a layout, `invites/` and `rollout-stages/` and no page — and the
  // landing logic carried a hard-coded detour around it. It is the admin
  // console's own overview now, and it is where an admin lands.
  { path: '/ops/admin', role: 'admin', title: 'Admin' },
  // The three admin URLs still say `invites`, `rollout-stages` and `network`
  // because a live console's addresses are not worth churning. The HEADINGS
  // say what an administrator goes there to do, which is what these rows have
  // to track — "Rollout stages" in particular was a pilot-programme word for
  // the setting that decides whether an instruction can reach a driver at all.
  { path: '/ops/admin/invites', role: 'admin', title: 'People' },
  { path: '/ops/admin/rollout-stages', role: 'admin', title: 'Command permissions' },
  { path: '/ops/admin/network', role: 'admin', title: 'Network coverage' },
];
