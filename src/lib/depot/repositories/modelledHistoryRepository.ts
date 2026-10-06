import { modelSeries } from '../sim/history';
import type { HistoryScope, MetricKey, SeriesAnchor, SeriesPoint } from '../sim/types';
import type { HistoryRepository } from './types';

/**
 * History until a real store exists: a modelled series that ends on the live
 * value. Screens label it MODELLED. Async so a database adapter can replace it
 * without changing a caller.
 */
export const modelledHistoryRepository: HistoryRepository = {
  async series(
    metric: MetricKey,
    scope: HistoryScope,
    days: number,
    anchor: SeriesAnchor,
  ): Promise<readonly SeriesPoint[]> {
    return modelSeries(metric, scope, days, anchor);
  },
};
