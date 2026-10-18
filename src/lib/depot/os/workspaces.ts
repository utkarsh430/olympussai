import { depotHref, depotIdFromPath } from '../depotNav';
import {
  ASK_PATH,
  DEPOTS_ROOT,
  ECONOMICS_PATH,
  EXCEPTIONS_PATH,
  INCIDENTS_PATH,
  LEAGUE_PATH,
  NETWORK_TRENDS_PATH,
  REBALANCE_PATH,
  ROUTES_PATH,
  SCHEDULER_PATH,
  SERVICE_PATH,
  SOURCES_PATH,
} from '../nav';

/**
 * Depot Intelligence OS: the module's twenty-odd pages gathered into six workspaces and
 * a small System section. Every view names where it lives at Headquarters scope and in
 * one depot's scope; a view that exists in only one of them says so with null, and the
 * shell then offers the other scope's way in (the depot chooser, or Headquarters).
 *
 * Pure, so the rail, the tabs, the command palette and the context selector all read one
 * model and agree on which view is current.
 */

export const MISSION_PATH = DEPOTS_ROOT;
export const OVERVIEW_PATH = `${DEPOTS_ROOT}/overview`;
export const DECISIONS_PATH = `${DEPOTS_ROOT}/decisions`;
export const OPTIMISATION_PATH = `${DEPOTS_ROOT}/optimisation`;
export const HEADWAYS_PATH = `${DEPOTS_ROOT}/headways`;
export const OPERATIONS_PATH = `${DEPOTS_ROOT}/operations`;
export const RELIABILITY_PATH = `${DEPOTS_ROOT}/reliability`;
export const FUEL_AUDIT_PATH = `${DEPOTS_ROOT}/fuel-audit`;
export const REVENUE_INTEL_PATH = `${DEPOTS_ROOT}/revenue-intelligence`;
export const COST_PATH = `${DEPOTS_ROOT}/cost`;
export const PERFORMANCE_PATH = `${DEPOTS_ROOT}/performance`;
export const FORECASTS_PATH = `${DEPOTS_ROOT}/forecasts`;
export const SIMULATION_PATH = `${DEPOTS_ROOT}/simulation`;
export const TWIN_PATH = `${DEPOTS_ROOT}/twin`;
export const DATA_HEALTH_PATH = `${DEPOTS_ROOT}/data-health`;
export const CHOOSE_DEPOT_PATH = `${DEPOTS_ROOT}/choose`;
export const BUNCHING_PATH = '/project/bunching';

export type WorkspaceId =
  | 'mission'
  | 'network'
  | 'operations'
  | 'reliability'
  | 'finance'
  | 'performance'
  | 'system';

/** A depot-scope path below the depot's own root, e.g. `readiness`; '' is the root. */
type DepotLeaf = string;

export interface WorkspaceView {
  /** Unique across the model; the command palette and the depot chooser key on it. */
  readonly key: string;
  readonly label: string;
  /** Headquarters address, or null when the view runs per depot only. */
  readonly network: string | null;
  /** Leaf under `/d/[depotId]`, or null when the view is Headquarters only. */
  readonly depot: DepotLeaf | null;
  /** Search words beyond the label, for the command palette. */
  readonly keywords?: string;
  /** Leaves the module (the Operations dashboard's own tools). */
  readonly external?: boolean;
  /** Match only the exact address (a section's index page). */
  readonly exact?: boolean;
}

export interface Workspace {
  readonly id: WorkspaceId;
  /** Two-digit ordinal shown before the title; empty for System. */
  readonly ordinal: string;
  readonly title: string;
  /** One line under the title in the rail's tooltip and the palette. */
  readonly summary: string;
  readonly views: readonly WorkspaceView[];
}

