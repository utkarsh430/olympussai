import { describe, it, expect } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { distanceM, fromMetres } from '@/lib/depot/infer/geo';
import { locateBus } from '@/lib/depot/infer/location';
import type { Yard } from '@/lib/depot/infer/types';
import {
  inferYard,
  inferYardGroup,
  inferYards,
  YARD_MIN_RADIUS_M,
  YARD_CELL_M,
  YARD_RADIUS_PAD_M,
  YARD_MAX_SPAN_CELLS,
} from '@/lib/depot/infer/yard';

const ORIGIN = { lat: 26.85, lng: 80.95 };

function row(over: Partial<DepotBusRow> & { registrationNumber: string }): DepotBusRow {
  return {
    latitude: ORIGIN.lat,
    longitude: ORIGIN.lng,
    speedKmph: 0,
    ignitionOn: false,
    gpsTimestamp: null,
    receivedAt: null,
    depotId: '1',
    depotName: 'Test',
    vehicleStatus: 'stationary',
    tripStatus: null,
    routeId: null,
    routeName: null,
    routeDescription: null,
    journeyId: null,
    journeyCode: null,
    scheduledStart: null,
    scheduledEnd: null,
    actualStart: null,
    delayMinutes: null,
    odometerRaw: null,
    mainPowerOn: null,
    mainVoltage: null,
    tamperCode: null,
    emergency: null,
    ...over,
  };
}

/** n buses on a deterministic spiral reaching `spreadM` metres from a site. */
function at(
  prefix: string,
  n: number,
  site: { lat: number; lng: number },
  spreadM = 30,
  over: Partial<DepotBusRow> = {},
): DepotBusRow[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = i * 2.4;
    const r = spreadM * ((i + 1) / n);
    const p = fromMetres({ x: r * Math.cos(angle), y: r * Math.sin(angle) }, site.lat, site.lng);
    return row({ registrationNumber: `${prefix}${i}`, latitude: p.lat, longitude: p.lng, ...over });
  });
}

/** Centre of the middle cell of a row laid out by `cellRow`. */
const MID_CELL = fromMetres({ x: 75, y: 75 }, ORIGIN.lat, ORIGIN.lng);

/** n adjacent 150 m cells in a row, six buses each, groups mid-cell on the grid anchored at ORIGIN. */
function cellRow(n: number): DepotBusRow[] {
  const first = -Math.floor(n / 2);
  return Array.from({ length: n }, (_, k) => first + k).flatMap((j) =>
    at(`W${j}`, 6, fromMetres({ x: 75 + 150 * j, y: 75 }, ORIGIN.lat, ORIGIN.lng), 8),
  );
}

/** Six buses (by default) at the centre of each listed grid cell, on the grid anchored at ORIGIN. */
function cellsAt(
  prefix: string,
  cells: readonly (readonly [number, number])[],
  perCell = 6,
): DepotBusRow[] {
  return cells.flatMap(([cx, cy]) =>
    at(`${prefix}${cx}_${cy}`, perCell, fromMetres({ x: 75 + 150 * cx, y: 75 + 150 * cy }, ORIGIN.lat, ORIGIN.lng), 8),
  );
}

function countInYard(rows: readonly DepotBusRow[], yard: Yard): number {
  const yards = new Map([['1', yard]]);
  return rows.filter((r) => locateBus(r, yards).location === 'in_yard').length;
}

