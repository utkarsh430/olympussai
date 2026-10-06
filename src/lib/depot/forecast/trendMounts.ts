/**
 * The metric whose week-on-week trend the depot cockpit's status board states
 * beside its live figure.
 */
import type { MetricKey } from '../sim/types';

/** The cockpit's status board shows the on-road share's week. */
export const COCKPIT_TREND_METRIC: MetricKey = 'onRoadShare';
