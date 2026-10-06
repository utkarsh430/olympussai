import { describe, it, expect } from 'vitest';
import { compareOutcomes, runScenario } from '@/lib/depot/optimise/scenario';
import {
  DEFAULT_SPARE_RATIO,
  MAX_SPARE_RATIO,
  MAX_SURGE_PERCENT,
  MAX_TRANSFER_KM,
  MIN_SURGE_PERCENT,
  MIN_TRANSFER_KM,
} from '@/lib/depot/optimise/config';
import { planTransfers } from '@/lib/depot/optimise/rebalance';
import { DEFAULT_REBALANCE_PARAMS } from '@/lib/depot/optimise/config';
import type { DepotBalance } from '@/lib/depot/optimise/types';

function depot(
  depotId: string,
  available: number,
  peakRequirement: number,
  lat: number,
  kind: DepotBalance['kind'] = 'depot',
): DepotBalance {
  const spareTarget = Math.ceil(peakRequirement * DEFAULT_SPARE_RATIO);
  const required = peakRequirement + spareTarget;
  return {
    depotId,
    depotName: depotId.toUpperCase(),
    kind,
    fleet: available + 4,
    offRoad: 4,
    available,
    peakRequirement,
    spareTarget,
    required,
    balance: available - required,
    position: { lat, lng: 80 },
  };
}

const BASE: readonly DepotBalance[] = [
  depot('a', 130, 100, 26.0), // required 108, +22
  depot('b', 90, 100, 26.5), // required 108, -18
  depot('c', 60, 50, 27.0), // required 54, +6
  depot('e', 10, 10, 26.2, 'enforcement'),
];

function byId(rows: readonly DepotBalance[], id: string): DepotBalance {
  const row = rows.find((r) => r.depotId === id);
  if (!row) throw new Error(`missing ${id}`);
  return row;
}

