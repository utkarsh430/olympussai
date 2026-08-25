// The metrics an evaluation reports, and which of them is the headline.
//
// The ORDER is the message. `algo_new.md` section 8.2 makes Excess Wait Time
// the headline and headway CV explicitly a diagnostic, and the distinction is
// not pedantry: CV is scale-free, so a controller that lengthens every
// headway uniformly improves CV while every passenger waits longer. A table
// that leads with CV can report a success that costs the network time.
//
// `bunchingRate` rather than `bunchingIncidents`, because a raw count rises
// with the number of samples and a sweep varies exactly that.
import type { KpiSummary } from '../simulation/types.js';

export type MetricKey =
  | 'ewtSeconds'
  | 'totalPassengerSeconds'
  | 'bunchingRate'
  | 'headwayCv'
  | 'meanHeadwaySeconds'
  | 'deniedBoardings'
  | 'totalBoardings'
  | 'onTimeDispatchRate';

export interface MetricDefinition {
  key: MetricKey;
  label: string;
  read: (kpis: KpiSummary) => number | null;
  /** Whether a decrease is an improvement. */
  lowerIsBetter: boolean;
  /** Reported, but never the basis of a verdict on its own. */
  diagnostic?: boolean;
}

export const KPI_METRICS: readonly MetricDefinition[] = [
  {
    key: 'totalPassengerSeconds',
    label: 'Total passenger time (s)',
    read: (k) => k.totalPassengerSeconds,
    lowerIsBetter: true,
  },
  {
    key: 'ewtSeconds',
    label: 'Excess wait (s/passenger)',
    read: (k) => k.ewtSeconds,
    lowerIsBetter: true,
  },
  {
    key: 'bunchingRate',
    label: 'Bunching rate',
    read: (k) => k.bunchingRate,
    lowerIsBetter: true,
  },
  {
    key: 'headwayCv',
    label: 'Headway CV',
    read: (k) => k.headwayCv,
    lowerIsBetter: true,
    diagnostic: true,
  },
  {
    key: 'meanHeadwaySeconds',
    label: 'Mean headway (s)',
    read: (k) => k.meanHeadwaySeconds,
    lowerIsBetter: true,
    diagnostic: true,
  },
  {
    key: 'deniedBoardings',
    label: 'Denied boardings',
    read: (k) => k.deniedBoardings,
    lowerIsBetter: true,
  },
  {
    key: 'totalBoardings',
    label: 'Total boardings',
    read: (k) => k.totalBoardings,
    lowerIsBetter: false,
    diagnostic: true,
  },
  {
    key: 'onTimeDispatchRate',
    label: 'On-time rate',
    read: (k) => k.onTimeDispatchRate,
    lowerIsBetter: false,
  },
];

/** The one metric a sweep optimises. Everything else is a guardrail or a diagnostic. */
export const HEADLINE_METRIC: MetricKey = 'ewtSeconds';

/**
 * Metrics a tuned parameter set must not make worse to be recommended.
 *
 * Denied boardings is here because every hold law can improve spacing by
 * making buses wait, and a bus made to wait while full leaves people behind.
 * That trade is not visible in EWT at all - the passengers it costs are the
 * ones who never boarded to have a wait measured.
 *
 * ─── AND TOTAL PASSENGER TIME, FOR THE SAME REASON ONE STEP UP ───────────
 *
 * This sweep optimises EWT, which counts only the people standing at stops.
 * Holding a bus to fix their spacing is paid for by everyone already aboard,
 * and the two move in opposite directions often enough that the fleet trial's
 * founding finding was a configuration improving EWT 46% while making total
 * passenger time 12% WORSE. With no passenger-time guardrail this sweep would
 * recommend exactly that, and it is not hypothetical: MEASURED on the urban
 * corridor, loosening the mid-route action bar from 50% to 75% of H* takes
 * excess wait from 50% to 55% better while net passenger time falls from
 * +4.1% to +2.1%. The headline stays EWT - it is the control-quality metric
 * the field and `algo_new.md` are written in - but nothing may be recommended
 * that buys it by spending more of what passengers actually have.
 */
export const GUARDRAIL_METRICS: readonly MetricKey[] = [
  'deniedBoardings',
  'totalPassengerSeconds',
];
