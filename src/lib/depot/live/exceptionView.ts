import type { DepotExceptionsResponse } from '../api';
import type { FleetSnapshotView } from '../repositories/types';
import { feedEnvelope, memoiseBySnapshot } from './analysis';

/**
 * The network exception queue. The report was built with the analysis, so its
 * counts and `busTotal` match the network view's `exceptionCounts` exactly.
 */
export const buildExceptionsResponse: (view: FleetSnapshotView) => DepotExceptionsResponse =
  memoiseBySnapshot((view, analysis): DepotExceptionsResponse => ({
    ...feedEnvelope(view),
    report: analysis.report,
  }));