export const WORKSPACES: readonly Workspace[] = [
  {
    id: 'mission',
    ordinal: '01',
    title: 'Mission Control',
    summary: 'Fleet status, the AI decision queue and what needs attention now.',
    views: [
      { key: 'mission', label: 'Mission Control', network: MISSION_PATH, depot: '', exact: true, keywords: 'home command cockpit priority' },
      { key: 'overview', label: 'Operations Overview', network: OVERVIEW_PATH, depot: 'cockpit', keywords: 'overview cockpit map ranking' },
      { key: 'decisions', label: 'AI Decision Center', network: DECISIONS_PATH, depot: 'decisions', keywords: 'decision queue recommendation review approval trail' },
      { key: 'exceptions', label: 'Critical Exceptions', network: EXCEPTIONS_PATH, depot: null, keywords: 'exceptions alerts anomalies' },
    ],
  },
  {
    id: 'network',
    ordinal: '02',
    title: 'Network Intelligence',
    summary: 'Hourly demand, redistribution, scheduling, coverage and headways.',
    views: [
      { key: 'demand', label: 'Hourly Demand', network: SERVICE_PATH, depot: null, keywords: 'demand heatmap hour route redistribution engine shortage surplus' },
      { key: 'rebalance', label: 'Between Depots', network: REBALANCE_PATH, depot: null, keywords: 'fleet distribution inter-depot transfer redistribution' },
      { key: 'optimisation', label: 'Network Optimisation', network: OPTIMISATION_PATH, depot: null, keywords: 'combined optimisation before after impact coverage' },
      { key: 'scheduler', label: 'AI Scheduling', network: SCHEDULER_PATH, depot: 'schedule', keywords: 'scheduler gantt blocks duties crew plan' },
      { key: 'routes', label: 'Service Coverage', network: ROUTES_PATH, depot: null, keywords: 'routes coverage allocation dead km' },
      { key: 'headways', label: 'Headways & Bunching', network: HEADWAYS_PATH, depot: null, keywords: 'bunching headway spacing gap' },
    ],
  },
  {
    id: 'operations',
    ordinal: '03',
    title: 'Depot Operations',
    summary: 'Departure readiness, roster, yard, duties and crew for one depot.',
    views: [
      { key: 'readiness', label: 'Dispatch Readiness', network: OPERATIONS_PATH, depot: 'readiness', keywords: 'departures ready blocked at risk dispatch board' },
      { key: 'roster', label: 'Fleet Roster', network: null, depot: 'roster', keywords: 'buses vehicles roster list' },
      { key: 'yard', label: 'Yard Intelligence', network: null, depot: 'yard', keywords: 'yard parking map visitors' },
      { key: 'duties', label: 'Duties', network: null, depot: 'duties', keywords: 'duty allocation vehicle assignment' },
      { key: 'crew', label: 'Crew', network: null, depot: 'crew', keywords: 'drivers conductors shift coverage' },
    ],
  },
  {
    id: 'reliability',
    ordinal: '04',
    title: 'Fleet Reliability',
    summary: 'Fleet health, predictive maintenance, breakdowns and recovery.',
    views: [
      { key: 'health', label: 'Fleet Health', network: RELIABILITY_PATH, depot: 'health', keywords: 'health availability maintenance risk' },
      { key: 'maintenance', label: 'Predictive Maintenance', network: null, depot: 'maintenance', keywords: 'maintenance service due workshop bays' },
      { key: 'incidents', label: 'Incident Response', network: INCIDENTS_PATH, depot: 'incidents', keywords: 'breakdown incident replacement recovery' },
      { key: 'disruption', label: 'Disruption Propagation', network: null, depot: 'disruption', keywords: 'knock-on downstream propagation dependency' },
    ],
  },
  {
    id: 'finance',
    ordinal: '05',
    title: 'Financial Intelligence',
    summary: 'Fuel audit, revenue, route economics and cost optimisation.',
    views: [
      { key: 'fuel-audit', label: 'Fuel Audit', network: FUEL_AUDIT_PATH, depot: 'fuel-audit', keywords: 'fuel anomaly audit excess consumption km/l investigation' },
      { key: 'fuel', label: 'Fuel & Cost', network: null, depot: 'fuel', keywords: 'fuel cost diesel economy' },
      { key: 'revenue', label: 'Revenue Intelligence', network: REVENUE_INTEL_PATH, depot: 'revenue', keywords: 'revenue ticketing earnings load factor leakage' },
      { key: 'economics', label: 'Route Economics', network: ECONOMICS_PATH, depot: null, keywords: 'economics route contribution' },
      { key: 'cost', label: 'Cost Optimisation', network: COST_PATH, depot: null, keywords: 'cost saving avoidable efficiency utilisation' },
    ],
  },
  {
    id: 'performance',
    ordinal: '06',
    title: 'Performance & Simulation',
    summary: 'Benchmarks, trends, forecasts, scenarios and the digital twin.',
    views: [
      { key: 'performance', label: 'Depot Performance', network: PERFORMANCE_PATH, depot: null, keywords: 'performance benchmark efficiency index comparison' },
      { key: 'league', label: 'League Table', network: LEAGUE_PATH, depot: null, keywords: 'league ranking peers' },
      { key: 'trends', label: 'Historical Trends', network: NETWORK_TRENDS_PATH, depot: 'trends', keywords: 'trends history' },
      { key: 'forecasts', label: 'Predictive Forecasts', network: FORECASTS_PATH, depot: null, keywords: 'forecast prediction availability workload' },
      { key: 'simulation', label: 'Scenario Studio', network: SIMULATION_PATH, depot: null, keywords: 'what-if scenario simulation lever' },
      { key: 'twin', label: 'Digital Twin', network: TWIN_PATH, depot: 'twin', keywords: 'digital twin schematic network depot' },
    ],
  },
  {
    id: 'system',
    ordinal: '',
    title: 'System',
    summary: 'Data sources, integration health and the AI Engine console.',
    views: [
      { key: 'sources', label: 'Data Sources', network: SOURCES_PATH, depot: null, keywords: 'sources feeds provenance' },
      { key: 'data-health', label: 'Integration Health', network: DATA_HEALTH_PATH, depot: null, keywords: 'integration data quality completeness coverage' },
      { key: 'ask', label: 'AI Engine Console', network: ASK_PATH, depot: null, keywords: 'copilot ask question engine' },
    ],
  },
];

