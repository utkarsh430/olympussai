import {
  ECONOMICS_WEIGHTS,
  ECONOMICS_Z_CLAMP,
} from '../sim/revenueConfig';
import type { Coverage } from '../types';
import { clamp, median, robustZ } from '../stats/robust';
import type {
  EconomicsComponent,
  EconomicsComponentKey,
  EconomicsInput,
} from './types';

/*
 * The scoring of one depot's three components against a peer sample, and the
 * index they add up to. Split from economicsIndex.ts, which decides who is
 * ranked and in what order.
 */

interface ComponentConfig {
  readonly key: EconomicsComponentKey;
  readonly weight: number;
  readonly higherIsBetter: boolean;
}

export const COMPONENTS: readonly ComponentConfig[] = [
  { key: 'earningsPerKm', weight: ECONOMICS_WEIGHTS.earningsPerKm, higherIsBetter: true },
  { key: 'costPerKm', weight: ECONOMICS_WEIGHTS.costPerKm, higherIsBetter: false },
  { key: 'loadFactor', weight: ECONOMICS_WEIGHTS.loadFactor, higherIsBetter: true },
];

const INDEX_CENTRE = 50;
const INDEX_HALF_RANGE = 50;
const TENTH = 10;

export type Values = Readonly<Record<EconomicsComponentKey, number | null>>;

/** A figure that is not a finite number is missing, never a value. */
export function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

/** A coverage that is not a pair of finite counts is no coverage: 0 of 0. */
export function safeCoverage(coverage: Coverage): Coverage {
  return Number.isFinite(coverage.n) && Number.isFinite(coverage.of)
    ? { n: coverage.n, of: coverage.of }
    : { n: 0, of: 0 };
}

export function valuesOf(input: Readonly<EconomicsInput>): Values {
  return {
    earningsPerKm: finiteOrNull(input.earningsPerKm),
    costPerKm: finiteOrNull(input.costPerKm),
    loadFactor: finiteOrNull(input.loadFactor),
  };
}

export function missingOf(values: Values): EconomicsComponentKey[] {
  return COMPONENTS.filter((c) => values[c.key] === null).map((c) => c.key);
}

export function medianOf(key: EconomicsComponentKey, sample: readonly Values[]): number | null {
  return median(sample.flatMap((v) => (v[key] === null ? [] : [v[key] as number])));
}

export function scoreComponents(
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
    const clamped = raw === null ? 0 : clamp(raw, -ECONOMICS_Z_CLAMP, ECONOMICS_Z_CLAMP);
    // Written this way so a zero z never becomes negative zero.
    const z = config.higherIsBetter || clamped === 0 ? clamped : -clamped;
    return { ...base, z, contribution: config.weight * z };
  });
}

export function indexFrom(components: readonly EconomicsComponent[]): number {
  const weighted = components.reduce((sum, c) => sum + c.contribution, 0);
  const scaled = INDEX_CENTRE + (weighted / ECONOMICS_Z_CLAMP) * INDEX_HALF_RANGE;
  return Math.round(clamp(scaled, 0, 100) * TENTH) / TENTH;
}
