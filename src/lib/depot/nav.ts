/**
 * Navigation model for the Depot Management shell.
 *
 * An entry is added here only when its page exists: a link to a page that is
 * not built yet is a dead end. A depot's own pages are listed by `depotNav`
 * (`depotNav.ts`), since they belong to one depot.
 */
export const DEPOTS_ROOT = '/project/depots';

/** The network pages' paths: every link and page guard reads these, so each is spelt once. */
export const LEAGUE_PATH = `${DEPOTS_ROOT}/league`;
export const REBALANCE_PATH = `${DEPOTS_ROOT}/rebalance`;
export const ROUTES_PATH = `${DEPOTS_ROOT}/routes`;
export const EXCEPTIONS_PATH = `${DEPOTS_ROOT}/exceptions`;
export const ECONOMICS_PATH = `${DEPOTS_ROOT}/economics`;
export const NETWORK_TRENDS_PATH = `${DEPOTS_ROOT}/trends`;
export const ASK_PATH = `${DEPOTS_ROOT}/ask`;
export const SERVICE_PATH = `${DEPOTS_ROOT}/service`;
export const SOURCES_PATH = `${DEPOTS_ROOT}/sources`;

/**
 * One route's day hour by hour, under the Routes page (so its rail item stays lit). The
 * name is encoded: a feed route name is letters, digits, `_` and `-`, but the path never
 * trusts that.
 */
export function routeHourlyPath(routeName: string): string {
  return `${ROUTES_PATH}/r/${encodeURIComponent(routeName)}`;
}

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
    heading: 'Headquarters',
    items: [
      { href: DEPOTS_ROOT, label: 'Overview', exact: true },
      { href: LEAGUE_PATH, label: 'League table' },
      { href: REBALANCE_PATH, label: 'Fleet distribution' },
      { href: ROUTES_PATH, label: 'Routes' },
      { href: EXCEPTIONS_PATH, label: 'Exceptions' },
      { href: ECONOMICS_PATH, label: 'Economics' },
      { href: NETWORK_TRENDS_PATH, label: 'Headquarters trends' },
    ],
  },
  {
    heading: 'Intelligence',
    items: [
      { href: SERVICE_PATH, label: 'Service by the hour' },
      { href: ASK_PATH, label: 'AI Engine' },
    ],
  },
  {
    heading: 'System',
    items: [{ href: SOURCES_PATH, label: 'Data sources' }],
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
