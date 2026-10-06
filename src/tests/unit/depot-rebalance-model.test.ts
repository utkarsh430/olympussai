import { describe, expect, it } from 'vitest';
import { MAX_ARC_PX, MIN_ARC_PX, arcWidthPx, mapGeometry } from '@/lib/depot/rebalance/mapGeometry';
import { balanceRows, planSummary } from '@/lib/depot/rebalance/rebalanceModel';
import { transferRows, uncoveredRows } from '@/lib/depot/rebalance/transferModel';
import type { DepotBalance, TransferPlan } from '@/lib/depot/optimise/types';

function balance(
  depotId: string,
  available: number,
  required: number,
  position: { lat: number; lng: number } | null,
  kind: DepotBalance['kind'] = 'depot',
): DepotBalance {
  return {
    depotId,
    depotName: depotId.toUpperCase(),
    kind,
    fleet: available + 2,
    offRoad: 2,
    available,
    peakRequirement: required,
    spareTarget: 0,
    required,
    balance: available - required,
    position,
  };
}

const BALANCES: readonly DepotBalance[] = [
  balance('agra', 40, 30, { lat: 27.18, lng: 78.0 }),
  balance('kanpur', 20, 28, { lat: 26.45, lng: 80.33 }),
  balance('lucknow', 25, 25, { lat: 26.85, lng: 80.95 }),
  balance('banda', 10, 16, { lat: 25.48, lng: 80.33 }),
  balance('noida', 5, 9, null),
  balance('hired-1', 12, 12, { lat: 26.0, lng: 80.0 }, 'hired'),
];

const PLAN: TransferPlan = {
  transfers: [
    {
      id: 'agra>kanpur',
      fromDepotId: 'agra',
      toDepotId: 'kanpur',
      buses: 8,
      distanceKm: 310.2,
      busKm: 2481.6,
    },
    {
      id: 'agra>banda',
      fromDepotId: 'agra',
      toDepotId: 'banda',
      buses: 2,
      distanceKm: 330.5,
      busKm: 661,
    },
  ],
  before: { depotsInDeficit: 3, depotsInSurplus: 1, totalDeficit: 18, totalSurplus: 10 },
  after: { depotsInDeficit: 2, depotsInSurplus: 0, totalDeficit: 8, totalSurplus: 0 },
  coveredDeficit: 10,
  uncovered: [
    { depotId: 'banda', buses: 4, reason: 'insufficient_surplus' },
    { depotId: 'noida', buses: 4, reason: 'no_position' },
  ],
  totalBusKm: 3142.6,
};

describe('planSummary', () => {
  it('reconciles with the plan before and after', () => {
    const s = planSummary(PLAN);
    expect(s.before).toEqual(PLAN.before);
    expect(s.after).toEqual(PLAN.after);
    expect(s.busesMoved).toBe(10);
    expect(s.coveredDeficit).toBe(10);
    expect(s.uncoveredDeficit).toBe(8);
    expect(s.coveredDeficit + s.uncoveredDeficit).toBe(s.before.totalDeficit);
    expect(s.uncoveredDeficit).toBe(s.after.totalDeficit);
    expect(s.busKm).toBe(3142.6);
    expect(s.transfers).toBe(2);
  });

  it('summarises an empty plan without NaN', () => {
    const empty: TransferPlan = {
      transfers: [],
      before: { depotsInDeficit: 0, depotsInSurplus: 0, totalDeficit: 0, totalSurplus: 0 },
      after: { depotsInDeficit: 0, depotsInSurplus: 0, totalDeficit: 0, totalSurplus: 0 },
      coveredDeficit: 0,
      uncovered: [],
      totalBusKm: 0,
    };
    const s = planSummary(empty);
    expect(Object.values(s).every((v) => typeof v !== 'number' || Number.isFinite(v))).toBe(true);
    expect(s.busesMoved).toBe(0);
  });
});

describe('balanceRows', () => {
  it('lists operating depots by balance ascending, then other kinds as not taking part', () => {
    const rows = balanceRows(BALANCES);
    expect(rows.map((r) => r.depotId)).toEqual([
      'kanpur',
      'banda',
      'noida',
      'lucknow',
      'agra',
      'hired-1',
    ]);
    expect(rows.filter((r) => !r.takesPart).map((r) => r.depotId)).toEqual(['hired-1']);
    expect(rows.find((r) => r.depotId === 'agra')?.cls).toBe('surplus');
    expect(rows.find((r) => r.depotId === 'kanpur')?.cls).toBe('deficit');
    expect(rows.find((r) => r.depotId === 'lucknow')?.cls).toBe('balanced');
  });

  it('breaks balance ties by name so the order is stable', () => {
    const tied = [balance('zeta', 5, 8, null), balance('alpha', 5, 8, null)];
    expect(balanceRows(tied).map((r) => r.depotId)).toEqual(['alpha', 'zeta']);
  });
});