export const OPERATIONAL_WORKSPACES = WORKSPACES.filter((w) => w.id !== 'system');

const VIEW_BY_KEY: ReadonlyMap<string, { view: WorkspaceView; workspace: Workspace }> = new Map(
  WORKSPACES.flatMap((workspace) => workspace.views.map((view) => [view.key, { view, workspace }] as const)),
);

export function viewByKey(key: string): { view: WorkspaceView; workspace: Workspace } | null {
  return VIEW_BY_KEY.get(key) ?? null;
}

function strip(pathname: string): string {
  const end = pathname.search(/[?#]/);
  const path = end === -1 ? pathname : pathname.slice(0, end);
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function matches(path: string, href: string, exact: boolean): boolean {
  return exact ? path === href : path === href || path.startsWith(`${href}/`);
}

/** The address of a view in a scope, or null when the view has none there. */
export function viewHref(view: WorkspaceView, depotId: string | null): string | null {
  if (depotId === null) return view.network;
  if (view.depot === null) return null;
  const root = depotHref(depotId);
  return view.depot === '' ? root : `${root}/${view.depot}`;
}

/**
 * Where a view's link goes from a scope: its own address there when it has one; else,
 * from a depot, the Headquarters address (League table is a network view); else, at
 * Headquarters, the depot chooser for that view.
 */
export function viewLink(view: WorkspaceView, depotId: string | null): string {
  const own = viewHref(view, depotId);
  if (own !== null) return own;
  if (depotId !== null && view.network !== null) return view.network;
  return `${CHOOSE_DEPOT_PATH}?view=${encodeURIComponent(view.key)}`;
}

export interface ActiveView {
  readonly workspace: Workspace;
  readonly view: WorkspaceView | null;
}

/**
 * The workspace and view a path belongs to. Depot paths match on their leaf; network
 * paths on their address (longest match wins, so `/routes/r/x` stays on Service Coverage).
 * The chooser belongs to the view it is choosing for.
 */
export function activeView(pathname: string, search = ''): ActiveView | null {
  const path = strip(pathname);
  const depotId = depotIdFromPath(path);
  if (path === CHOOSE_DEPOT_PATH) {
    const key = new URLSearchParams(search).get('view');
    const found = key ? viewByKey(key) : null;
    return found ? { workspace: found.workspace, view: found.view } : null;
  }
  let best: { workspace: Workspace; view: WorkspaceView; length: number } | null = null;
  for (const workspace of WORKSPACES) {
    for (const view of workspace.views) {
      const href = viewHref(view, depotId);
      if (href === null || view.external) continue;
      const exact = view.exact === true || (depotId !== null && view.depot === '');
      if (!matches(path, href, exact)) continue;
      if (!best || href.length > best.length) best = { workspace, view, length: href.length };
    }
  }
  return best ? { workspace: best.workspace, view: best.view } : null;
}

/**
 * The same view in another scope, so switching context keeps the person where they are:
 * the view's address there, or that scope's Mission Control when it has none.
 */
export function equivalentHref(pathname: string, search: string, toDepotId: string | null): string {
  const active = activeView(pathname, search);
  const view = active?.view;
  const own = view ? viewHref(view, toDepotId) : null;
  if (own !== null) return own;
  return toDepotId === null ? MISSION_PATH : depotHref(toDepotId);
}
