import { SeededRandom } from '../../../simulation/seededRandom';
import type { RouteRevenueFigure } from '../../revenue/types';
import { STATIC_SEED_DATE } from '../../sim/config';
import { seedFor } from '../../sim/seed';

/**
 * Revenue leakage against an independent boarding count. The corporation has no
 * passenger counter feed yet; this compares ticketed boardings with a scenario pilot
 * count on a seeded sample of routes, so the method can be seen working. A gap is an
 * estimated anomaly to verify, never a finding that anyone travelled without a ticket,
 * and a route without a counter is never judged.
 */

/** Share of routes carrying a pilot counter in the scenario. */
const COUNTER_SHARE = 0.35;
/** Counters disagree with tickets by this much even when nothing is wrong. */
const COUNTER_NOISE = 0.04;
/** A gap above this is flagged for verification. */
export const LEAKAGE_FLAG = 0.06;

export interface LeakageRow {
  readonly routeName: string;
  readonly ticketed: number;
  readonly counted: number | null;
  /** (counted − ticketed) / counted; null without a counter. */
  readonly gap: number | null;
  readonly flagged: boolean;
  /** Revenue at the route's own average fare on the gap; null when not flagged. */
  readonly revenueAtRisk: number | null;
}

export function leakageFor(routes: readonly RouteRevenueFigure[], operatingDate: string): LeakageRow[] {
  return routes
    .map((r): LeakageRow => {
      const has = new SeededRandom(seedFor(r.routeName, STATIC_SEED_DATE, 'pilot-counter')).bool(COUNTER_SHARE);
      if (!has || r.boardings <= 0) {
        return { routeName: r.routeName, ticketed: r.boardings, counted: null, gap: null, flagged: false, revenueAtRisk: null };
      }
      const day = new SeededRandom(seedFor(r.routeName, operatingDate, 'pilot-count'));
      const noise = day.float(-COUNTER_NOISE, COUNTER_NOISE);
      const leak = day.bool(0.18) ? day.float(0.05, 0.16) : 0;
      const counted = Math.round(r.boardings * (1 + noise + leak));
      const gap = counted > 0 ? (counted - r.boardings) / counted : 0;
      const fare = r.boardings > 0 ? r.revenue / r.boardings : 0;
      const flagged = gap > LEAKAGE_FLAG;
      return {
        routeName: r.routeName,
        ticketed: r.boardings,
        counted,
        gap: Math.round(gap * 1000) / 1000,
        flagged,
        revenueAtRisk: flagged ? Math.round((counted - r.boardings) * fare) : null,
      };
    })
    .sort((a, b) => (b.gap ?? -1) - (a.gap ?? -1) || a.routeName.localeCompare(b.routeName));
}
