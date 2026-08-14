/**
 * What each persona can navigate to inside the operations console.
 *
 * Until now there was no navigation at all: every ops screen was reachable
 * only by typing its URL, and the handful of cross-links that existed were
 * one-off `← Back to …` paragraphs written into individual pages. Four of
 * the twelve pages had one; the other eight were dead ends.
 *
 * ─── THIS IS NOT AN AUTHORIZATION BOUNDARY ───────────────────────────────
 *
 * It decides what a role is SHOWN, and nothing else. Every destination below
 * is independently enforced by `requireOpsRolePage` in its own route
 * segment, which re-reads `ops_users` per render (src/lib/auth/rbac/
 * pageGuard.ts). Adding a row here grants nothing; removing one hides a link
 * to a page that stays exactly as guarded as it was. Keep it that way — a
 * navigation table that starts being trusted as a permission list is a
 * boundary nobody remembers is load-bearing.
 *
 * The `role` keys must stay in step with the guard each page actually calls,
 * and a test asserts exactly that against the App Router directory
 * (src/tests/unit/opsShell.test.tsx), so a thirteenth page cannot be added
 * with a nav entry pointing at a role that cannot open it.
 */
import type { OpsRole } from '@/lib/auth/rbac/roles';

export interface OpsNavItem {
  /** Route this entry links to. Absolute, always under /ops. */
  readonly href: string;
  /** Short label. Rendered uppercase by the nav; write it in sentence case. */
  readonly label: string;
  /**
   * Extra routes that should light this entry up as the current one —
   * detail screens with no nav entry of their own, such as an individual
   * incident timeline. Matched as a path prefix.
   */
  readonly matches?: readonly string[];
}

/**
 * The console's persona map. `admin` has no operational dashboard by design
 * (see OPERATIONAL_ROLES in src/lib/auth/rbac/roles.ts) — it does not drive
 * the fleet, it decides who may and what they may do to it. `/ops/admin` is
 * the console that says so, and it is a real page now: for as long as the
 * admin role has existed, `/ops/admin` was a 404 and the landing logic
 * carried a hard-coded detour around it (src/lib/auth/landing.ts).
 */
export const OPS_NAV: Record<OpsRole, readonly OpsNavItem[]> = {
  control_room: [
    {
      href: '/ops/control-room',
      label: 'Control room',
      // The incident timeline is reached from observability but belongs to
      // the control room; without this it would light nothing up and the
      // operator would lose their place.
      matches: ['/ops/control-room/incidents'],
    },
    { href: '/ops/control-room/observability', label: 'Observability' },
    { href: '/ops/control-room/copilot', label: 'Copilot' },
    { href: '/ops/control-room/pilot', label: 'Pilot staging' },
  ],
  dispatcher: [{ href: '/ops/dispatcher', label: 'Dispatcher' }],
  depot: [{ href: '/ops/depot', label: 'Depot' }],
  planner: [{ href: '/ops/planner', label: 'Planner' }],
  driver: [{ href: '/ops/driver', label: 'Driver' }],
  pilot_driver: [{ href: '/ops/pilot-driver', label: 'Commands' }],
  admin: [
    { href: '/ops/admin', label: 'Overview' },
    // The URL still says "invites" because that is where the screen started
    // and a live console's addresses are not worth churning; the screen itself
    // is the whole people surface — roster, roles, assignments and invites.
    { href: '/ops/admin/invites', label: 'People' },
    { href: '/ops/admin/rollout-stages', label: 'Rollout stages' },
    { href: '/ops/admin/network', label: 'Network' },
  ],
};

/** Human label for a role, for the shell's persona line. */
export const OPS_ROLE_LABEL: Record<OpsRole, string> = {
  control_room: 'Control room',
  dispatcher: 'Dispatcher',
  depot: 'Depot',
  planner: 'Planner',
  driver: 'Driver',
  pilot_driver: 'Pilot driver',
  admin: 'Administrator',
};

/**
 * Which nav entry the given pathname belongs to, or null when none does.
 *
 * Longest-href-wins rather than first-match: `/ops/control-room` is a prefix
 * of every other control-room route, so a naive prefix scan would highlight
 * "Control room" while the operator is reading Observability.
 */
export function activeNavHref(
  items: readonly OpsNavItem[],
  pathname: string | null | undefined,
): string | null {
  if (!pathname) return null;

  let best: OpsNavItem | null = null;
  let bestLength = -1;

  for (const item of items) {
    for (const candidate of [item.href, ...(item.matches ?? [])]) {
      const isMatch = pathname === candidate || pathname.startsWith(`${candidate}/`);
      if (isMatch && candidate.length > bestLength) {
        best = item;
        bestLength = candidate.length;
      }
    }
  }

  return best?.href ?? null;
}
