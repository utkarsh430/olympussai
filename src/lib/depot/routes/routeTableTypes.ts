import type { Coverage, StateMix } from '@/lib/depot/types';

export interface RouteOperator {
  readonly depotId: string;
  readonly depotName: string;
  readonly buses: number;
}

export interface RouteDelay {
  /** Median delay in minutes, one decimal; null when no bus has a usable delay. */
  readonly medianMin: number | null;
  /** Share of covered buses later than `LATE_AFTER_MIN`, four decimals; null likewise. */
  readonly lateShare: number | null;
  /** Buses used out of buses on the route. */
  readonly coverage: Coverage;
}

export interface RouteRow {
  readonly routeName: string;
  readonly routeId: string | null;
  readonly description: string | null;
  /** Service class parsed from the name, upper-cased, e.g. ORD. */
  readonly serviceToken: string | null;
  readonly direction: 'IN' | 'OUT' | null;
  /** Buses carrying this route name now. */
  readonly buses: number;
  /** Home depots of those buses, by buses descending then depot id. */
  readonly operators: readonly RouteOperator[];
  /** The operator with strictly the most buses; null on an exact tie for first. */
  readonly primaryDepotId: string | null;
  readonly states: StateMix;
  readonly delay: RouteDelay;
}
