import { describe, it, expect } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { inferYard, inferYardGroup, YARD_LINK_M } from '@/lib/depot/infer/yard';
import {
  blob,
  busAt,
  centreOf,
  file,
  membersOf,
  mirrored,
  regs,
  row,
  seededShuffle,
  type XY,
} from './depot-yard.fixtures';

const HERE = { x: 0, y: 0 };
const DIAGONAL = Math.SQRT1_2;
const COMPASS: readonly (readonly [string, XY])[] = [
  ['north', { x: 0, y: 1 }],
  ['north-east', { x: DIAGONAL, y: DIAGONAL }],
  ['east', { x: 1, y: 0 }],
  ['south-east', { x: DIAGONAL, y: -DIAGONAL }],
  ['south', { x: 0, y: -1 }],
  ['south-west', { x: -DIAGONAL, y: -DIAGONAL }],
  ['west', { x: -1, y: 0 }],
  ['north-west', { x: -DIAGONAL, y: DIAGONAL }],
];

/** A 14-bus yard, `between` buses in single file `spacing` apart, then a 6-bus stand. */
function joined(towards: XY, between: number, spacing: number) {
  const along = (m: number): XY => ({ x: towards.x * m, y: towards.y * m });
  const yardRows = blob('Y', 14, HERE);
  const queue = file('Q', between, along(spacing), along(spacing));
  const standRows = blob('S', 6, along(spacing * (between + 1)));
  return { yardRows, queue, standRows, all: [...yardRows, ...queue, ...standRows] };
}

describe('single buses never join two places', () => {
  const justUnderLink = YARD_LINK_M - 10;

  it.each(COMPASS)('keeps yard and stand apart along a chain running %s', (_, towards) => {
    for (const between of [3, 4, 5, 8]) {
      const { yardRows, queue, all } = joined(towards, between, justUnderLink);
      const members = membersOf(all)!;
      expect(members).toEqual(expect.arrayContaining(regs(yardRows)));
      expect(members.filter((reg) => reg.startsWith('S'))).toEqual([]);
      // At most the chain's first bus (dense against the yard) and the one bordering it.
      const chained = members.filter((reg) => reg.startsWith('Q'));
      expect(regs(queue).slice(0, 2)).toEqual(expect.arrayContaining(chained));
      expect(members.length).toBe(yardRows.length + chained.length);
    }
  });

  it('joins them when each end of a two-bus gap is dense against its own side', () => {
    // Stated, not hidden: 420 m apart with a bus every 140 m is one place of 22.
    const { all } = joined({ x: 1, y: 0 }, 2, justUnderLink);
    expect(membersOf(all)).toEqual(regs(all));
  });
});

describe('a dense queue is one place, and the span rule then decides', () => {
  const underHalfLink = YARD_LINK_M / 2 - 5;

  it('holds yard, queue and stand as one yard when they fit inside the span limit', () => {
    const { all } = joined({ x: 1, y: 0 }, 12, underHalfLink);
    expect(membersOf(all)).toEqual(regs(all));
    expect(inferYard(all)).toMatchObject({ parked: 32, inCluster: 32 });
  });

  it('claims no yard when the joined place is longer than the span limit', () => {
    const { all, yardRows } = joined({ x: 1, y: 0 }, 22, underHalfLink);
    expect(inferYard(all)).toBeNull();
    expect(membersOf(yardRows)).toEqual(regs(yardRows));
  });
});

/*
 * A 13-bus yard (12 and an outlying bus P) and a 7-bus stand (6 and an outlying bus Q),
 * with one bus X between the two outliers and within the link distance of nothing else.
 * X is a member of the yard only when it is given to P.
 */
function contested(xEast: number, pReg = 'A-P', qReg = 'Z-Q'): DepotBusRow[] {
  return [
    ...blob('Y', 12, HERE, 15),
    busAt(pReg, { x: 100, y: 0 }),
    busAt('X', { x: xEast, y: 20 }),
    busAt(qReg, { x: 300, y: 50 }),
    ...blob('S', 6, { x: 400, y: 70 }, 15),
  ];
}

describe('a bus bordering two places', () => {
  const FLIPS = [
    { ew: true, ns: false },
    { ew: false, ns: true },
    { ew: true, ns: true },
  ];

  it.each([
    ['the stand, whose bus is nearer', 205, false],
    ['the yard, whose bus is nearer', 195, true],
  ])('goes to %s, and the mirrored layout gives the mirror image', (_, xEast, inYard) => {
    const rows = contested(xEast);
    const base = inferYardGroup(rows)!;
    expect(base.members.includes('X')).toBe(inYard);
    expect(base.yard.inCluster).toBe(inYard ? 14 : 13);
    for (const flip of FLIPS) {
      const image = inferYardGroup(mirrored(rows, flip))!;
      expect(image.members).toEqual(base.members);
      expect(Math.abs(image.yard.radiusM - base.yard.radiusM)).toBeLessThanOrEqual(1);
      const [from, to] = [centreOf(base.yard), centreOf(image.yard)];
      expect(Math.abs(to.x - (flip.ew ? -from.x : from.x))).toBeLessThan(0.5);
      expect(Math.abs(to.y - (flip.ns ? -from.y : from.y))).toBeLessThan(0.5);
    }
  });

  /*
   * An exact tie, on coordinates binary fractions make exact: X at the centre, P and Q
   * the same distance either side, each backed by its own stand further out. The stand
   * behind Q is the larger and is the yard, so X is a member only when Q wins the tie.
   */
  const STEP = 2 ** -10;
  const MID = { lat: 26.5, lng: 80.5 };
  function tied(axis: 'lat' | 'lng', pReg: string, qReg: string): DepotBusRow[] {
    const at = (reg: string, steps: number, jitter = 0): DepotBusRow =>
      row({
        registrationNumber: reg,
        latitude: MID.lat + (axis === 'lat' ? steps * STEP : jitter),
        longitude: MID.lng + (axis === 'lng' ? steps * STEP : jitter),
      });
    const stand = (prefix: string, n: number, steps: number): DepotBusRow[] =>
      Array.from({ length: n }, (_, i) => at(`${prefix}${i}`, steps, i * 0.00002));
    return [...stand('A', 5, 2), at(pReg, 1), at('X', 0), at(qReg, -1), ...stand('N', 12, -2)];
  }

  it.each(['lat', 'lng'] as const)(
    'goes, on an exact tie along %s, to the place whose bus has the lowest registration',
    (axis) => {
      // P wins: not the larger place, and not the place found last.
      const pWins = tied(axis, 'C1', 'Z9');
      // Q wins: not the place holding the lowest registration overall (A0).
      const qWins = tied(axis, 'Z9', 'C1');
      expect(inferYardGroup(pWins)!.yard.inCluster).toBe(13);
      expect(membersOf(pWins)).not.toContain('X');
      expect(inferYardGroup(qWins)!.yard.inCluster).toBe(14);
      expect(membersOf(qWins)).toContain('X');
      for (const seed of [1, 2, 3, 4, 5]) {
        expect(inferYardGroup(seededShuffle(pWins, seed))).toEqual(inferYardGroup(pWins));
        expect(inferYardGroup(seededShuffle(qWins, seed))).toEqual(inferYardGroup(qWins));
      }
    },
  );

  it('never lets the bordering bus join the two places', () => {
    const rows = contested(200);
    expect(membersOf(rows)!.filter((reg) => reg.startsWith('S') || reg === 'Z-Q')).toEqual([]);
  });
});
