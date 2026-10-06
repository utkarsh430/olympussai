import type { DepotBusRow } from '@/models/depotLive';
import { fromMetres, toMetres } from '@/lib/depot/infer/geo';
import { locateBus } from '@/lib/depot/infer/location';
import type { Yard } from '@/lib/depot/infer/types';
import { inferYardGroup } from '@/lib/depot/infer/yard';

/** Layouts are drawn in metres east (x) and north (y) of this point. */
export const ORIGIN = { lat: 26.85, lng: 80.95 };

export interface XY {
  readonly x: number;
  readonly y: number;
}

export function row(over: Partial<DepotBusRow> & { registrationNumber: string }): DepotBusRow {
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

/** One parked bus at a point of the layout. */
export function busAt(reg: string, p: XY, over: Partial<DepotBusRow> = {}): DepotBusRow {
  const { lat, lng } = fromMetres(p, ORIGIN.lat, ORIGIN.lng);
  return row({ registrationNumber: reg, latitude: lat, longitude: lng, ...over });
}

/** n buses on a deterministic spiral reaching `spreadM` metres from `centre`. */
export function blob(
  prefix: string,
  n: number,
  centre: XY,
  spreadM = 20,
  over: Partial<DepotBusRow> = {},
): DepotBusRow[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = i * 2.4;
    const r = spreadM * ((i + 1) / n);
    const p = { x: centre.x + r * Math.cos(angle), y: centre.y + r * Math.sin(angle) };
    return busAt(`${prefix}${i}`, p, over);
  });
}

/** n buses in single file: the first at `start`, each next one `step` further on. */
export function file(prefix: string, n: number, start: XY, step: XY): DepotBusRow[] {
  return Array.from({ length: n }, (_, i) =>
    busAt(`${prefix}${i}`, { x: start.x + i * step.x, y: start.y + i * step.y }),
  );
}

/**
 * n buses parked in rows of `across`, `stepM` apart both ways, the first at `corner` and
 * the rows running north: a parking area whose edges are exactly where they are drawn.
 */
export function lot(
  prefix: string,
  n: number,
  corner: XY,
  across: number,
  stepM = 20,
): DepotBusRow[] {
  return Array.from({ length: n }, (_, i) =>
    busAt(`${prefix}${i}`, {
      x: corner.x + (i % across) * stepM,
      y: corner.y + Math.floor(i / across) * stepM,
    }),
  );
}

/** n buses each alone, kilometres from the layout and from each other: never a cluster. */
export function scattered(prefix: string, n: number): DepotBusRow[] {
  return file(prefix, n, { x: 20_000, y: 5_000 }, { x: 2_000, y: 700 });
}

/** A site `km` east of the layout. */
export const far = (km: number): XY => ({ x: km * 1000, y: 0 });

/** Every position moved by the same number of metres. */
export function shifted(rows: readonly DepotBusRow[], by: XY): DepotBusRow[] {
  const moved = fromMetres(by, ORIGIN.lat, ORIGIN.lng);
  const dLat = moved.lat - ORIGIN.lat;
  const dLng = moved.lng - ORIGIN.lng;
  return rows.map((r) => ({ ...r, latitude: r.latitude! + dLat, longitude: r.longitude! + dLng }));
}

/** The layout reflected through ORIGIN: east for west, north for south, or both. */
export function mirrored(
  rows: readonly DepotBusRow[],
  flip: { readonly ew: boolean; readonly ns: boolean },
): DepotBusRow[] {
  return rows.map((r) => ({
    ...r,
    latitude: flip.ns ? 2 * ORIGIN.lat - r.latitude! : r.latitude,
    longitude: flip.ew ? 2 * ORIGIN.lng - r.longitude! : r.longitude,
  }));
}

/** Where a yard's centre lies in the layout, in metres. */
export const centreOf = (yard: Yard): XY => toMetres(yard.lat, yard.lng, ORIGIN.lat, ORIGIN.lng);

/**
 * Registration numbers forming the yard, or null when none is claimed. Pass an
 * `adjacentM` of 0 for the rule without the merging of near groups.
 */
export function membersOf(
  rows: readonly DepotBusRow[],
  adjacentM?: number,
): readonly string[] | null {
  return inferYardGroup(rows, adjacentM)?.members ?? null;
}

/** Registration numbers that read `in_yard` against the yard, sorted. */
export function readingInYard(rows: readonly DepotBusRow[], yard: Yard): string[] {
  const yards = new Map([['1', yard]]);
  return rows
    .filter((r) => locateBus(r, yards).location === 'in_yard')
    .map((r) => r.registrationNumber)
    .sort();
}

export const regs = (rows: readonly DepotBusRow[]): string[] =>
  rows.map((r) => r.registrationNumber).sort();

/** Seeded uniform [0, 1) generator (mulberry32): reproducible, no Math.random. */
export function seededRandom(seed: number): () => number {
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
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const next = seededRandom(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
