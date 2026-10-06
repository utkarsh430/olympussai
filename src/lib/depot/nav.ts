/** Navigation model for the Depot Management shell. Later phases add items. */
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
  { heading: 'Network', items: [{ href: DEPOTS_ROOT, label: 'Overview', exact: true }] },
];

function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

export function isNavItemActive(pathname: string, item: DepotNavItem): boolean {
  const path = stripTrailingSlash(pathname);
  if (item.exact) return path === item.href;
  return path === item.href || path.startsWith(`${item.href}/`);
}
