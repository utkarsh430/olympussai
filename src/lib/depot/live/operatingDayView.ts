import type { DepotBusView } from '../api';
import type { RouteProfile } from '../routes/types';
import { DEFAULT_REQUIREMENT_PARAMS } from '../sim/config';
import { modelOperatingDay } from '../sim/operatingDay';
import type { OperatingDay } from '../sim/operatingDayTypes';
import { modelBalances } from '../sim/requirement';
import type { SnapshotAnalysis } from './analysis';

/*
 * The peak requirement of every depot for one analysis and operating date. The
 * requirement model works on the whole network at once, so it is held here and
 * a ranking over every depot does not run it once per depot.
 */
const requirements = new WeakMap<SnapshotAnalysis, Map<string, ReadonlyMap<string, number>>>();

function peakRequirements(
  analysis: SnapshotAnalysis,
  operatingDate: string,
): ReadonlyMap<string, number> {
  const byDate = requirements.get(analysis) ?? new Map<string, ReadonlyMap<string, number>>();
  requirements.set(analysis, byDate);
  const held = byDate.get(operatingDate);
  if (held) return held;
  const built = new Map(
    modelBalances(analysis.depots, analysis.yards, operatingDate, DEFAULT_REQUIREMENT_PARAMS).map(
      (balance) => [balance.depotId, balance.peakRequirement] as const,
    ),
  );
  byDate.set(operatingDate, built);
  return built;
}

/**
 * The depot's one modelled operating day (ruling S41), or null for an unknown
 * depot. The duties are built from the same inputs as the duty board's plan
 * (`planDutiesFor`: the modelled peak requirement and the routes the depot's
 * buses report), which a test holds equal; the route lengths are the cached
 * real profiles where there are any. No upstream call is made.
 */
export function operatingDayFor(
  analysis: SnapshotAnalysis,
  depotId: string,
  buses: readonly DepotBusView[],
  profiles: ReadonlyMap<string, RouteProfile>,
  operatingDate: string,
): OperatingDay | null {
  const depot = analysis.depotsById.get(depotId);
  if (!depot) return null;
  return modelOperatingDay({
    depot,
    buses,
    peakRequirement: peakRequirements(analysis, operatingDate).get(depotId) ?? 0,
    realLengthKm: new Map([...profiles].map(([name, profile]) => [name, profile.lengthKm] as const)),
    operatingDate,
  });
}
