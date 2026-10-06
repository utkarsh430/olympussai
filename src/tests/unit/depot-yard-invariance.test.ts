import { describe, it, expect } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { distanceM, median } from '@/lib/depot/infer/geo';
import {
  inferYardGroup,
  inferYards,
  YARD_MIN_RADIUS_M,
  YARD_RADIUS_PAD_M,
} from '@/lib/depot/infer/yard';
import {
  blob,
  busAt,
  centreOf,
  far,
  file,
  readingInYard,
  scattered,
  seededRandom,
  seededShuffle,
  shifted,
} from './depot-yard.fixtures';

const HERE = { x: 0, y: 0 };

/** A yard of `n` buses strewn over a `width` by `height` metre lot, with a stand and strays. */
function strewn(seed: number, n: number, width: number, height: number): DepotBusRow[] {
  const next = seededRandom(seed);
  const lot = Array.from({ length: n }, (_, i) =>
    busAt(`L${i}`, { x: next() * width, y: next() * height }),
  );
  return [...lot, ...blob('S', 8, { x: width + 600, y: 300 }), ...scattered('N', 6)];
}

const SCENARIOS: readonly (readonly [string, readonly DepotBusRow[]])[] = [
  ['a compact yard', blob('A', 10, HERE)],
  ['a strewn yard with a stand and strays', strewn(7, 40, 320, 200)],
  ['a yard, a chain and a stand', [
    ...blob('Y', 14, HERE),
    ...file('Q', 5, { x: 140, y: 0 }, { x: 140, y: 0 }),
    ...blob('S', 6, { x: 840, y: 0 }),
  ]],
  ['a dense queue', file('A', 20, HERE, { x: 60, y: 10 })],
  ['two equal stands', [...blob('A', 8, HERE), ...blob('B', 8, far(3))]],
  ['too few buses', blob('A', 5, HERE)],
];

describe('the yard does not depend on where the map happens to put it', () => {
  it.each(SCENARIOS.slice(0, 4))('keeps the same buses when %s is moved', (_, rows) => {
    const base = inferYardGroup(rows)!;
    expect(base.members.length).toBeGreaterThanOrEqual(10);
    const from = centreOf(base.yard);
    const next = seededRandom(2025);
    for (let trial = 0; trial < 60; trial += 1) {
      const by = { x: next() * 300, y: next() * 300 };
      const moved = inferYardGroup(shifted(rows, by))!;
      expect(moved.members).toEqual(base.members);
      const to = centreOf(moved.yard);
      expect(Math.abs(to.x - from.x - by.x)).toBeLessThan(1);
      expect(Math.abs(to.y - from.y - by.y)).toBeLessThan(1);
      expect(Math.abs(moved.yard.radiusM - base.yard.radiusM)).toBeLessThanOrEqual(1);
    }
  });

  it.each(SCENARIOS.slice(4))('still claims no yard when %s is moved', (_, rows) => {
    const next = seededRandom(11);
    for (let trial = 0; trial < 20; trial += 1) {
      expect(inferYardGroup(shifted(rows, { x: next() * 300, y: next() * 300 }))).toBeNull();
    }
  });
});

describe('the centre', () => {
  it('is the median latitude and longitude of the members, not their mean', () => {
    // Nine buses packed at one end and a queue trailing east: mean and median differ.
    const rows = [...blob('A', 9, HERE, 10), ...file('T', 6, { x: 60, y: 30 }, { x: 60, y: 30 })];
    const { yard, members } = inferYardGroup(rows)!;
    expect(members.length).toBe(15);
    const mean = (pick: (r: DepotBusRow) => number): number =>
      rows.reduce((sum, r) => sum + pick(r), 0) / rows.length;
    expect(yard.lat).toBeCloseTo(median(rows.map((r) => r.latitude!)), 9);
    expect(yard.lng).toBeCloseTo(median(rows.map((r) => r.longitude!)), 9);
    const meanToCentre = distanceM(
      mean((r) => r.latitude!),
      mean((r) => r.longitude!),
      yard.lat,
      yard.lng,
    );
    expect(meanToCentre).toBeGreaterThan(50);
  });
});

describe('the radius', () => {
  it('holds every member, reaching the farthest one plus the padding and no further', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const rows = strewn(seed, 30 + (seed % 4) * 10, 260 + seed * 12, 120 + seed * 6);
      const { yard, members } = inferYardGroup(rows)!;
      const memberRows = rows.filter((r) => members.includes(r.registrationNumber));
      expect(memberRows.length).toBeGreaterThanOrEqual(25);
      expect(readingInYard(memberRows, yard)).toEqual([...members]);

      const farthest = Math.max(
        ...memberRows.map((r) => distanceM(r.latitude!, r.longitude!, yard.lat, yard.lng)),
      );
      expect(yard.radiusM).toBeGreaterThan(YARD_MIN_RADIUS_M);
      expect(yard.radiusM - farthest).toBeGreaterThanOrEqual(YARD_RADIUS_PAD_M);
      expect(yard.radiusM - farthest).toBeLessThan(YARD_RADIUS_PAD_M + 1);
      expect(Number.isInteger(yard.radiusM)).toBe(true);
    }
  });

  it('is never below the minimum, however tightly the buses stand', () => {
    const { yard } = inferYardGroup(blob('A', 10, HERE, 12))!;
    expect(yard.radiusM).toBe(YARD_MIN_RADIUS_M);
    expect(YARD_RADIUS_PAD_M).toBeGreaterThan(0);
  });
});

describe('purity', () => {
  it.each(SCENARIOS)('gives the same answer for %s in any input order', (_, rows) => {
    const base = inferYardGroup(rows);
    expect(inferYardGroup(rows)).toEqual(base);
    expect(inferYardGroup([...rows].reverse())).toEqual(base);
    for (let seed = 1; seed <= 20; seed += 1) {
      expect(inferYardGroup(seededShuffle(rows, seed))).toEqual(base);
    }
  });

  it('gives the same yards for every depot whatever the order of the fleet', () => {
    const fleet = SCENARIOS.flatMap(([, rows], depot) =>
      rows.map((r) => ({ ...r, depotId: `D${depot}` })),
    );
    const base = [...inferYards(fleet)];
    expect(base.map(([id]) => id)).toEqual(['D0', 'D1', 'D2', 'D3']);
    for (let seed = 1; seed <= 10; seed += 1) {
      expect([...inferYards(seededShuffle(fleet, seed))]).toEqual(base);
    }
  });

  it('does not change its input', () => {
    const rows = strewn(3, 30, 300, 150).map((r) => Object.freeze(r));
    const before = JSON.stringify(rows);
    Object.freeze(rows);
    expect(inferYardGroup(rows)).not.toBeNull();
    expect(JSON.stringify(rows)).toBe(before);
  });
});
