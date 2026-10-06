/**
 * Navigation model for the Depot Management shell.
 *
 * An entry is added here only when its page exists: a link to a page that is
 * not built yet is a dead end. Depot-scope pages (cockpit, roster, yard) have
 * their own sub-navigation, since they belong to one depot.
 */
export const DEPOTS_ROOT = '/project/depots';

export interface DepotNavItem {
  readonly href: string;
  readonly label: string;
  /** Match only the exact path (used for a section's index page). */
  readonly exact?: boolean;
}

export interface DepotNavGroup {
  readonly heading: string;
  readonly items: readonly DepotNavItem[];
}

export const NETWORK_NAV: readonly DepotNavGroup[] = [
  {
    heading: 'Network',
    items: [
      { href: DEPOTS_ROOT, label: 'Overview', exact: true },
      { href: `${DEPOTS_ROOT}/league`, label: 'League table' },
      { href: `${DEPOTS_ROOT}/rebalance`, label: 'Fleet distribution' },
      { href: `${DEPOTS_ROOT}/routes`, label: 'Routes' },
      { href: `${DEPOTS_ROOT}/exceptions`, label: 'Exceptions' },
      { href: `${DEPOTS_ROOT}/economics`, label: 'Economics' },
      { href: `${DEPOTS_ROOT}/trends`, label: 'Trends' },
    ],
  },
  {
    heading: 'Intelligence',
    items: [{ href: `${DEPOTS_ROOT}/ask`, label: 'Ask' }],
  },
  {
    heading: 'System',
    items: [{ href: `${DEPOTS_ROOT}/sources`, label: 'Data sources' }],
  },
];

function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

export function isNavItemActive(pathname: string, item: DepotNavItem): boolean {
  const path = stripTrailingSlash(pathname);
  if (item.exact) return path === item.href;
  return path === item.href || path.startsWith(`${item.href}/`);
}