/** Seeded uniform [0, 1) generator (mulberry32): reproducible, no Math.random. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher-Yates. */
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const next = seededRandom(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const far = (km: number) => fromMetres({ x: km * 1000, y: 0 }, ORIGIN.lat, ORIGIN.lng);

function meanPosition(rows: readonly DepotBusRow[]): { lat: number; lng: number } {
  return {
    lat: rows.reduce((sum, r) => sum + r.latitude!, 0) / rows.length,
    lng: rows.reduce((sum, r) => sum + r.longitude!, 0) / rows.length,
  };
}

/** A 12-bus yard in cell 0 and a 6-bus stand in cell `standCell`, `perCell` buses in each cell between. */
function chained(standCell: number, perCell: number) {
  const yardRows = cellsAt('Y', [[0, 0]], 12);
  const standRows = cellsAt('S', [[standCell, 0]], 6);
  const between = Array.from({ length: standCell - 1 }, (_, i) => [i + 1, 0] as const);
  const chainRows = cellsAt('C', between, perCell);
  return { yardRows, standRows, chainRows, all: [...yardRows, ...chainRows, ...standRows] };
}

/** Two 6-bus cells and one bus in the far corner of the next cell. */
function edgeLeaf() {
  const yardRows = cellsAt('Y', [[0, 0], [1, 0]], 6);
  const p = fromMetres({ x: 440, y: 140 }, ORIGIN.lat, ORIGIN.lng);
  const leaf = row({ registrationNumber: 'E', latitude: p.lat, longitude: p.lng });
  return { yardRows, leaf, all: [...yardRows, leaf] };
}

/**
 * Stand A (8 buses in cell 0, plus single-bus cells `aLeaves`) and stand B (`bSize` buses
 * in cell 2), with one bus in cell 1 touching both.
 */
function contested(bSize: number, aLeaves: readonly (readonly [number, number])[]) {
  const aRows = [...cellsAt('A', [[0, 0]], 8), ...cellsAt('L', aLeaves, 1)];
  const bRows = cellsAt('B', [[2, 0]], bSize);
  const [between] = cellsAt('X', [[1, 0]], 1);
  return { aRows, bRows, between: between!, all: [...aRows, between!, ...bRows] };
}

const A_FAR_SIDE = [[-1, -1], [-1, 0], [-1, 1], [0, 1], [0, -1]] as const;

/** Every cell of a 4 x 3 block holds exactly one bus. */
const oneBusPerCell = (): DepotBusRow[] =>
  cellsAt('U', Array.from({ length: 12 }, (_, i) => [i % 4, Math.floor(i / 4)] as const), 1);

const tenAgainstNine = (gap: number): DepotBusRow[] => [
  ...cellsAt('Y', [[0, 0]], 10),
  ...cellsAt('S', [[gap, 0]], 9),
];

function thirtyOneAgainstTwentyEight(): DepotBusRow[] {
  const base = far(3);
  const stand = [0, 1, 2, 3].flatMap((j) =>
    at(`S${j}`, 7, fromMetres({ x: 150 * j, y: 0 }, base.lat, base.lng), 8),
  );
  return [...cellsAt('Y', [[0, 0]], 31), ...stand];
}

const lineOf = (n: number): DepotBusRow[] =>
  cellsAt('R', Array.from({ length: n }, (_, i) => [i - 5, 0] as const));

type Shape = 'compact' | 'long' | 'L' | 'sparse';
const SHAPES: readonly Shape[] = ['compact', 'long', 'L', 'sparse'];
const TRIALS_PER_SHAPE = 60;

/** Bus positions in metres for one random yard of the given shape. */
function shapePoints(shape: Shape, between: (lo: number, hi: number) => number) {
  const scatter = (n: number, place: () => { x: number; y: number }) =>
    Array.from({ length: Math.floor(n) }, place);
  if (shape === 'compact') {
    const side = between(60, 400);
    return scatter(between(8, 40), () => ({ x: between(0, side), y: between(0, side) }));
  }
  if (shape === 'long') {
    const [length, width, angle] = [between(500, 1400), between(15, 80), between(0, Math.PI)];
    return scatter(between(15, 50), () => {
      const [u, v] = [between(0, length), between(0, width)];
      return { x: u * Math.cos(angle) - v * Math.sin(angle), y: u * Math.sin(angle) + v * Math.cos(angle) };
    });
  }
  if (shape === 'L') {
    const [a, b, w] = [between(300, 900), between(300, 900), between(30, 90)];
    return scatter(between(16, 50), () =>
      between(0, a + b) < a ? { x: between(0, a), y: between(0, w) } : { x: between(0, w), y: between(0, b) },
    );
  }
  const side = between(300, 700);
  return scatter(between(8, 24), () => ({ x: between(0, side), y: between(0, side) }));
}

function randomYard(shape: Shape, seed: number): DepotBusRow[] {
  const next = seededRandom(seed);
  const between = (lo: number, hi: number): number => lo + next() * (hi - lo);
  const offset = { x: between(-150, 150), y: between(-150, 150) };
  return shapePoints(shape, between).map((p, i) => {
    const q = fromMetres({ x: offset.x + p.x, y: offset.y + p.y }, ORIGIN.lat, ORIGIN.lng);
    return row({ registrationNumber: `P${i}`, latitude: q.lat, longitude: q.lng });
  });
}

describe('inferYard', () => {
  it('finds a tight cluster of 10 within 20 m of the true centre', () => {
    const yard = inferYard(at('A', 10, ORIGIN));
    expect(yard).not.toBeNull();
    expect(distanceM(yard!.lat, yard!.lng, ORIGIN.lat, ORIGIN.lng)).toBeLessThan(20);
    expect(yard!.parked).toBe(10);
    expect(yard!.inCluster).toBe(10);
  });

  it('claims no yard from three parked buses', () => {
    expect(inferYard(at('A', 3, ORIGIN))).toBeNull();
  });

  it('claims no yard when buses are spread across three stands', () => {
    const rows = [...at('A', 6, ORIGIN), ...at('B', 6, far(30)), ...at('C', 6, far(60))];
    expect(inferYard(rows)).toBeNull();
  });

  it('claims no yard for two equal stands 30 km apart, and never a midpoint', () => {
    expect(inferYard([...at('A', 6, ORIGIN), ...at('B', 6, far(30))])).toBeNull();
  });

  it('claims no yard for two stands too thin to cluster (5 + 5)', () => {
    expect(inferYard([...at('A', 5, ORIGIN), ...at('B', 5, far(30))])).toBeNull();
  });

  it('claims no yard for two stands 30 km apart at 7 and 6 (below the dominance ratio)', () => {
    expect(inferYard([...at('A', 6, ORIGIN), ...at('B', 7, far(30))])).toBeNull();
  });

  it('takes the denser of two stands when it holds twice the rival (12 vs 6)', () => {
    const yard = inferYard([...at('A', 6, ORIGIN), ...at('B', 12, far(30))]);
    expect(yard).not.toBeNull();
    expect(distanceM(yard!.lat, yard!.lng, far(30).lat, far(30).lng)).toBeLessThan(30);
    expect(yard!.inCluster).toBe(12);
    expect(yard!.parked).toBe(18);
  });

  it('claims no yard when a 7-bus cell is matched by a 6-bus cell whose neighbour levels its block', () => {
    const b = far(30);
    const lone = fromMetres({ x: 120, y: 0 }, b.lat, b.lng);
    const rows = [
      ...at('A', 7, ORIGIN, 5),
      ...at('B', 6, b, 5),
      row({ registrationNumber: 'L', latitude: lone.lat, longitude: lone.lng }),
    ];
    expect(inferYard(rows)).toBeNull();
  });

  it('infers one wide yard from five adjacent cells, centred, with every bus in it', () => {
    const rows = cellRow(5);
    const yard = inferYard(rows);
    expect(yard).not.toBeNull();
    expect(distanceM(yard!.lat, yard!.lng, MID_CELL.lat, MID_CELL.lng)).toBeLessThan(30);
    expect(yard!.parked).toBe(30);
    expect(yard!.inCluster).toBe(30);
    expect(countInYard(rows, yard!)).toBe(30);
  });

  it('infers a yard from six adjacent cells, centred, with every bus in it', () => {
    const rows = cellRow(6);
    const yard = inferYard(rows)!;
    expect(yard).not.toBeNull();
    const trueMiddle = fromMetres({ x: 0, y: 75 }, ORIGIN.lat, ORIGIN.lng);
    expect(distanceM(yard.lat, yard.lng, trueMiddle.lat, trueMiddle.lng)).toBeLessThan(30);
    expect(yard.inCluster).toBe(36);
    expect(countInYard(rows, yard)).toBe(36);
  });

  it('holds an L-shaped yard of five cells whole', () => {
    const rows = cellsAt('L', [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]);
    const yard = inferYard(rows)!;
    expect(yard.inCluster).toBe(30);
    expect(countInYard(rows, yard)).toBe(30);
  });

  it('treats stands in diagonally touching cells as one yard', () => {
    const yard = inferYard(cellsAt('D', [[0, 0], [1, 1]]));
    expect(yard?.inCluster).toBe(12);
  });

  it.each([2, 3, 4])(
    'claims no yard for 10 and 9 buses with a stand %i cells away (ratio below 1.5)',
    (gap) => {
      expect(inferYard(tenAgainstNine(gap))).toBeNull();
    },
  );

  it('keeps a 12-bus yard when a 6-bus stand is one empty cell away, without its buses', () => {
    const yardRows = cellsAt('Y', [[0, 0]], 12);
    const standRows = cellsAt('S', [[2, 0]], 6);
    const yard = inferYard([...yardRows, ...standRows])!;
    expect(yard).not.toBeNull();
    expect(yard.inCluster).toBe(12);
    expect(countInYard(yardRows, yard)).toBe(12);
    expect(countInYard(standRows, yard)).toBe(0);
  });

  it('claims no yard for a 31-bus yard against a 28-bus wide stand 3 km away', () => {
    expect(inferYard(thirtyOneAgainstTwentyEight())).toBeNull();
  });

  it('accepts a line of ten cells but not eleven or twelve (a road, not a yard)', () => {
    expect(inferYard(lineOf(10))).not.toBeNull();
    expect(inferYard(lineOf(11))).toBeNull();
    expect(inferYard(lineOf(12))).toBeNull();
  });

  it.each([4, 6, 8])(
    'does not let a chain of single buses join a 12-bus yard to a stand %i cells away',
    (standCell) => {
      const { yardRows, standRows, chainRows, all } = chained(standCell, 1);
      const yard = inferYard(all)!;
      expect(yard).not.toBeNull();
      expect([12, 13]).toContain(yard.inCluster);
      expect(countInYard(standRows, yard)).toBe(0);
      expect(countInYard(yardRows, yard)).toBe(12);
      const mean = meanPosition(yardRows);
      expect(distanceM(yard.lat, yard.lng, mean.lat, mean.lng)).toBeLessThan(60);
      const { members } = inferYardGroup(all)!;
      const chainMembers = members.filter((m) => chainRows.some((r) => r.registrationNumber === m));
      expect(chainMembers.length).toBe(yard.inCluster - 12);
      expect(members.filter((m) => m.startsWith('S'))).toEqual([]);
    },
  );

  it.each([4, 6, 8])(
    'treats a chain of two-bus cells to a stand %i cells away as one continuous place',
    (standCell) => {
      const { all } = chained(standCell, 2);
      const yard = inferYard(all)!;
      expect(yard).not.toBeNull();
      expect(yard.inCluster).toBe(all.length);
      expect(countInYard(all, yard)).toBe(all.length);
    },
  );

  it('claims no yard when a two-bus chain stretches the group past the span limit', () => {
    expect(inferYard(chained(YARD_MAX_SPAN_CELLS + 1, 2).all)).toBeNull();
  });

  it('keeps a single bus on the edge of a dense yard in the yard', () => {
    const { leaf, all } = edgeLeaf();
    const yard = inferYard(all)!;
    expect(yard.inCluster).toBe(13);
    expect(countInYard(all, yard)).toBe(13);
    expect(inferYardGroup(all)!.members).toContain(leaf.registrationNumber);
  });

  it('gives a single bus touching two stands to the larger', () => {
    const { bRows, between, all } = contested(12, []);
    const yard = inferYard(all)!;
    expect(yard).not.toBeNull();
    expect(yard.inCluster).toBe(13);
    const mean = meanPosition(bRows);
    expect(distanceM(yard.lat, yard.lng, mean.lat, mean.lng)).toBeLessThan(30);
    expect(inferYardGroup(all)!.members).toContain(between.registrationNumber);
  });

  it('gives a single bus touching two equal stands to the lower-keyed one', () => {
    const { aRows, bRows, between, all } = contested(8, A_FAR_SIDE);
    const yard = inferYard(all)!;
    expect(yard).not.toBeNull();
    expect(yard.inCluster).toBe(aRows.length + 1);
    expect(countInYard(bRows, yard)).toBe(0);
    expect(inferYardGroup(all)!.members).toContain(between.registrationNumber);
  });

  it('claims no yard when every cell holds exactly one bus', () => {
    expect(inferYard(oneBusPerCell())).toBeNull();
  });

  it('holds every member of the group within the radius across seeded random yards', () => {
    const found = SHAPES.flatMap((shape, s) =>
      Array.from({ length: TRIALS_PER_SHAPE }, (_, trial) => {
        const rows = randomYard(shape, 1000 * s + trial);
        return { shape, rows, yard: inferYard(rows) };
      }),
    ).filter((t): t is { shape: Shape; rows: DepotBusRow[]; yard: Yard } => t.yard !== null);
    for (const shape of SHAPES) {
      expect(found.filter((t) => t.shape === shape).length).toBeGreaterThanOrEqual(10);
    }
    const shortfall = found.filter((t) => countInYard(t.rows, t.yard) < t.yard.inCluster).length;
    expect(shortfall).toBe(0);
    for (const { rows, yard } of found) {
      const { members } = inferYardGroup(rows)!;
      expect(members).toHaveLength(yard.inCluster);
      const yards = new Map([['1', yard]]);
      for (const r of rows.filter((x) => members.includes(x.registrationNumber))) {
        expect(distanceM(yard.lat, yard.lng, r.latitude!, r.longitude!)).toBeLessThanOrEqual(yard.radiusM);
        expect(locateBus(r, yards).location).toBe('in_yard');
      }
    }
  });

  it('gives identical output for reversed and shuffled input in every scenario', () => {
    const scenarios = [
      cellRow(5),
      cellRow(6),
      cellsAt('L', [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]),
      cellsAt('D', [[0, 0], [1, 1]]),
      tenAgainstNine(2),
      tenAgainstNine(3),
      tenAgainstNine(4),
      [...cellsAt('Y', [[0, 0]], 12), ...cellsAt('S', [[2, 0]], 6)],
      thirtyOneAgainstTwentyEight(),
      lineOf(10),
      lineOf(12),
      at('A', 3, ORIGIN),
      at('A', 10, ORIGIN, 30),
      [...at('A', 6, ORIGIN), ...at('B', 7, far(30))],
      [...at('A', 6, ORIGIN), ...at('B', 12, far(30))],
      ...[4, 6, 8].flatMap((cell) => [chained(cell, 1).all, chained(cell, 2).all]),
      chained(YARD_MAX_SPAN_CELLS + 1, 2).all,
      edgeLeaf().all,
      contested(12, []).all,
      contested(8, A_FAR_SIDE).all,
      oneBusPerCell(),
    ];
    for (const rows of scenarios) {
      const baseline = inferYardGroup(rows);
      expect(inferYardGroup([...rows].reverse())).toEqual(baseline);
      expect(inferYardGroup(seededShuffle(rows, 7))).toEqual(baseline);
      expect(inferYardGroup(seededShuffle(rows, 1234))).toEqual(baseline);
    }
  });

  it('keeps the centre and radius of a tight cluster as the mean and farthest bus plus pad', () => {
    const rows = at('A', 10, ORIGIN, 30);
    const { lat, lng } = meanPosition(rows);
    const farthest = Math.max(...rows.map((r) => distanceM(lat, lng, r.latitude!, r.longitude!)));
    const expectedRadius = Math.max(YARD_MIN_RADIUS_M, Math.round(farthest + YARD_RADIUS_PAD_M));
    const yard = inferYard(rows)!;
    expect(distanceM(yard.lat, yard.lng, lat, lng)).toBeLessThan(3);
    expect(Math.abs(yard.radiusM - expectedRadius)).toBeLessThanOrEqual(3);
  });

  it('rejects a cluster holding under half the candidates', () => {
    const rows = [...at('A', 6, ORIGIN), ...at('B', 5, far(10)), ...at('C', 4, far(20))];
    expect(inferYard(rows)).toBeNull();
  });

  it('ignores moving buses', () => {
    const rows = [...at('A', 6, ORIGIN), ...at('M', 20, far(5), 30, { speedKmph: 40 })];
    const yard = inferYard(rows);
    expect(yard?.parked).toBe(6);
    expect(distanceM(yard!.lat, yard!.lng, ORIGIN.lat, ORIGIN.lng)).toBeLessThan(40);
  });

  it('counts a bus at exactly the moving threshold as parked, one above as moving', () => {
    expect(inferYard(at('A', 6, ORIGIN, 30, { speedKmph: 3 }))?.parked).toBe(6);
    expect(inferYard(at('A', 6, ORIGIN, 30, { speedKmph: 3.1 }))).toBeNull();
  });

  it('ignores rows without a position, with unknown speed, or at (0, 0)', () => {
    const rows = [
      ...at('A', 6, ORIGIN),
      ...at('N', 10, ORIGIN, 30, { latitude: null, longitude: null }),
      ...at('S', 10, ORIGIN, 30, { speedKmph: null }),
      ...at('Z', 10, ORIGIN, 30, { latitude: 0, longitude: 0 }),
    ];
    expect(inferYard(rows)?.parked).toBe(6);
  });

  it('counts dark buses as parked evidence', () => {
    const rows = at('D', 8, ORIGIN, 30, { vehicleStatus: 'no_signal', ignitionOn: null });
    expect(inferYard(rows)?.inCluster).toBe(8);
  });

  it('clamps the radius to the minimum for a very tight cluster', () => {
    expect(inferYard(at('A', 10, ORIGIN, 2))!.radiusM).toBe(YARD_MIN_RADIUS_M);
  });

  it('sizes a wide cluster from its spread, within what the span limit allows', () => {
    const blockDiagonalM = YARD_MAX_SPAN_CELLS * Math.SQRT2 * YARD_CELL_M;
    const yard = inferYard(at('A', 40, ORIGIN, 220));
    expect(yard).not.toBeNull();
    expect(yard!.radiusM).toBeGreaterThan(YARD_MIN_RADIUS_M);
    expect(yard!.radiusM).toBeLessThanOrEqual(blockDiagonalM + YARD_RADIUS_PAD_M);
  });

  it('is deterministic on shuffled input', () => {
    const rows = [...at('A', 9, ORIGIN), ...at('B', 4, far(3)), ...at('C', 3, far(7))];
    const baseline = inferYard(rows);
    expect(baseline).not.toBeNull();
    const reversed = [...rows].reverse();
    const rotated = [...rows.slice(5), ...rows.slice(0, 5)];
    const interleaved = [...rows.filter((_, i) => i % 2 === 0), ...rows.filter((_, i) => i % 2 === 1)];
    expect(inferYard(reversed)).toEqual(baseline);
    expect(inferYard(rotated)).toEqual(baseline);
    expect(inferYard(interleaved)).toEqual(baseline);
  });

  it('returns null for empty input', () => {
    expect(inferYard([])).toBeNull();
  });

  it('does not mutate its input', () => {
    const rows = at('A', 8, ORIGIN);
    const snapshot = JSON.stringify(rows);
    rows.forEach((r) => Object.freeze(r));
    Object.freeze(rows);
    inferYard(rows);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});

describe('inferYards', () => {
  it('groups by depot id, skips null depotId, omits depots without a confident yard', () => {
    const rows = [
      ...at('A', 8, ORIGIN, 30, { depotId: '1' }),
      ...at('B', 8, far(20), 30, { depotId: '2' }),
      ...at('C', 2, far(40), 30, { depotId: '3' }),
      ...at('U', 12, far(60), 30, { depotId: null }),
    ];
    const yards = inferYards(rows);
    expect([...yards.keys()].sort()).toEqual(['1', '2']);
    const two = yards.get('2')!;
    expect(distanceM(two.lat, two.lng, far(20).lat, far(20).lng)).toBeLessThan(20);
  });

  it('gives two depots sharing one yard the same yard each', () => {
    const rows = [
      ...at('A', 8, ORIGIN, 30, { depotId: '1' }),
      ...at('B', 8, ORIGIN, 30, { depotId: '2' }),
    ];
    const yards = inferYards(rows);
    expect(yards.size).toBe(2);
    const [a, b] = [yards.get('1')!, yards.get('2')!];
    expect(distanceM(a.lat, a.lng, b.lat, b.lng)).toBeLessThan(20);
  });
});
