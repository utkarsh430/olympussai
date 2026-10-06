import { compareText } from '../fuel/compare';
import { Z_CLAMP } from '../score/config';
import { assignPeerGroups } from '../score/peerGroups';
import { ECONOMICS_WEIGHTS } from '../sim/revenueConfig';
import { clamp, median, robustZ } from '../stats/robust';
import type {
  DepotEconomicsScore,
  EconomicsComponent,
  EconomicsComponentKey,
  EconomicsInput,
  EconomicsRankReason,
} from './types';

/*
 * The Depot Economics Index (MODELLED). It is scored with the efficiency
 * index's peer groups and robust statistics, but it is a separate module with
 * a separate result type: a modelled economic figure never enters the Depot
 * Efficiency Index, and nothing under score/ imports this file.
 */

interface ComponentConfig {
  readonly key: EconomicsComponentKey;
  readonly weight: number;
  readonly higherIsBetter: boolean;
}

const COMPONENTS: readonly ComponentConfig[] = [
  { key: 'earningsPerKm', weight: ECONOMICS_WEIGHTS.earningsPerKm, higherIsBetter: true },
  { key: 'costPerKm', weight: ECONOMICS_WEIGHTS.costPerKm, higherIsBetter: false },
  { key: 'loadFactor', weight: ECONOMICS_WEIGHTS.loadFactor, higherIsBetter: true },
];

const INDEX_CENTRE = 50;
const INDEX_HALF_RANGE = 50;
const TENTH = 10;

type Values = Readonly<Record<EconomicsComponentKey, number | null>>;

/** A figure that is not a finite number is missing, never a value. */
function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

function valuesOf(input: Readonly<EconomicsInput>): Values {
  return {
    earningsPerKm: finiteOrNull(input.earningsPerKm),
    costPerKm: finiteOrNull(input.costPerKm),
    loadFactor: finiteOrNull(input.loadFactor),
  };
}

function missingOf(values: Values): EconomicsComponentKey[] {
  return COMPONENTS.filter((c) => values[c.key] === null).map((c) => c.key);
}

function medianOf(key: EconomicsComponentKey, sample: readonly Values[]): number | null {
  return median(sample.flatMap((v) => (v[key] === null ? [] : [v[key] as number])));
}

function scoreComponents(values: Values, sample: readonly Values[]): EconomicsComponent[] {
  return COMPONENTS.map((config): EconomicsComponent => {
    const value = values[config.key];
    const peerMedian = medianOf(config.key, sample);
    const base = { key: config.key, value, peerMedian, provenance: 'modelled' } as const;
    if (value === null) return { ...base, z: null, contribution: 0 };
    const peers = sample.flatMap((v) => (v[config.key] === null ? [] : [v[config.key] as number]));
    const raw = robustZ(value, peers);
    const clamped = raw === null ? 0 : clamp(raw, -Z_CLAMP, Z_CLAMP);
    // Written this way so a zero z never becomes negative zero.
    const z = config.higherIsBetter || clamped === 0 ? clamped : -clamped;
    return { ...base, z, contribution: config.weight * z };
  });
}

function indexFrom(components: readonly EconomicsComponent[]): number {
  const weighted = components.reduce((sum, c) => sum + c.contribution, 0);
  const scaled = INDEX_CENTRE + (weighted / Z_CLAMP) * INDEX_HALF_RANGE;
  return Math.round(clamp(scaled, 0, 100) * TENTH) / TENTH;
}

function unrankedReason(input: Readonly<EconomicsInput>, grouped: boolean): EconomicsRankReason {
  if (input.depot.kind !== 'depot') return 'not_a_depot';
  return grouped ? 'missing_component' : 'fleet_too_small';
}

/**
 * Scores depots (kind depot only) against peers of similar fleet size, the
 * same groups the efficiency index uses. A depot missing any component is not
 * ranked and says which; the others are scored against peers that have all
 * three. Output follows the input order; a depot's result never depends on it.
 */
export function scoreEconomics(inputs: readonly EconomicsInput[]): DepotEconomicsScore[] {
  const groups = assignPeerGroups(inputs.map((i) => i.depot));
  const values = new Map(inputs.map((i) => [i.depot.id, valuesOf(i)] as const));
  const complete = new Map<string, Values[]>();
  const memberIds = new Map<string, string[]>();
  for (const [id, group] of groups) {
    const v = values.get(id) as Values;
    if (missingOf(v).length > 0) continue;
    complete.set(group, [...(complete.get(group) ?? []), v]);
    memberIds.set(group, [...(memberIds.get(group) ?? []), id]);
  }

  const scored = new Map<string, { components: EconomicsComponent[]; index: number }>();
  for (const [group, ids] of memberIds) {
    for (const id of ids) {
      const components = scoreComponents(values.get(id) as Values, complete.get(group) ?? []);
      scored.set(id, { components, index: indexFrom(components) });
    }
  }
  const rankOf = new Map<string, number>();
  for (const ids of memberIds.values()) {
    [...ids]
      .sort(
        (a, b) =>
          (scored.get(b)?.index ?? 0) - (scored.get(a)?.index ?? 0) || compareText(a, b),
      )
      .forEach((id, i) => rankOf.set(id, i + 1));
  }

  return inputs.map((input): DepotEconomicsScore => {
    const id = input.depot.id;
    const own = values.get(id) as Values;
    const group = groups.get(id) ?? null;
    const result = scored.get(id);
    if (result === undefined) {
      const sample = group === null ? [] : (complete.get(group) ?? []);
      return {
        depotId: id,
        peerGroup: group,
        ranked: false,
        reason: unrankedReason(input, group !== null),
        missing: missingOf(own),
        economicsIndex: null,
        rank: null,
        peerCount: null,
        components: COMPONENTS.map((c) => ({
          key: c.key,
          value: own[c.key],
          peerMedian: medianOf(c.key, sample),
          z: null,
          contribution: 0,
          provenance: 'modelled',
        })),
        provenance: 'modelled',
      };
    }
    return {
      depotId: id,
      peerGroup: group,
      ranked: true,
      reason: 'ok',
      missing: [],
      economicsIndex: result.index,
      rank: rankOf.get(id) ?? null,
      peerCount: (complete.get(group as string) ?? []).length,
      components: result.components,
      provenance: 'modelled',
    };
  });
}
