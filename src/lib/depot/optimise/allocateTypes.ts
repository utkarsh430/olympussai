export interface AllocRoute {
  readonly routeName: string;
  readonly currentDepotId: string;
  /** Buses the route needs at whichever depot runs it. */
  readonly busesNeeded: number;
  /** Modelled trips per day; the feed does not carry frequency. */
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
  readonly savedKmPerDay: number;
}

export type UnchangedReason = 'already_best' | 'below_threshold' | 'no_capacity' | 'no_candidate';

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
