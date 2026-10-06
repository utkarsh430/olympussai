export interface AllocRoute {
  readonly routeName: string;
  readonly currentDepotId: string;
  /** Buses the route needs at whichever depot runs it. */
  readonly busesNeeded: number;
  /**
   * Modelled trips per day, a whole number: the feed does not carry frequency.
   * A fractional or negative value makes the route uncostable (`no_candidate`)
   * rather than being rounded, so a figure just under the saving threshold can
   * never be promoted across it.
   */
  readonly tripsPerDay: number;
  /** Per-trip dead kilometres for each candidate depot, one decimal. */
  readonly deadKmByDepot: Readonly<Record<string, number>>;
}

export interface AllocDepot {
  readonly depotId: string;
  /** Buses the depot can field. */
  readonly capacity: number;
}

export interface RouteMove {
  readonly routeName: string;
  readonly fromDepotId: string;
  readonly toDepotId: string;
  readonly busesNeeded: number;
  /** Net, origin to final depot. Can be small or negative for a route that made room. */
  readonly savedKmPerDay: number;
  /**
   * True when this route's own net saving is below the minimum: it moved so
   * that another route could (a swap is accepted on its total saving). A
   * screen can label it "moved to make room".
   */
  readonly madeRoom: boolean;
}

/**
 * Why a route stayed. Precedence when several apply:
 * no_candidate > already_best > below_threshold > over_capacity > move_limit > no_capacity.
 */
export type UnchangedReason =
  /** No figure for its own depot, or for any other listed depot. */
  | 'no_candidate'
  /** Its current depot is its cheapest candidate. */
  | 'already_best'
  /** A cheaper depot exists but the saving is under the minimum. */
  | 'below_threshold'
  /** Frozen: its own depot starts over capacity, and the plan does not repair that. */
  | 'over_capacity'
  /** A worthwhile move that fits still exists, but the move cap was reached. */
  | 'move_limit'
  /** A worthwhile depot exists and none has room. */
  | 'no_capacity';

export interface UnchangedRoute {
  readonly routeName: string;
  readonly reason: UnchangedReason;
}

export interface AllocationPlan {
  /** Net move per route, sorted by route name. */
  readonly moves: readonly RouteMove[];
  /** Costed routes only; routes with no figure at their own depot are excluded. */
  readonly beforeKmPerDay: number;
  readonly afterKmPerDay: number;
  readonly savedKmPerDay: number;
  /** Every route not moved, with exactly one reason, sorted by route name. */
  readonly unchanged: readonly UnchangedRoute[];
}
