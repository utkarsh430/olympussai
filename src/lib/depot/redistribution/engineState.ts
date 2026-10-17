import { DEFAULT_BAND, isTimeBandKey, timeBand, type TimeBandKey } from './bands';
import type { HeatMode } from './heatScale';

/*
 * The page's shared state and its reducer, pure: every section reads one state and
 * dispatches to it, so a change of depot, window, view or kept transfers reaches every
 * visualisation the same way. A change of selection starts the plan over.
 */

export type PlanStatus = 'idle' | 'generating' | 'ready';
export type ImpactView = 'current' | 'optimized' | 'side_by_side';

export interface CellRef {
  readonly routeId: string;
  readonly hour: number;
}

export interface EngineState {
  readonly depotId: string | null;
  readonly fromHour: number;
  readonly toHour: number;
  readonly heatMode: HeatMode;
  readonly selectedCell: CellRef | null;
  /** The route the recommendations are focused on, from a cell's "Explore" action. */
  readonly focusRouteId: string | null;
  readonly planStatus: PlanStatus;
  readonly excludedIds: ReadonlySet<string>;
  readonly selectedRecId: string | null;
  readonly impactView: ImpactView;
}

export type EngineAction =
  | { readonly type: 'band'; readonly key: Exclude<TimeBandKey, 'custom'> }
  | { readonly type: 'hours'; readonly fromHour: number; readonly toHour: number }
  | { readonly type: 'depot'; readonly depotId: string | null }
  | { readonly type: 'heatMode'; readonly mode: HeatMode }
  | { readonly type: 'selectCell'; readonly cell: CellRef | null }
  | { readonly type: 'focusRoute'; readonly routeId: string | null }
  | { readonly type: 'generate' }
  | { readonly type: 'planReady' }
  | { readonly type: 'toggleRec'; readonly id: string }
  | { readonly type: 'includeAll' }
  | { readonly type: 'excludeAll'; readonly ids: readonly string[] }
  | { readonly type: 'selectRec'; readonly id: string | null }
  | { readonly type: 'impactView'; readonly view: ImpactView };

const NO_IDS: ReadonlySet<string> = new Set();

export function initialEngineState(params: { readonly band: string | null; readonly depotId: string | null }): EngineState {
  const band = timeBand(isTimeBandKey(params.band) ? params.band : DEFAULT_BAND);
  return {
    depotId: params.depotId,
    fromHour: band.fromHour,
    toHour: band.toHour,
    heatMode: 'gap',
    selectedCell: null,
    focusRouteId: null,
    planStatus: 'idle',
    excludedIds: NO_IDS,
    selectedRecId: null,
    impactView: 'current',
  };
}

/** A new selection starts the plan over: nothing kept from the old window applies to the new one. */
function reselected(state: EngineState, change: Partial<Pick<EngineState, 'depotId' | 'fromHour' | 'toHour'>>): EngineState {
  return {
    ...state,
    ...change,
    selectedCell: null,
    focusRouteId: null,
    planStatus: 'idle',
    excludedIds: NO_IDS,
    selectedRecId: null,
    impactView: 'current',
  };
}

function toggled(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function engineReducer(state: EngineState, action: EngineAction): EngineState {
  switch (action.type) {
    case 'band': {
      const band = timeBand(action.key);
      return reselected(state, { fromHour: band.fromHour, toHour: band.toHour });
    }
    case 'hours': {
      const from = Math.min(action.fromHour, action.toHour);
      const to = Math.max(action.fromHour, action.toHour);
      return reselected(state, { fromHour: from, toHour: to });
    }
    case 'depot':
      return reselected(state, { depotId: action.depotId });
    case 'heatMode':
      return { ...state, heatMode: action.mode };
    case 'selectCell':
      return { ...state, selectedCell: action.cell };
    case 'focusRoute':
      return { ...state, focusRouteId: action.routeId, planStatus: state.planStatus === 'idle' && action.routeId !== null ? 'generating' : state.planStatus };
    case 'generate':
      return state.planStatus === 'ready' ? state : { ...state, planStatus: 'generating' };
    case 'planReady':
      return { ...state, planStatus: 'ready' };
    case 'toggleRec':
      return { ...state, excludedIds: toggled(state.excludedIds, action.id) };
    case 'includeAll':
      return { ...state, excludedIds: NO_IDS };
    case 'excludeAll':
      return { ...state, excludedIds: new Set(action.ids) };
    case 'selectRec':
      return { ...state, selectedRecId: action.id };
    case 'impactView':
      return { ...state, impactView: action.view };
  }
}
