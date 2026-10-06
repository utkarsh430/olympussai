import { analyseFuel } from '../fuel/analysis';
import type { FleetSnapshotView, DepotRepositories } from '../repositories/types';
import type { EconomicsDepotRow, EconomicsResponse } from '../revenue/api';
import { scoreEconomics } from '../revenue/economicsIndex';
import type { EconomicsInput } from '../revenue/types';
import type { DepotSummary } from '../types';
import { ECONOMICS_WEIGHTS } from '../sim/revenueConfig';
import { feedEnvelope, type SnapshotAnalysis } from './analysis';
import { depotBusViews } from './depotView';
import { operatingDayFor } from './operatingDayView';
import { analyseDepotRevenue, holdPerSnapshot } from './revenueView';
import type { RouteProfile } from '../routes/types';

type EconomicsBody = Omit<EconomicsResponse, keyof ReturnType<typeof feedEnvelope>>;

export type EconomicsSources = Pick<DepotRepositories, 'revenue' | 'fuel'>;

const NETWORK_KEY = 'network';

interface DepotFigures {
  readonly input: EconomicsInput;
  readonly coverage: EconomicsDepotRow['lengthCoverage'];
}

/** Only an operating depot is scored; the rest are listed with their reason and no figures. */
async function figuresFor(
  analysis: SnapshotAnalysis,
  depot: DepotSummary,
  profiles: ReadonlyMap<string, RouteProfile>,
  operatingDate: string,
  sources: EconomicsSources,
): Promise<DepotFigures> {
  const day =
    depot.kind === 'depot'
      ? operatingDayFor(analysis, depot.id, depotBusViews(analysis, depot.id), profiles, operatingDate)
      : null;
  if (day === null) {
    return {
      input: {
        depot,
        earningsPerKm: null,
        costPerKm: null,
        loadFactor: null,
        lengthCoverage: { n: 0, of: 0 },
      },
      coverage: { n: 0, of: 0 },
    };
  }
  // One day feeds both, so the cost per km here is the figure the depot's fuel page shows.
  const [revenue, fuelDays] = await Promise.all([
    analyseDepotRevenue(sources, day),
    sources.fuel.fuelDay(day),
  ]);
  return {
    input: {
      depot,
      earningsPerKm: revenue.depot.earningsPerKm,
      costPerKm: analyseFuel(fuelDays).depot.costPerKm,
      loadFactor: revenue.depot.loadFactor,
      lengthCoverage: revenue.depot.lengthCoverage,
    },
    coverage: revenue.depot.lengthCoverage,
  };
}

const heldBody = holdPerSnapshot<EconomicsBody, EconomicsSources>(
  async (_view, analysis, profiles, operatingDate, _key, sources): Promise<EconomicsBody> => {
    const figures = await Promise.all(
      analysis.depots.map((depot) => figuresFor(analysis, depot, profiles, operatingDate, sources)),
    );
    const scores = scoreEconomics(figures.map((f) => f.input));
    const depots = analysis.depots.map(
      (depot, i): EconomicsDepotRow => ({
        depotId: depot.id,
        name: depot.name,
        kind: depot.kind,
        fleet: depot.fleet,
        lengthCoverage: figures[i]?.coverage ?? { n: 0, of: 0 },
        score: scores[i] as EconomicsDepotRow['score'],
      }),
    );
    return { provenance: 'modelled', operatingDate, weights: ECONOMICS_WEIGHTS, depots };
  },
);

/**
 * Every unit's Depot Economics Index (MODELLED), scored within peer groups.
 * It is separate from the Depot Efficiency Index: nothing here reads the live
 * scores, and no efficiency value is returned. Every operating depot with a
 * duty that ran has all three figures (ruling S39); how many of its route
 * lengths are real travels beside them. The envelope is built per request.
 */
export async function buildEconomicsResponse(
  view: FleetSnapshotView,
  sources: EconomicsSources,
): Promise<EconomicsResponse> {
  const body = await heldBody(view, NETWORK_KEY, sources);
  return { ...feedEnvelope(view), ...body };
}