describe('runScenario', () => {
  it('with an empty scenario reproduces the default plan and changes nothing', () => {
    const outcome = runScenario(BASE, {});
    expect(outcome.clamped).toEqual([]);
    expect(outcome.balances).toEqual(BASE);
    const depotsOnly = BASE.filter((b) => b.kind === 'depot');
    expect(outcome.plan).toEqual(planTransfers(depotsOnly, DEFAULT_REBALANCE_PARAMS));
  });

  it('applies fleet adjustments to fleet and available, flooring available at zero', () => {
    const outcome = runScenario(BASE, {
      fleetAdjustments: [
        { depotId: 'a', deltaBuses: -10 },
        { depotId: 'b', deltaBuses: -500 },
      ],
    });
    expect(byId(outcome.balances, 'a')).toMatchObject({ fleet: 124, available: 120, balance: 12 });
    expect(byId(outcome.balances, 'b')).toMatchObject({ fleet: 4, available: 0, balance: -108 });
    expect(outcome.clamped).toHaveLength(1);
    expect(outcome.clamped[0]).toContain('b');
  });

  it('scales peak requirement by a surge, rounded and floored at zero, then recomputes', () => {
    const outcome = runScenario(BASE, { demandSurges: [{ depotId: 'c', percent: 25 }] });
    // 50 * 1.25 = 62.5 -> 63 (round half up); spare = ceil(63 * 0.08) = 6; required 69.
    expect(byId(outcome.balances, 'c')).toMatchObject({
      peakRequirement: 63,
      spareTarget: 6,
      required: 69,
      balance: -9,
    });
    expect(outcome.clamped).toEqual([]);
  });

  it('derives spare from the surged peak using the scenario ratio', () => {
    const outcome = runScenario(BASE, {
      spareRatio: 0.1,
      demandSurges: [{ depotId: 'a', percent: 10 }],
    });
    const a = byId(outcome.balances, 'a');
    expect(a.peakRequirement).toBe(110);
    expect(a.spareTarget).toBe(11);
    expect(a.required).toBe(121);
    expect(a.balance).toBe(130 - 121);
  });

  it('applies fleet changes before surges so both land in the balance', () => {
    const outcome = runScenario(BASE, {
      fleetAdjustments: [{ depotId: 'a', deltaBuses: 5 }],
      demandSurges: [{ depotId: 'a', percent: 20 }],
    });
    expect(byId(outcome.balances, 'a')).toMatchObject({
      fleet: 139,
      available: 135,
      peakRequirement: 120,
      spareTarget: 10,
      required: 130,
      balance: 5,
    });
  });

  it('passes non-depot kinds through untouched and keeps them out of the plan', () => {
    const outcome = runScenario(BASE, {
      spareRatio: 0.2,
      fleetAdjustments: [{ depotId: 'e', deltaBuses: 50 }],
    });
    expect(byId(outcome.balances, 'e')).toEqual(byId(BASE, 'e'));
    const touched = outcome.plan.transfers.flatMap((t) => [t.fromDepotId, t.toDepotId]);
    expect(touched).not.toContain('e');
  });

  it('clamps out-of-range inputs and says so', () => {
    const outcome = runScenario(BASE, {
      spareRatio: 0.9,
      maxTransferKm: 5000,
      demandSurges: [
        { depotId: 'a', percent: 400 },
        { depotId: 'b', percent: -90 },
      ],
    });
    expect(outcome.clamped).toHaveLength(4);
    expect(byId(outcome.balances, 'a').peakRequirement).toBe(100 * (1 + MAX_SURGE_PERCENT / 100));
    expect(byId(outcome.balances, 'b').peakRequirement).toBe(100 * (1 + MIN_SURGE_PERCENT / 100));
    expect(byId(outcome.balances, 'c').spareTarget).toBe(Math.ceil(50 * MAX_SPARE_RATIO));

    const low = runScenario(BASE, { spareRatio: -1, maxTransferKm: 1 });
    expect(low.clamped).toHaveLength(2);
    expect(byId(low.balances, 'c').spareTarget).toBe(0);
  });

  it('honours the clamped transfer range', () => {
    // Depots 0.5 degrees apart are about 72 km by road at the default detour.
    const near = runScenario(BASE, { maxTransferKm: MIN_TRANSFER_KM });
    expect(near.plan.transfers.every((t) => t.distanceKm <= MIN_TRANSFER_KM)).toBe(true);
    const far = runScenario(BASE, { maxTransferKm: MAX_TRANSFER_KM });
    expect(far.plan.transfers.length).toBeGreaterThan(0);
  });

  it('uses scenario locks and exclusions in the plan', () => {
    const outcome = runScenario(BASE, { lockedDepotIds: ['a'], excludedDepotIds: ['c'] });
    expect(outcome.plan.transfers).toEqual([]);
    expect(outcome.plan.uncovered).toEqual([
      { depotId: 'b', buses: 18, reason: 'no_surplus_in_range' },
    ]);
  });

  it('ignores adjustments for unknown depots with a note, and never mutates the base', () => {
    const frozen = BASE.map((b) => Object.freeze({ ...b }));
    const snapshot = JSON.stringify(frozen);
    const outcome = runScenario(frozen, { fleetAdjustments: [{ depotId: 'zz', deltaBuses: 3 }] });
    expect(outcome.clamped).toHaveLength(1);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  it('is deterministic', () => {
    const scenario = { spareRatio: 0.12, demandSurges: [{ depotId: 'a', percent: 15 }] };
    expect(runScenario(BASE, scenario).plan).toEqual(
      runScenario([...BASE].reverse(), scenario).plan,
    );
  });
});

describe('compareOutcomes', () => {
  it('returns candidate minus baseline for every field', () => {
    const baseline = runScenario(BASE, {});
    const candidate = runScenario(BASE, { demandSurges: [{ depotId: 'b', percent: 50 }] });
    const delta = compareOutcomes(baseline, candidate);
    const moved = (o: typeof baseline): number => o.plan.transfers.reduce((s, t) => s + t.buses, 0);
    const uncovered = (o: typeof baseline): number =>
      o.plan.uncovered.reduce((s, u) => s + u.buses, 0);
    expect(delta).toEqual({
      transfers: candidate.plan.transfers.length - baseline.plan.transfers.length,
      busesMoved: moved(candidate) - moved(baseline),
      totalBusKm: candidate.plan.totalBusKm - baseline.plan.totalBusKm,
      coveredDeficit: candidate.plan.coveredDeficit - baseline.plan.coveredDeficit,
      uncoveredDeficit: uncovered(candidate) - uncovered(baseline),
      depotsInDeficitAfter:
        candidate.plan.after.depotsInDeficit - baseline.plan.after.depotsInDeficit,
    });
    expect(delta.busesMoved).toBeGreaterThan(0);
    expect(delta.uncoveredDeficit).toBeGreaterThan(0);
  });

  it('is all zeros against itself', () => {
    const outcome = runScenario(BASE, {});
    expect(compareOutcomes(outcome, outcome)).toEqual({
      transfers: 0,
      busesMoved: 0,
      totalBusKm: 0,
      coveredDeficit: 0,
      uncoveredDeficit: 0,
      depotsInDeficitAfter: 0,
    });
  });
});
