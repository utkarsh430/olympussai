import { describe, it, expect } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { inferYardGroup, type YardGroup } from '@/lib/depot/infer/yard';
import { busAt, lot, seededRandom, seededShuffle } from './depot-yard.fixtures';

/** Metres: depots are drawn in a square this wide, so many of their groups stand near. */
const SITE_M = 1600;

/**
 * A random depot: one to five parking areas of 2 to 45 buses, rows of 2 to 8, 10 to 30 m
 * apart, anywhere on the site, and up to ten buses standing alone. Areas fall within
 * 300 m of each other often enough to merge, and far apart often enough to stay two.
 */
function randomDepot(seed: number, areasApartM = 0): DepotBusRow[] {
  const next = seededRandom(seed);
  const pick = (low: number, high: number): number => low + Math.floor(next() * (high - low + 1));
  const areas = Array.from({ length: pick(1, 5) }, (_, a) =>
    lot(
      `${String.fromCharCode(65 + a)}${seed}-`,
      pick(2, 45),
      { x: next() * SITE_M + a * areasApartM, y: next() * SITE_M },
      pick(2, 8),
      pick(10, 30),
    ),
  );
  const alone = Array.from({ length: pick(0, 10) }, (_, i) =>
    busAt(`L${seed}-${i}`, { x: next() * SITE_M, y: next() * SITE_M }),
  );
  return [...areas.flat(), ...alone];
}

const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);
/** The rule without the S46 merge: no group is close enough to join another. */
const withoutMerge = (rows: readonly DepotBusRow[]): YardGroup | null => inferYardGroup(rows, 0);

describe('merging adjacent groups never takes a yard away (Ruling S46)', () => {
  it('keeps every yard the old rule found, with every bus it held', () => {
    let kept = 0;
    let grown = 0;
    let gained = 0;
    for (const seed of SEEDS) {
      const rows = randomDepot(seed);
      const before = withoutMerge(rows);
      const after = inferYardGroup(rows);
      if (before === null) {
        if (after !== null) gained += 1;
        continue;
      }
      expect(after, `seed ${seed}`).not.toBeNull();
      expect(after!.yard.parked).toBe(before.yard.parked);
      expect(after!.members).toEqual(expect.arrayContaining([...before.members]));
      expect(after!.yard.inCluster).toBeGreaterThanOrEqual(before.yard.inCluster);
      kept += 1;
      if (after!.yard.inCluster > before.yard.inCluster) grown += 1;
    }
    // The sample exercises all three cases, so the property is not vacuous.
    expect(kept).toBeGreaterThan(100);
    expect(grown).toBeGreaterThan(10);
    expect(gained).toBeGreaterThan(10);
  });

  it('is the old rule exactly when every area stands kilometres from the others', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const rows = randomDepot(seed, 5_000);
      expect(inferYardGroup(rows), `seed ${seed}`).toEqual(withoutMerge(rows));
    }
  });
});

describe('the merged yard does not depend on how the feed lists its buses', () => {
  it('gives the same answer for random depots in any input order', () => {
    for (const seed of SEEDS.slice(0, 80)) {
      const rows = randomDepot(seed);
      const base = inferYardGroup(rows);
      expect(inferYardGroup([...rows].reverse()), `seed ${seed}`).toEqual(base);
      for (const shuffle of [1, 2, 3]) {
        expect(inferYardGroup(seededShuffle(rows, seed * 10 + shuffle))).toEqual(base);
      }
    }
  });
});
