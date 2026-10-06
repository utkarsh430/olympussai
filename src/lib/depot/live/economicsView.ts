import { analyseFuel } from '../fuel/analysis';
import type { FleetSnapshotView, DepotRepositories } from '../repositories/types';
import type { EconomicsDepotRow, EconomicsResponse } from '../revenue/api';
import { scoreEconomics } from '../revenue/economicsIndex';
import type { EconomicsInput } from '../revenue/types';
import type { DepotSummary } from '../types';
import { ECONOMICS_WEIGHTS } from '../sim/revenueConfig';
import { feedEnvelope } from './analysis';
import { buildDepotDetail } from './depotView';
import { analyseDepotRevenue, holdPerSnapshot } from './revenueView';
import type { RouteProfile } from '../routes/types';

type EconomicsBody = Omit<EconomicsResponse, keyof ReturnType<typeof feedEnvelope>>;

export type EconomicsSources = Pick<DepotRepositories, 'revenue' | 'fuel'>;

const NETWORK_KEY = 'network';

interface DepotFigures {
  readonly input: EconomicsInput;
  readonly coverage: EconomicsDepotRow['earningsCoverage'];
}

/** Only an operating depot is scored; the rest are listed with their reason and no figures. */
async function figuresFor(
  view: FleetSnapshotView,
  depot: DepotSummary,
  profiles: ReadonlyMap<string, RouteProfile>,
  operatingDate: string,
  sources: EconomicsSources,
): Promise<DepotFigures> {
  if (depot.kind !== 'depot') {
    return {
      input: {
        depot,
        earningsPerKm: null,
        costPerKm: null,
        loadFactor: null,
        earningsCoverage: { n: 0, of: 0 },
      },
      coverage: { n: 0, of: 0 },
    };
  }
  const buses = buildDepotDetail(view, depot.id)?.buses ?? [];
  const [revenue, fuelDays] = await Promise.all([
    analyseDepotRevenue(sources, buses, profiles, operatingDate),
    sources.fuel.fuelDay(buses, operatingDate),
  ]);
  return {
    input: {
      depot,
      earningsPerKm: revenue.depot.earningsPerKm,
      costPerKm: analyseFuel(fuelDays).depot.costPerKm,
      loadFactor: revenue.depot.loadFactor,
      earningsCoverage: revenue.depot.earningsCoverage,
    },
    coverage: revenue.depot.earningsCoverage,
  };
}

const heldBody = holdPerSnapshot<EconomicsBody, EconomicsSources>(
  async (view, analysis, profiles, operatingDate, _key, sources): Promise<EconomicsBody> => {
    const figures = await Promise.all(
      analysis.depots.map((depot) => figuresFor(view, depot, profiles, operatingDate, sources)),
    );
    const scores = scoreEconomics(figures.map((f) => f.input));
    const depots = analysis.depots.map(
      (depot, i): EconomicsDepotRow => ({
        depotId: depot.id,
        name: depot.name,
        kind: depot.kind,
        fleet: depot.fleet,
        earningsCoverage: figures[i]?.coverage ?? { n: 0, of: 0 },
        score: scores[i] as EconomicsDepotRow['score'],
      }),
    );
    return { provenance: 'modelled', operatingDate, weights: ECONOMICS_WEIGHTS, depots };
  },
);

/**
 * Every unit's Depot Economics Index (MODELLED), scored within peer groups.
 * It is separate from the Depot Efficiency Index: nothing here reads the live
 * scores, and no efficiency value is returned. A depot with no route of known
 * length cannot be ranked and says so. The envelope is built per request.
 */
export async function buildEconomicsResponse(
  view: FleetSnapshotView,
  sources: EconomicsSources,
): Promise<EconomicsResponse> {
  const body = await heldBody(view, NETWORK_KEY, sources);
  return { ...feedEnvelope(view), ...body };
}
