import { describe, it, expect } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { inferYard, inferYardGroup, YARD_ADJACENT_M, YARD_LINK_M } from '@/lib/depot/infer/yard';
import { busAt, file, lot, membersOf, regs, seededShuffle } from './depot-yard.fixtures';

/*
 * Groups of parked buses whose nearest buses stand within 300 m of each other
 * are one place, as long as the place stays within the span limit. Kaushambi is one
 * compound with two parking areas about 126 m apart; the 150 m link joins them or not
 * depending on which buses stand at the edges, and the dominance rule then refused 42
 * against 40. Two groups kilometres apart are still two places.
 */

/** Kaushambi's shape: 42 buses in rows of 6 and 40 in rows of 5, `gapM` apart east-west. */
function compound(gapM: number): { readonly west: DepotBusRow[]; readonly east: DepotBusRow[] } {
  const west = lot('W', 42, { x: 0, y: 0 }, 6);
  // The west area's east edge is at x = 100; the east area begins `gapM` further on.
  const east = lot('E', 40, { x: 100 + gapM, y: 0 }, 5);
  return { west, east };
}

describe('the adjacency distance', () => {
  it('is twice the link distance: 300 m', () => {
    expect(YARD_ADJACENT_M).toBe(2 * YARD_LINK_M);
    expect(YARD_ADJACENT_M).toBe(300);
  });
});

describe('two parking areas of one compound', () => {
  it('are one yard of 82 when their nearest buses stand 160 m apart', () => {
    const { west, east } = compound(160);
    const all = [...west, ...east];
    // The old rule saw two places of 42 and 40 and refused the yard.
    expect(inferYardGroup(all, 0)).toBeNull();
    expect(inferYard(all)).toMatchObject({ parked: 82, inCluster: 82 });
    expect(membersOf(all)).toEqual(regs(all));
  });

  it('are two places, and no yard, when their nearest buses stand 320 m apart', () => {
    const { west, east } = compound(320);
    expect(inferYard([...west, ...east])).toBeNull();
  });

  it('merge at 300 m exactly and not at 301 m', () => {
    const at = (gapM: number): DepotBusRow[] => {
      const { west, east } = compound(gapM);
      return [...west, ...east];
    };
    expect(inferYard(at(299.5))).toMatchObject({ inCluster: 82 });
    expect(inferYard(at(301))).toBeNull();
  });

  it('do not merge when together they would be more than 1.5 km across', () => {
    // Two long files 200 m apart: 0..820 m and 1020..1800 m, 1.8 km end to end.
    const west = file('W', 42, { x: 0, y: 0 }, { x: 20, y: 0 });
    const east = file('E', 40, { x: 1020, y: 0 }, { x: 20, y: 0 });
    expect(inferYard([...west, ...east])).toBeNull();
    // A west file of 61 (0..1200 m) beats the 40 left as its rival, and keeps them out.
    const longer = file('W', 61, { x: 0, y: 0 }, { x: 20, y: 0 });
    const east2 = file('E', 40, { x: 1400, y: 0 }, { x: 10, y: 0 });
    const all = [...longer, ...east2];
    expect(inferYard(all)).toMatchObject({ parked: 101, inCluster: 61 });
    expect(membersOf(all)).toEqual(regs(longer));
  });
});

/** Rows of 4, 10 m apart: a compact area of `n` buses with its west edge at `x`. */
const area = (prefix: string, n: number, x: number): DepotBusRow[] =>
  lot(prefix, n, { x, y: 0 }, 4, 10);

