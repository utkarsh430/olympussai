import { analyseFuel } from '../fuel/analysis';
import type { FleetSnapshotView, DepotRepositories } from '../repositories/types';
import type { EconomicsDepotRow, EconomicsResponse } from '../revenue/api';
import { scoreEconomics } from '../revenue/economicsIndex';
import type { EconomicsInput } from '../revenue/types';
import type { DepotSummary } from '../types';
import { ECONOMICS_WEIGHTS } from '../sim/revenueConfig';
import { feedEnvelope } from './analysis';
import { operatingDayFor } from './operatingDayView';
import { analyseDepotRevenue, holdPerSnapshot } from './revenueView';

type EconomicsBody = Omit<EconomicsResponse, keyof ReturnType<typeof feedEnvelope>>;

export type EconomicsSources = Pick<DepotRepositories, 'revenue' | 'fuel'>;

const NETWORK_KEY = 'network';

interface DepotFigures {
  readonly input: EconomicsInput;
  readonly coverage: EconomicsDepotRow['lengthCoverage'];
}

/** Only an operating depot is scored; the rest are listed with their reason and no figures. */
async function figuresFor(
  view: FleetSnapshotView,
  depot: DepotSummary,
  sources: EconomicsSources,
): Promise<DepotFigures> {
  // The depot's one shared day: the day its own fuel and revenue pages read.
  const day = depot.kind === 'depot' ? operatingDayFor(view, depot.id) : null;
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

/**
 * How many depots' days are worked out between two turns of the event loop.
 * The modelled sources resolve without I/O, so the whole network's days (about
 * a quarter of a second at 143 depots) would otherwise run as one block and
 * hold up every other request on the process.
 */
export const ECONOMICS_DEPOTS_PER_BATCH = 10;

const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Every depot's figures, in depot order, yielding to the event loop between batches. */
async function figuresInBatches(
  view: FleetSnapshotView,
  depots: readonly DepotSummary[],
  sources: EconomicsSources,
): Promise<readonly DepotFigures[]> {
  const batchCount = Math.ceil(depots.length / ECONOMICS_DEPOTS_PER_BATCH);
  const batches = Array.from({ length: batchCount }, (_, i) =>
    depots.slice(i * ECONOMICS_DEPOTS_PER_BATCH, (i + 1) * ECONOMICS_DEPOTS_PER_BATCH),
  );
  let figures: readonly DepotFigures[] = [];
  for (const batch of batches) {
    if (figures.length > 0) await nextTurn();
    const done = await Promise.all(batch.map((depot) => figuresFor(view, depot, sources)));
    figures = [...figures, ...done];
  }
  return figures;
}

const heldBody = holdPerSnapshot<EconomicsBody, EconomicsSources>(
  async (view, analysis, operatingDate, _key, sources): Promise<EconomicsBody> => {
    const figures = await figuresInBatches(view, analysis.depots, sources);
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
 * duty that ran has all three figures; how many of its route
 * lengths are real travels beside them. The envelope is built per request.
 */
export async function buildEconomicsResponse(
  view: FleetSnapshotView,
  sources: EconomicsSources,
): Promise<EconomicsResponse> {
  const body = await heldBody(view, NETWORK_KEY, sources);
  return { ...feedEnvelope(view), ...body };
}
