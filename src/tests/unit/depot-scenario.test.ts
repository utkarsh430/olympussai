import { describe, it, expect } from 'vitest';
import { compareOutcomes, runScenario } from '@/lib/depot/optimise/scenario';
import {
  DEFAULT_SPARE_RATIO,
  MAX_FLEET_ADJUSTMENT,
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
    // Depots 0.5 degrees apart are about 72 km by road at the default detour, so a
    // legitimate 25 km limit (no clamp) leaves every deficit out of reach.
    const near = runScenario(BASE, { maxTransferKm: MIN_TRANSFER_KM });
    expect(near.plan.transfers).toEqual([]);
    expect(near.clamped).toEqual([]);
    const far = runScenario(BASE, { maxTransferKm: MAX_TRANSFER_KM });
    expect(far.plan.transfers.length).toBeGreaterThan(0);
    // A limit below the floor is raised to it, so still no transfers, and a note says so.
    const below = runScenario(BASE, { maxTransferKm: 1 });
    expect(below.plan.transfers).toEqual([]);
    expect(below.clamped).toHaveLength(1);
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

/** One depot with the given peak, so spare and surge arithmetic can be read off directly. */
function single(peak: number): readonly DepotBalance[] {
  return [depot('x', 1000, peak, 26)];
}

describe('exact scenario arithmetic', () => {
  it('does not let float noise add a bus to the spare target', () => {
    const spare = (ratio: number, peak: number): number =>
      byId(runScenario(single(peak), { spareRatio: ratio }).balances, 'x').spareTarget;
    expect(spare(0.07, 100)).toBe(7);
    expect(spare(0.14, 50)).toBe(7);
    expect(spare(0.28, 25)).toBe(7);
  });

  it('rounds an exact half of a surge up', () => {
    const peakAfter = (peak: number, percent: number): number =>
      byId(runScenario(single(peak), { demandSurges: [{ depotId: 'x', percent }] }).balances, 'x')
        .peakRequirement;
    expect(peakAfter(50, 15)).toBe(58);
    expect(peakAfter(45, -30)).toBe(32);
    expect(peakAfter(50, 12.5)).toBe(56); // 56.25
  });

  it('spare target is the exact rational ceiling for every 1% ratio and peak 1-400', () => {
    for (let hundredths = 0; hundredths <= 30; hundredths++) {
      for (let peak = 1; peak <= 400; peak++) {
        const out = runScenario(single(peak), { spareRatio: hundredths / 100 });
        const expected = Math.floor((peak * hundredths + 99) / 100);
        expect(byId(out.balances, 'x').spareTarget, `${hundredths}% of ${peak}`).toBe(expected);
        expect(out.clamped).toEqual([]);
      }
    }
  });

  it('surged peak is the exact round-half-up result for every whole percent -50..100', () => {
    for (let percent = -50; percent <= 100; percent++) {
      for (let peak = 1; peak <= 400; peak++) {
        const out = runScenario(single(peak), { demandSurges: [{ depotId: 'x', percent }] });
        const expected = Math.floor((2 * peak * (100 + percent) + 100) / 200);
        expect(byId(out.balances, 'x').peakRequirement, `${percent}% of ${peak}`).toBe(expected);
      }
    }
  });
});

describe('hostile and compounded scenario inputs', () => {
  const adjust = (deltaBuses: number) =>
    runScenario(BASE, { fleetAdjustments: [{ depotId: 'a', deltaBuses }] });

  it('treats a non-finite fleet delta as 0 with a note', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const out = adjust(bad);
      expect(byId(out.balances, 'a')).toEqual(byId(runScenario(BASE, {}).balances, 'a'));
      expect(out.clamped).toHaveLength(1);
    }
  });

  it('truncates a fractional fleet delta toward zero with a note', () => {
    expect(byId(adjust(2.9).balances, 'a').available).toBe(132);
    expect(byId(adjust(-2.9).balances, 'a').available).toBe(128);
    expect(adjust(2.9).clamped).toHaveLength(1);
  });

  it('clamps the fleet delta magnitude to MAX_FLEET_ADJUSTMENT with a note', () => {
    const up = adjust(100000);
    expect(byId(up.balances, 'a').available).toBe(130 + MAX_FLEET_ADJUSTMENT);
    expect(up.clamped).toHaveLength(1);
  });

  it('falls back to defaults for non-finite ratio, distance and surge, with notes', () => {
    const out = runScenario(BASE, {
      spareRatio: NaN,
      maxTransferKm: Infinity,
      demandSurges: [{ depotId: 'a', percent: NaN }],
    });
    expect(out.clamped).toHaveLength(3);
    expect(out.balances).toEqual(runScenario(BASE, {}).balances);
    expect(out.plan).toEqual(runScenario(BASE, {}).plan);
  });

  it('sums surges on one depot and clamps the sum with a note', () => {
    const two = runScenario(BASE, {
      demandSurges: [
        { depotId: 'a', percent: 100 },
        { depotId: 'a', percent: 100 },
      ],
    });
    expect(byId(two.balances, 'a').peakRequirement).toBe(200);
    expect(two.clamped).toHaveLength(1);
    const offsetting = runScenario(BASE, {
      demandSurges: [
        { depotId: 'a', percent: 30 },
        { depotId: 'a', percent: -10 },
      ],
    });
    expect(byId(offsetting.balances, 'a').peakRequirement).toBe(120);
    expect(offsetting.clamped).toEqual([]);
  });

  it('sums fleet adjustments on one depot before the availability floor', () => {
    const out = runScenario(BASE, {
      fleetAdjustments: [
        { depotId: 'b', deltaBuses: -60 },
        { depotId: 'b', deltaBuses: -60 },
      ],
    });
    expect(byId(out.balances, 'b').available).toBe(0);
    expect(out.clamped).toHaveLength(1);
    const net = runScenario(BASE, {
      fleetAdjustments: [
        { depotId: 'b', deltaBuses: -60 },
        { depotId: 'b', deltaBuses: 50 },
      ],
    });
    expect(byId(net.balances, 'b').available).toBe(80);
    expect(net.clamped).toEqual([]);
  });

  it('never throws on hostile input', () => {
    const hostile = [NaN, Infinity, -Infinity, 1e300, -1e300, -7, 0.5, 2.5];
    for (const n of hostile) {
      expect(() =>
        runScenario(BASE, {
          spareRatio: n,
          maxTransferKm: n,
          fleetAdjustments: [
            { depotId: 'a', deltaBuses: n },
            { depotId: 'a', deltaBuses: n },
            { depotId: 'nope', deltaBuses: n },
            { depotId: 'e', deltaBuses: n },
          ],
          demandSurges: [
            { depotId: 'b', percent: n },
            { depotId: 'b', percent: n },
            { depotId: 'nope', percent: n },
          ],
        }),
      ).not.toThrow();
    }
  });
});
