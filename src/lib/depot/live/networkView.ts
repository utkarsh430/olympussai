import type { DepotFeedEnvelope, DepotNetworkResponse } from '../api';
import type { FleetSnapshotView } from '../repositories/types';
import { feedEnvelope, memoiseBody } from './analysis';
import { networkKpis } from './aggregate';
import { fieldCoverage } from './coverage';

type NetworkBody = Omit<DepotNetworkResponse, keyof DepotFeedEnvelope | 'recordCount'>;

/** Everything derived from the rows: built once per snapshot and shared by every poller. */
const networkBody = memoiseBody((view, analysis): NetworkBody => ({
  depots: analysis.depots,
  kpis: networkKpis(analysis.depots),
  coverage: fieldCoverage(view.rows),
  scores: analysis.scores,
  exceptionCounts: analysis.report.counts,
}));

/**
 * The network page's payload: one summary and one score per depot, never the
 * fleet's rows. The envelope and record count come from this request's view,
 * so a stale last-good snapshot is always reported as stale.
 */
export function buildNetworkResponse(view: FleetSnapshotView): DepotNetworkResponse {
  return { ...feedEnvelope(view), ...networkBody(view), recordCount: view.recordCount };
}
