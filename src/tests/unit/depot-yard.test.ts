import { describe, it, expect } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { distanceM, fromMetres } from '@/lib/depot/infer/geo';
import { locateBus } from '@/lib/depot/infer/location';
import type { Yard } from '@/lib/depot/infer/types';
import {
  inferYard,
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

/** Deterministic Fisher-Yates using mulberry32. */
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const far = (km: number) => fromMetres({ x: km * 1000, y: 0 }, ORIGIN.lat, ORIGIN.lng);

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
      const rows = [...cellsAt('Y', [[0, 0]], 10), ...cellsAt('S', [[gap, 0]], 9)];
      expect(inferYard(rows)).toBeNull();
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
    const base = far(3);
    const stand = [0, 1, 2, 3].flatMap((j) =>
      at(`S${j}`, 7, fromMetres({ x: 150 * j, y: 0 }, base.lat, base.lng), 8),
    );
    expect(inferYard([...cellsAt('Y', [[0, 0]], 31), ...stand])).toBeNull();
  });

  it('accepts a line of ten cells but not eleven or twelve (a road, not a yard)', () => {
    const line = (n: number) => Array.from({ length: n }, (_, i) => [i - 5, 0] as const);
    expect(inferYard(cellsAt('R', line(10)))).not.toBeNull();
    expect(inferYard(cellsAt('R', line(11)))).toBeNull();
    expect(inferYard(cellsAt('R', line(12)))).toBeNull();
  });

  it('gives identical output for reversed and shuffled input in every scenario', () => {
    const scenarios = [
      cellRow(5),
      cellRow(6),
      cellsAt('L', [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]),
      cellsAt('D', [[0, 0], [1, 1]]),
      [...cellsAt('Y', [[0, 0]], 10), ...cellsAt('S', [[3, 0]], 9)],
      [...cellsAt('Y', [[0, 0]], 12), ...cellsAt('S', [[2, 0]], 6)],
      [...at('A', 6, ORIGIN), ...at('B', 7, far(30))],
      [...at('A', 6, ORIGIN), ...at('B', 12, far(30))],
    ];
    for (const rows of scenarios) {
      const baseline = inferYard(rows);
      expect(inferYard([...rows].reverse())).toEqual(baseline);
      expect(inferYard(seededShuffle(rows, 7))).toEqual(baseline);
      expect(inferYard(seededShuffle(rows, 1234))).toEqual(baseline);
    }
  });

  it('keeps the centre and radius of a tight single-cell cluster as the mean and p90 plus pad', () => {
    const rows = at('A', 10, ORIGIN, 30);
    const lat = rows.reduce((sum, r) => sum + r.latitude!, 0) / rows.length;
    const lng = rows.reduce((sum, r) => sum + r.longitude!, 0) / rows.length;
    const dists = rows.map((r) => distanceM(lat, lng, r.latitude!, r.longitude!)).sort((a, b) => a - b);
    const expectedRadius = Math.max(YARD_MIN_RADIUS_M, Math.round(dists[8]! + YARD_RADIUS_PAD_M));
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
