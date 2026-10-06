import type { DepotDistributionResponse, DepotFeedEnvelope } from '../api';
import type { FleetSnapshotView } from '../repositories/types';
import { DEFAULT_REBALANCE_PARAMS } from '../optimise/config';
import { planTransfers } from '../optimise/rebalance';
import { DEFAULT_REQUIREMENT_PARAMS } from '../sim/config';
import { modelBalances } from '../sim/requirement';
import { operatingDateOf } from '../sim/seed';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';

type DistributionBody = Omit<DepotDistributionResponse, keyof DepotFeedEnvelope | 'operatingDate'>;

function buildBody(analysis: SnapshotAnalysis, operatingDate: string): DistributionBody {
  // Each depot's busiest windowed on-road share so far today, as the operating day reads them.
  const balances = modelBalances(
    analysis.depots,
    analysis.yards,
    operatingDate,
    DEFAULT_REQUIREMENT_PARAMS,
    analysis.requirementShares,
  );
  return {
    balances,
    plan: planTransfers(balances, DEFAULT_REBALANCE_PARAMS),
    requirementParams: DEFAULT_REQUIREMENT_PARAMS,
    rebalanceParams: DEFAULT_REBALANCE_PARAMS,
  };
}

/*
 * The body depends on the rows (through the analysis), on the held on-road
 * shares (the analysis carries them as they stood when its snapshot was
 * offered to the holder, so they need no key of their own) and on the operating
 * date the modelled requirement is seeded with, so it is held per analysis with
 * the date it was built for. A new date rebuilds it; the analysis, and with it
 * the body, goes when its snapshot is no longer held.
 */
const bodies = new WeakMap<
  SnapshotAnalysis,
  { readonly operatingDate: string; readonly body: DistributionBody }
>();

function distributionBody(analysis: SnapshotAnalysis, operatingDate: string): DistributionBody {
  const cached = bodies.get(analysis);
  if (cached?.operatingDate === operatingDate) return cached.body;
  const body = buildBody(analysis, operatingDate);
  bodies.set(analysis, { operatingDate, body });
  return body;
}

/**
 * The distribution page's payload: every depot's modelled balance and the
 * transfers recommended between them. The balances are sent whole (one row per
 * depot, no bus-level data) because the browser re-plans on them for what-if
 * scenarios. The live anchors (fleet, off-road) pass through untouched; only
 * the requirement is modelled. The envelope and operating date come from this
 * request's view, so a stale last-good snapshot is always reported as stale.
 */
export function buildDistributionResponse(view: FleetSnapshotView): DepotDistributionResponse {
  const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
  const body = distributionBody(analyseSnapshot(view), operatingDate);
  return { ...feedEnvelope(view), ...body, operatingDate };
}