describe('transferRows', () => {
  it('joins names, the giver surplus and receiver deficit before the move, and decisions', () => {
    const rows = transferRows(PLAN, BALANCES, new Map([['agra>kanpur', 'approved' as const]]));
    expect(rows[0]).toEqual({
      id: 'agra>kanpur',
      fromDepotId: 'agra',
      fromName: 'AGRA',
      toDepotId: 'kanpur',
      toName: 'KANPUR',
      buses: 8,
      distanceKm: 310.2,
      busKm: 2481.6,
      giverSurplusBefore: 10,
      receiverDeficitBefore: 8,
      decision: 'approved',
    });
    expect(rows[1]?.decision).toBeNull();
  });

  it('falls back to the depot id when a balance is missing', () => {
    const rows = transferRows(PLAN, [], new Map());
    expect(rows[0]?.fromName).toBe('agra');
    expect(rows[0]?.giverSurplusBefore).toBe(0);
  });
});

describe('uncoveredRows', () => {
  it('says what each reason means for that depot', () => {
    const plan: TransferPlan = {
      ...PLAN,
      uncovered: [
        { depotId: 'banda', buses: 4, reason: 'insufficient_surplus' },
        { depotId: 'kanpur', buses: 1, reason: 'no_surplus_in_range' },
        { depotId: 'noida', buses: 4, reason: 'no_position' },
        { depotId: 'lucknow', buses: 3, reason: 'excluded' },
      ],
    };
    const rows = uncoveredRows(plan, BALANCES, 250);
    expect(rows.map((r) => r.sentence)).toEqual([
      'BANDA stays 4 buses short: depots within 250 km had spare buses, but not enough for every depot in range.',
      'KANPUR stays 1 bus short: no depot with spare buses lies within the maximum transfer distance of 250 km.',
      'NOIDA stays 4 buses short: it has no known position, so no transfer can be routed to it.',
      'LUCKNOW stays 3 buses short: it is excluded from this plan, so it neither gives nor receives.',
    ]);
  });
});

describe('arcWidthPx', () => {
  it('grows monotonically on a square-root scale within the named bounds', () => {
    const widths = [0, 1, 2, 5, 10, 40, 100].map((b) => arcWidthPx(b, 40));
    widths.slice(1).forEach((w, i) => expect(w).toBeGreaterThanOrEqual(widths[i] as number));
    expect(arcWidthPx(40, 40)).toBe(MAX_ARC_PX);
    expect(arcWidthPx(100, 40)).toBe(MAX_ARC_PX);
    expect(arcWidthPx(0, 40)).toBe(MIN_ARC_PX);
    expect(arcWidthPx(10, 40)).toBeCloseTo(MIN_ARC_PX + (MAX_ARC_PX - MIN_ARC_PX) * 0.5);
  });

  it('never returns NaN for zero or invalid maxima', () => {
    for (const [b, m] of [
      [0, 0],
      [3, 0],
      [Number.NaN, 5],
      [5, Number.NaN],
    ] as const) {
      expect(Number.isFinite(arcWidthPx(b, m))).toBe(true);
    }
  });
});

describe('mapGeometry', () => {
  it('draws one node per positioned operating depot and one arc per transfer', () => {
    const geo = mapGeometry(BALANCES, PLAN);
    expect(geo.nodes.map((n) => n.depotId).sort()).toEqual(['agra', 'banda', 'kanpur', 'lucknow']);
    expect(geo.nodes.find((n) => n.depotId === 'agra')?.cls).toBe('surplus');
    expect(geo.arcs.map((a) => a.transferId)).toEqual(['agra>kanpur', 'agra>banda']);
    const [big, small] = geo.arcs;
    expect(big?.widthPx).toBe(MAX_ARC_PX);
    expect(small?.widthPx).toBeLessThan(big?.widthPx ?? 0);
    expect(big?.from).toEqual({ lat: 27.18, lng: 78.0 });
    expect(big?.to).toEqual({ lat: 26.45, lng: 80.33 });
  });

  it('does not mutate its inputs', () => {
    const balancesCopy = structuredClone(BALANCES);
    const planCopy = structuredClone(PLAN);
    mapGeometry(BALANCES, PLAN);
    balanceRows(BALANCES);
    transferRows(PLAN, BALANCES, new Map());
    uncoveredRows(PLAN, BALANCES, 250);
    planSummary(PLAN);
    expect(BALANCES).toEqual(balancesCopy);
    expect(PLAN).toEqual(planCopy);
  });
});
