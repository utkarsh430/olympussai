import type { DepotDistributionResponse } from '../api';
import type { FleetSnapshotView } from '../repositories/types';
import { DEFAULT_REBALANCE_PARAMS } from '../optimise/config';
import { planTransfers } from '../optimise/rebalance';
import { DEFAULT_REQUIREMENT_PARAMS } from '../sim/config';
import { modelBalances } from '../sim/requirement';
import { operatingDateOf } from '../sim/seed';
import { feedEnvelope, memoiseBySnapshot } from './analysis';

/**
 * The distribution page's payload: every depot's modelled balance and the
 * transfers recommended between them. The balances are sent whole (one row per
 * depot, no bus-level data) because the browser re-plans on them for what-if
 * scenarios. The live anchors (fleet, off-road) pass through untouched; only
 * the requirement is modelled. Built once per snapshot.
 */
export const buildDistributionResponse: (view: FleetSnapshotView) => DepotDistributionResponse =
  memoiseBySnapshot((view, analysis): DepotDistributionResponse => {
    const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
    const balances = modelBalances(
      analysis.depots,
      analysis.yards,
      operatingDate,
      DEFAULT_REQUIREMENT_PARAMS,
    );
    return {
      ...feedEnvelope(view),
      balances,
      plan: planTransfers(balances, DEFAULT_REBALANCE_PARAMS),
      requirementParams: DEFAULT_REQUIREMENT_PARAMS,
      rebalanceParams: DEFAULT_REBALANCE_PARAMS,
      operatingDate,
    };
  });
