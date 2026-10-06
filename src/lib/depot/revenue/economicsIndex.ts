import { compareText } from '../fuel/compare';
import { MIN_PEER_GROUP, Z_CLAMP } from '../score/config';
import { assignPeerGroups } from '../score/peerGroups';
import {
  ECONOMICS_MIN_ROUTE_COVERAGE,
  ECONOMICS_MIN_ROUTES,
  ECONOMICS_WEIGHTS,
} from '../sim/revenueConfig';
import type { Coverage } from '../types';
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

/** A coverage that is not a pair of finite counts is no coverage: 0 of 0. */
function safeCoverage(coverage: Coverage): Coverage {
  return Number.isFinite(coverage.n) && Number.isFinite(coverage.of)
    ? { n: coverage.n, of: coverage.of }
    : { n: 0, of: 0 };
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

function scoreComponents(
  values: Values,
  sample: readonly Values[],
  earningsCoverage: Coverage,
): EconomicsComponent[] {
  return COMPONENTS.map((config): EconomicsComponent => {
    const value = values[config.key];
    const peerMedian = medianOf(config.key, sample);
    const coverage = config.key === 'earningsPerKm' ? earningsCoverage : null;
    const base = { key: config.key, value, peerMedian, coverage, provenance: 'modelled' } as const;
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

type Standing = 'eligible' | 'missing_component' | 'thin_route_coverage';

/** Earnings per km on too few of a depot's routes is a guess about the depot, not a figure. */
function isThinCoverage(coverage: Coverage): boolean {
  const { n, of } = safeCoverage(coverage);
  return n < ECONOMICS_MIN_ROUTES || n < of * ECONOMICS_MIN_ROUTE_COVERAGE;
}

function standingOf(input: Readonly<EconomicsInput>, values: Values): Standing {
  if (missingOf(values).length > 0) return 'missing_component';
  return isThinCoverage(input.earningsCoverage) ? 'thin_route_coverage' : 'eligible';
}

function unrankedReason(
  input: Readonly<EconomicsInput>,
  grouped: boolean,
  standing: Standing,
): EconomicsRankReason {
  if (input.depot.kind !== 'depot') return 'not_a_depot';
  if (!grouped) return 'fleet_too_small';
  return standing === 'eligible' ? 'peer_group_too_small' : standing;
}

/**
 * Scores depots (kind depot only) against peers of similar fleet size, the
 * same groups the efficiency index uses. A depot missing a component, or whose
 * earnings per km cover too few of its routes, is set aside and says why. The
 * rest are ranked only if at least MIN_PEER_GROUP of their group remain, else
 * they are unranked as peer_group_too_small: a rank among two or three depots
 * is not a rank. Output follows the input order; a result never depends on it.
 */
export function scoreEconomics(inputs: readonly EconomicsInput[]): DepotEconomicsScore[] {
  const groups = assignPeerGroups(inputs.map((i) => i.depot));
  const values = new Map(inputs.map((i) => [i.depot.id, valuesOf(i)] as const));
  const standings = new Map(
    inputs.map((i) => [i.depot.id, standingOf(i, values.get(i.depot.id) as Values)] as const),
  );
  const eligible = new Map<string, string[]>();
  for (const [id, group] of groups) {
    if (standings.get(id) === 'eligible') eligible.set(group, [...(eligible.get(group) ?? []), id]);
  }
  const sampleOf = (group: string | null): Values[] =>
    group === null ? [] : (eligible.get(group) ?? []).map((id) => values.get(id) as Values);
  const coverageOf = new Map(inputs.map((i) => [i.depot.id, safeCoverage(i.earningsCoverage)] as const));

  const scored = new Map<string, { components: EconomicsComponent[]; index: number }>();
  const rankOf = new Map<string, number>();
  for (const [group, ids] of eligible) {
    if (ids.length < MIN_PEER_GROUP) continue;
    for (const id of ids) {
      const components = scoreComponents(
        values.get(id) as Values,
        sampleOf(group),
        coverageOf.get(id) as Coverage,
      );
      scored.set(id, { components, index: indexFrom(components) });
    }
    [...ids]
      .sort((a, b) => (scored.get(b)?.index ?? 0) - (scored.get(a)?.index ?? 0) || compareText(a, b))
      .forEach((id, i) => rankOf.set(id, i + 1));
  }

  return inputs.map((input): DepotEconomicsScore => {
    const id = input.depot.id;
    const own = values.get(id) as Values;
    const group = groups.get(id) ?? null;
    const result = scored.get(id);
    if (result === undefined) {
      const sample = sampleOf(group);
      return {
        depotId: id,
        peerGroup: group,
        ranked: false,
        reason: unrankedReason(input, group !== null, standings.get(id) as Standing),
        missing: missingOf(own),
        economicsIndex: null,
        rank: null,
        peerCount: null,
        components: COMPONENTS.map((c) => ({
          key: c.key,
          value: own[c.key],
          peerMedian: medianOf(c.key, sample),
          coverage: c.key === 'earningsPerKm' ? safeCoverage(input.earningsCoverage) : null,
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
      peerCount: sampleOf(group).length,
      components: result.components,
      provenance: 'modelled',
    };
  });
}
