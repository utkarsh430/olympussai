import { clamp, median, robustZ } from '../stats/robust';
import type { DepotSummary } from '../types';
import { competitionRanks } from './competitionRanks';
import { DEI_COMPONENTS, Z_CLAMP } from './config';
import { assignPeerGroups } from './peerGroups';
import type { DeiComponent, DepotScore, PeerGroupId } from './types';
import { countsOf, valuesOfCounts, type ComponentValues } from './window';

/** Rates in 0..1 from this depot's own counts on one snapshot. */
export function componentValues(depot: DepotSummary): ComponentValues {
  return valuesOfCounts(countsOf(depot));
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function rawComponents(values: ComponentValues): DeiComponent[] {
  return DEI_COMPONENTS.map((c) => ({
    key: c.key,
    value: values[c.key],
    peerMedian: null,
    z: null,
    contribution: 0,
  }));
}

function unranked(depot: DepotSummary, values: ComponentValues): DepotScore {
  return {
    depotId: depot.id,
    peerGroup: null,
    ranked: false,
    reason: depot.kind === 'depot' ? 'fleet_too_small' : 'not_a_depot',
    index: null,
    rank: null,
    peerCount: null,
    components: rawComponents(values),
  };
}

function scoreAgainstPeers(
  values: ComponentValues,
  peerValues: readonly ComponentValues[],
): { components: DeiComponent[]; index: number } {
  const components = DEI_COMPONENTS.map((config): DeiComponent => {
    const value = values[config.key];
    const sample = peerValues.flatMap((p) => (p[config.key] === null ? [] : [p[config.key] as number]));
    const peerMedian = median(sample);
    if (value === null) {
      return { key: config.key, value, peerMedian, z: null, contribution: 0 };
    }
    const raw = robustZ(value, sample);
    const clamped = raw === null ? 0 : clamp(raw, -Z_CLAMP, Z_CLAMP);
    // Written this way so a zero z never becomes negative zero.
    const z = config.higherIsBetter || clamped === 0 ? clamped : -clamped;
    return { key: config.key, value, peerMedian, z, contribution: config.weight * z };
  });
  const weighted = components.reduce((sum, c) => sum + c.contribution, 0);
  return { components, index: roundOneDecimal(clamp(50 + (weighted / Z_CLAMP) * 50, 0, 100)) };
}

/**
 * Scores every depot against peers of similar fleet size. Output follows the
 * input order; the result for a depot never depends on that order. `windowed`
 * supplies component values summed over a window for the depots it names; any
 * other depot is scored on its own counts. Peer groups always follow the
 * depots' present fleet sizes.
 */
export function scoreDepots(
  depots: readonly DepotSummary[],
  windowed: ReadonlyMap<string, ComponentValues> = new Map(),
): DepotScore[] {
  const groups = assignPeerGroups(depots);
  const valuesById = new Map(
    depots.map((d) => [d.id, windowed.get(d.id) ?? componentValues(d)] as const),
  );

  const members = new Map<PeerGroupId, string[]>();
  for (const [id, group] of groups) members.set(group, [...(members.get(group) ?? []), id]);

  const scored = new Map<string, { components: DeiComponent[]; index: number }>();
  for (const ids of members.values()) {
    const peerValues = ids.map((id) => valuesById.get(id) as ComponentValues);
    for (const id of ids) {
      scored.set(id, scoreAgainstPeers(valuesById.get(id) as ComponentValues, peerValues));
    }
  }

  // Equal indexes share a rank and the next rank skips (1, 2, 2, 4).
  const rankOf = new Map(
    [...members.values()].flatMap((ids) => [
      ...competitionRanks(
        ids.map((id) => ({ id, index: (scored.get(id) as { index: number }).index })),
      ),
    ]),
  );

  return depots.map((depot): DepotScore => {
    const group = groups.get(depot.id);
    const result = scored.get(depot.id);
    if (group === undefined || result === undefined) {
      return unranked(depot, valuesById.get(depot.id) as ComponentValues);
    }
    return {
      depotId: depot.id,
      peerGroup: group,
      ranked: true,
      reason: 'ok',
      index: result.index,
      rank: rankOf.get(depot.id) ?? null,
      peerCount: (members.get(group) ?? []).length,
      components: result.components,
    };
  });
}