describe('a chain of areas', () => {
  // A at 0..30 m, B at 230..260 m, C at 460..490 m: A and C are 430 m apart.
  it('is one place when each is within 300 m of the next, though the ends are not', () => {
    const rows = [...area('A', 10, 0), ...area('B', 8, 230), ...area('C', 8, 460)];
    expect(inferYardGroup(rows, 0)).toBeNull();
    expect(inferYard(rows)).toMatchObject({ parked: 26, inCluster: 26 });
  });

  it('is reached from whichever end is the largest', () => {
    const rows = [...area('A', 8, 0), ...area('B', 8, 230), ...area('C', 12, 460)];
    expect(inferYard(rows)).toMatchObject({ parked: 28, inCluster: 28 });
  });

  it('stops where the next area would take the place beyond the span limit', () => {
    // A long file 0..780 m, a short one at 980..1160 m, a third at 1360..1540 m.
    const a = file('A', 40, { x: 0, y: 0 }, { x: 20, y: 0 });
    const b = file('B', 10, { x: 980, y: 0 }, { x: 20, y: 0 });
    const c = file('C', 10, { x: 1360, y: 0 }, { x: 20, y: 0 });
    const all = [...a, ...b, ...c];
    expect(membersOf(all)).toEqual(regs([...a, ...b]));
    expect(inferYard(all)).toMatchObject({ parked: 60, inCluster: 50 });
  });
});

describe('the order in which areas are taken', () => {
  /*
   * A long file in the middle (0..780 m) with an equal area 200 m off each end. Either
   * end fits within 1.5 km with the middle; both together do not (1540 m). The tie between
   * the ends is broken as the clustering breaks ties between equal places: the one whose
   * core bus has the lowest registration comes first.
   */
  function ends(westPrefix: string, eastPrefix: string): DepotBusRow[] {
    return [
      ...file('M', 40, { x: 0, y: 0 }, { x: 20, y: 0 }),
      ...file(westPrefix, 10, { x: -380, y: 0 }, { x: 20, y: 0 }),
      ...file(eastPrefix, 10, { x: 980, y: 0 }, { x: 20, y: 0 }),
    ];
  }

  it.each([
    ['west', 'B', 'C'],
    ['east', 'C', 'B'],
  ])('takes the %s end when its buses have the lower registrations', (_, west, east) => {
    const rows = ends(west, east);
    const taken = regs(rows.filter((r) => r.registrationNumber.startsWith('B')));
    const members = membersOf(rows)!;
    expect(members).toEqual(expect.arrayContaining(taken));
    expect(members.filter((reg) => reg.startsWith('C'))).toEqual([]);
    expect(inferYard(rows)).toMatchObject({ parked: 60, inCluster: 50 });
    for (let seed = 1; seed <= 10; seed += 1) {
      expect(inferYardGroup(seededShuffle(rows, seed))).toEqual(inferYardGroup(rows));
    }
  });

  it('takes the larger end first, whatever the registrations', () => {
    const rows = [
      ...file('M', 40, { x: 0, y: 0 }, { x: 20, y: 0 }),
      ...file('B', 10, { x: -380, y: 0 }, { x: 20, y: 0 }),
      ...file('C', 11, { x: 980, y: 0 }, { x: 20, y: 0 }),
    ];
    const members = membersOf(rows)!;
    expect(members.filter((reg) => reg.startsWith('C'))).toHaveLength(11);
    expect(members.filter((reg) => reg.startsWith('B'))).toEqual([]);
  });
});

describe('buses that belong to no group', () => {
  it('are not taken into the place, however near they stand', () => {
    const yard = area('A', 10, 0);
    const lone = [busAt('L1', { x: 200, y: 0 }), busAt('L2', { x: -250, y: 40 })];
    const all = [...yard, ...lone];
    expect(membersOf(all)).toEqual(regs(yard));
    expect(inferYard(all)).toMatchObject({ parked: 12, inCluster: 10 });
    expect(inferYardGroup(all)).toEqual(inferYardGroup(all, 0));
  });

  it('do not carry the reach of the place on to a group beyond them', () => {
    // A lone bus 200 m east of the yard, and a stand 200 m beyond it: 430 m from the yard.
    const yard = area('A', 13, 0);
    const all = [...yard, busAt('L', { x: 230, y: 0 }), ...area('S', 8, 460)];
    expect(membersOf(all)).toEqual(regs(yard));
  });
});
