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
 * Depot Intelligence OS: every feature of the module as one entry of the sidebar tree,
 * gathered into six workspaces and a small System section. Every view names where it
 * lives at Headquarters scope and in one depot's scope; a view that exists in only one of
 * them says so with null, and the shell then offers the other scope's way in (the depot
 * chooser, or Headquarters). Entries that open a part of a shared page carry its query.
 *
 * Pure, so the sidebar, the tabs, the command palette and the context selector all read one
 * model and agree on which view is current.
 */

export const MISSION_PATH = DEPOTS_ROOT;
export const OVERVIEW_PATH = `${DEPOTS_ROOT}/overview`;
export const DECISIONS_PATH = `${DEPOTS_ROOT}/decisions`;
export const ACTIVITY_PATH = `${DEPOTS_ROOT}/activity`;
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
export const SETTINGS_PATH = `${DEPOTS_ROOT}/settings`;
export const CHOOSE_DEPOT_PATH = `${DEPOTS_ROOT}/choose`;
export const BUNCHING_PATH = '/project/bunching';

/** Anchors a sidebar entry opens inside a shared page (`?section=`). */
export const SECTION_ANCHOR = {
  demandHeatmap: 'demand-supply-heatmap',
  transfers: 'inter-depot-transfers',
  bayPlan: 'bay-plan',
  departureTimeline: 'departure-timeline',
  anomalyQueue: 'anomaly-queue',
} as const;

export type WorkspaceId =
  | 'mission'
  | 'network'
  | 'operations'
  | 'reliability'
  | 'finance'
  | 'performance'
  | 'system';

/**
 * What an AI-enabled entry does, for the sidebar's glyph and the capability index:
 * watching (monitor), projecting (predict), proposing a better plan (optimize), flagging
 * the unusual (anomaly), ranking actions (recommend) or recomputing a what-if (simulate).
 * A conventional view has none.
 */
export type AiKind = 'monitor' | 'predict' | 'optimize' | 'anomaly' | 'recommend' | 'simulate';

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
  /** A query that opens a subview of a shared page, e.g. `section=bay-plan`. */
  readonly query?: string;
  /** Search words beyond the label, for the command palette and the sidebar filter. */
  readonly keywords?: string;
  /** Leaves the module (the Operations dashboard's own tools). */
  readonly external?: boolean;
  /** Match only the exact address (a section's index page). */
  readonly exact?: boolean;
  readonly ai?: AiKind;
  /** One of the module's flagship capabilities, lit a little brighter in the sidebar. */
  readonly flagship?: boolean;
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

const section = (anchor: string): string => `section=${anchor}`;

