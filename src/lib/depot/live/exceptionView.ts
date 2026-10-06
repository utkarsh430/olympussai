import type { DepotExceptionsResponse } from '../api';
import type { FleetSnapshotView } from '../repositories/types';
import { analyseSnapshot, feedEnvelope } from './analysis';

/**
 * The network exception queue. The report was built with the analysis, so its
 * counts and `busTotal` match the network view's `exceptionCounts` exactly. The
 * envelope is this request's own, so stale data is always reported as stale.
 */
export function buildExceptionsResponse(view: FleetSnapshotView): DepotExceptionsResponse {
  return { ...feedEnvelope(view), report: analyseSnapshot(view).report };
}
