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
 */
export const GUARDRAIL_METRICS: readonly MetricKey[] = ['deniedBoardings'];