export const WORKSPACES: readonly Workspace[] = [
  {
    id: 'mission',
    ordinal: '01',
    title: 'Mission Control',
    summary: 'Fleet status, the AI decision queue and what needs attention now.',
    views: [
      { key: 'mission', label: 'Network Command Center', network: MISSION_PATH, depot: null, exact: true, ai: 'monitor', keywords: 'home mission control command headquarters network priority' },
      { key: 'depot-mission', label: 'Depot Command Center', network: null, depot: '', ai: 'monitor', keywords: 'depot mission control command cockpit priority' },
      { key: 'decisions', label: 'AI Decision Center', network: DECISIONS_PATH, depot: 'decisions', ai: 'recommend', keywords: 'decision queue recommendation review approval trail' },
      { key: 'exceptions', label: 'Operational Alerts', network: EXCEPTIONS_PATH, depot: null, ai: 'anomaly', keywords: 'exceptions alerts anomalies critical' },
      { key: 'activity', label: 'Network Activity', network: ACTIVITY_PATH, depot: 'activity', ai: 'monitor', keywords: 'ai activity stream analysis log events engine' },
      { key: 'overview', label: 'Fleet Status', network: OVERVIEW_PATH, depot: 'cockpit', keywords: 'overview cockpit map ranking fleet state' },
    ],
  },
  {
    id: 'network',
    ordinal: '02',
    title: 'Network Intelligence',
    summary: 'Redistribution, demand, routes, bunching and capacity across depots.',
    views: [
      { key: 'redistribution', label: 'AI Redistribution Engine', network: SERVICE_PATH, depot: null, ai: 'optimize', flagship: true, keywords: 'redistribution engine route hour moves recommendations impact' },
      { key: 'demand', label: 'Hourly Demand Forecast', network: SERVICE_PATH, depot: null, query: section(SECTION_ANCHOR.demandHeatmap), ai: 'predict', keywords: 'demand heatmap hour route shortage surplus forecast' },
      { key: 'optimisation', label: 'AI Route Optimization', network: OPTIMISATION_PATH, depot: null, ai: 'optimize', keywords: 'combined optimisation before after impact coverage band' },
      { key: 'routes', label: 'Route Intelligence', network: ROUTES_PATH, depot: null, keywords: 'routes coverage allocation dead km profile' },
      { key: 'headways', label: 'Bunching Prediction', network: HEADWAYS_PATH, depot: null, ai: 'predict', keywords: 'bunching headway spacing gap' },
      { key: 'capacity', label: 'Network Capacity Planning', network: REBALANCE_PATH, depot: null, ai: 'simulate', keywords: 'capacity fleet distribution balance peak requirement sandbox' },
      { key: 'rebalance', label: 'Inter-Depot Transfers', network: REBALANCE_PATH, depot: null, query: section(SECTION_ANCHOR.transfers), ai: 'optimize', keywords: 'inter-depot transfer redistribution min-cost flow' },
    ],
  },
  {
    id: 'operations',
    ordinal: '03',
    title: 'Depot Operations',
    summary: 'Roster, yard, readiness, scheduling, duties and crew for one depot.',
    views: [
      { key: 'roster', label: 'Fleet Roster', network: null, depot: 'roster', keywords: 'buses vehicles roster list' },
      { key: 'yard', label: 'Yard Intelligence', network: null, depot: 'yard', ai: 'monitor', keywords: 'yard parking map visitors' },
      { key: 'readiness', label: 'Dispatch Readiness', network: OPERATIONS_PATH, depot: 'readiness', ai: 'predict', keywords: 'departures ready blocked at risk dispatch board' },
      { key: 'bus-scheduler', label: 'AI Bus Scheduler', network: SCHEDULER_PATH, depot: 'schedule', ai: 'optimize', flagship: true, keywords: 'scheduler gantt blocks bus schedule generate optimal plan' },
      { key: 'crew-scheduler', label: 'AI Crew Scheduler', network: null, depot: 'crew-scheduler', ai: 'optimize', flagship: true, keywords: 'crew roster driver conductor shifts generate rest overtime' },
      { key: 'joint-optimizer', label: 'Joint Fleet & Crew Optimizer', network: null, depot: 'optimizer', ai: 'optimize', flagship: true, keywords: 'joint fleet crew optimizer combined depot operations coverage' },
      { key: 'duties', label: 'Duty Management', network: null, depot: 'duties', keywords: 'duty allocation vehicle assignment' },
      { key: 'departures', label: 'Departure Timeline', network: null, depot: 'readiness', query: section(SECTION_ANCHOR.departureTimeline), keywords: 'departure timeline turn-out hour' },
      { key: 'crew', label: 'Crew Availability', network: null, depot: 'crew', keywords: 'drivers conductors shift coverage leave' },
    ],
  },
  {
    id: 'reliability',
    ordinal: '04',
    title: 'Fleet Reliability',
    summary: 'Fleet health, predictive maintenance, breakdowns and recovery.',
    views: [
      { key: 'health', label: 'Fleet Health Monitor', network: RELIABILITY_PATH, depot: 'health', ai: 'monitor', keywords: 'health availability risk index' },
      { key: 'maintenance', label: 'Predictive Maintenance', network: null, depot: 'maintenance', ai: 'predict', keywords: 'maintenance service due workshop preventive' },
      { key: 'bays', label: 'Maintenance Scheduling', network: null, depot: 'health', query: section(SECTION_ANCHOR.bayPlan), ai: 'optimize', keywords: 'workshop bays plan week maintenance schedule' },
      { key: 'breakdowns', label: 'Breakdown Detection', network: INCIDENTS_PATH, depot: null, ai: 'anomaly', keywords: 'breakdown detection incidents network rollup' },
      { key: 'incidents', label: 'AI Incident Response', network: null, depot: 'incidents', ai: 'recommend', keywords: 'incident response replacement recovery' },
      { key: 'disruption', label: 'Recovery Planning', network: null, depot: 'disruption', ai: 'simulate', keywords: 'knock-on downstream propagation recovery spare' },
    ],
  },
  {
    id: 'finance',
    ordinal: '05',
    title: 'Financial Intelligence',
    summary: 'Fuel audit, revenue, route economics and cost optimisation.',
    views: [
      { key: 'fuel', label: 'Fuel Intelligence', network: null, depot: 'fuel', keywords: 'fuel cost diesel economy class route' },
      { key: 'fuel-audit', label: 'AI Fuel Audit', network: FUEL_AUDIT_PATH, depot: 'fuel-audit', ai: 'anomaly', keywords: 'fuel audit journey consumption km/l benchmarking' },
      { key: 'fuel-anomalies', label: 'Fuel Anomaly Detection', network: FUEL_AUDIT_PATH, depot: 'fuel-audit', query: section(SECTION_ANCHOR.anomalyQueue), ai: 'anomaly', keywords: 'fuel anomaly excess investigation queue case' },
      { key: 'revenue', label: 'Revenue Intelligence', network: REVENUE_INTEL_PATH, depot: 'revenue', ai: 'anomaly', keywords: 'revenue ticketing earnings load factor leakage' },
      { key: 'economics', label: 'Route Economics', network: ECONOMICS_PATH, depot: null, keywords: 'economics route contribution' },
      { key: 'cost', label: 'Cost Optimization', network: COST_PATH, depot: null, ai: 'optimize', keywords: 'cost saving avoidable efficiency utilisation' },
    ],
  },
  {
    id: 'performance',
    ordinal: '06',
    title: 'Performance & Simulation',
    summary: 'Benchmarks, rankings, trends, scenarios, the twin and forecasts.',
    views: [
      { key: 'performance', label: 'Depot Performance', network: PERFORMANCE_PATH, depot: null, keywords: 'performance benchmark efficiency index comparison' },
      { key: 'league', label: 'Efficiency Rankings', network: LEAGUE_PATH, depot: null, keywords: 'league ranking peers table' },
      { key: 'trends', label: 'Predictive Trends', network: NETWORK_TRENDS_PATH, depot: 'trends', ai: 'predict', keywords: 'trends history projection' },
      { key: 'simulation', label: 'Scenario Simulator', network: SIMULATION_PATH, depot: null, ai: 'simulate', keywords: 'what-if scenario simulation lever studio' },
      { key: 'twin', label: 'Network Digital Twin', network: TWIN_PATH, depot: 'twin', ai: 'simulate', keywords: 'digital twin schematic network depot' },
      { key: 'forecasts', label: 'AI Performance Forecast', network: FORECASTS_PATH, depot: null, ai: 'predict', keywords: 'forecast prediction availability workload' },
    ],
  },
  {
    id: 'system',
    ordinal: '',
    title: 'System',
    summary: 'Data sources, integration health, the AI Engine console and settings.',
    views: [
      { key: 'sources', label: 'Data Sources', network: SOURCES_PATH, depot: null, keywords: 'sources feeds provenance' },
      { key: 'data-health', label: 'Integration Health', network: DATA_HEALTH_PATH, depot: null, keywords: 'integration data quality completeness coverage' },
      { key: 'ask', label: 'AI Engine Console', network: ASK_PATH, depot: null, keywords: 'copilot ask question engine' },
      { key: 'settings', label: 'Settings', network: SETTINGS_PATH, depot: null, keywords: 'settings preferences sidebar analysis cycle reset' },
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
  const path = viewPath(view, depotId);
  return path === null || !view.query ? path : `${path}?${view.query}`;
}

/** The view's address without its subview query. */
function viewPath(view: WorkspaceView, depotId: string | null): string | null {
  if (depotId === null) return view.network;
  if (view.depot === null) return null;
  const root = depotHref(depotId);
  return view.depot === '' ? root : `${root}/${view.depot}`;
}

/** True when every key of the view's subview query is in the address's query. */
function queryHolds(view: WorkspaceView, search: string): boolean {
  if (!view.query) return true;
  const have = new URLSearchParams(search);
  for (const [key, value] of new URLSearchParams(view.query)) if (have.get(key) !== value) return false;
  return true;
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

/** A satisfied subview query outranks any longer plain address. */
const QUERY_WEIGHT = 10_000;

export interface ActiveView {
  readonly workspace: Workspace;
  readonly view: WorkspaceView | null;
}

/**
 * The workspace and view a path belongs to. Depot paths match on their leaf; network
 * paths on their address (longest match wins, so `/routes/r/x` stays on Route
 * Intelligence), and a view with a subview query wins over its page's plain entry when
 * the address carries that query. The chooser belongs to the view it is choosing for.
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
      const href = viewPath(view, depotId);
      if (href === null || view.external) continue;
      const exact = view.exact === true || (depotId !== null && view.depot === '');
      if (!matches(path, href, exact) || !queryHolds(view, search)) continue;
      const length = href.length + (view.query ? QUERY_WEIGHT : 0);
      if (!best || length > best.length) best = { workspace, view, length };
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
