import type { DepotFeedEnvelope } from '../api';
import type { ECONOMICS_WEIGHTS, REVENUE_MODEL_PARAMS } from '../sim/revenueConfig';
import type { Coverage, DepotKind } from '../types';
import type { DepotEconomicsScore, DepotRevenueTotals, RouteRevenueFigure } from './types';

/*
 * Payloads of the revenue and economics endpoints. Nothing in either is
 * measured: the feed carries no ticketing. Every figure is MODELLED; a route
 * length taken from a real profile is DERIVED (`lengthProvenance`), while the
 * earnings built on it stay MODELLED. Neither response carries a Depot
 * Efficiency Index value: the two indices are never mixed.
 */

/** GET /api/upsrtc/depot/[depotId]/revenue */
export interface RevenueResponse extends DepotFeedEnvelope {
  readonly depot: { readonly id: string; readonly name: string };
  /** The feed's operating date the day was modelled for. */
  readonly operatingDate: string;
  /** Depot totals; the load factor is a ratio of sums. */
  readonly summary: DepotRevenueTotals;
  /** Highest revenue first, then by name. One row per route the depot runs. */
  readonly routes: readonly RouteRevenueFigure[];
  /** The planning assumptions behind every figure, so a page can state them. */
  readonly model: {
    readonly provenance: 'modelled';
    readonly params: typeof REVENUE_MODEL_PARAMS;
  };
}

/** One unit in the economics ranking. */
export interface EconomicsDepotRow {
  readonly depotId: string;
  readonly name: string;
  readonly kind: DepotKind;
  readonly fleet: number;
  /** Routes with a known length out of routes run: what earnings per km rests on. */
  readonly earningsCoverage: Coverage;
  readonly score: DepotEconomicsScore;
}

/** GET /api/upsrtc/depot/economics */
export interface EconomicsResponse extends DepotFeedEnvelope {
  readonly provenance: 'modelled';
  readonly operatingDate: string;
  /** Weights of the three components, so the breakdown can state them. */
  readonly weights: typeof ECONOMICS_WEIGHTS;
  /** Every unit of the feed, in the feed's depot order. */
  readonly depots: readonly EconomicsDepotRow[];
}
