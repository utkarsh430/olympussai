import type { DepotNetworkResponse } from '../api';
import type { FleetSnapshotView } from '../repositories/types';
import { feedEnvelope, memoiseBySnapshot } from './analysis';
import { networkKpis } from './aggregate';
import { fieldCoverage } from './coverage';

/**
 * The network page's payload: one summary and one score per depot, never the
 * fleet's rows. Built once per snapshot; every poller in that window gets the
 * same object.
 */
export const buildNetworkResponse: (view: FleetSnapshotView) => DepotNetworkResponse =
  memoiseBySnapshot((view, analysis): DepotNetworkResponse => {
    return {
      ...feedEnvelope(view),
      depots: analysis.depots,
      kpis: networkKpis(analysis.depots),
      coverage: fieldCoverage(view.rows),
      scores: analysis.scores,
      exceptionCounts: analysis.report.counts,
      recordCount: view.recordCount,
    };
  });
