import { describe, it, expect } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import type { LocatedBus, Yard } from '@/lib/depot/infer/types';
import { distanceM, hasUsablePosition } from '@/lib/depot/infer/geo';
import { locateBus } from '@/lib/depot/infer/location';

const UNKNOWN: LocatedBus = { location: 'unknown', otherDepotId: null, distanceFromYardKm: null };

/** The implementation before the sorted ids were cached, copied verbatim as the reference. */
function referenceLocateBus(row: DepotBusRow, yards: ReadonlyMap<string, Yard>): LocatedBus {
  if (!hasUsablePosition(row)) return UNKNOWN;
  const { latitude, longitude } = row;
  const oneDecimalKm = (metres: number): number => Math.round((metres / 1000) * 10) / 10;

  const homeYard = row.depotId === null ? undefined : yards.get(row.depotId);
  const homeMetres = homeYard ? distanceM(latitude, longitude, homeYard.lat, homeYard.lng) : null;
  const distanceFromYardKm = homeMetres === null ? null : oneDecimalKm(homeMetres);

  if (homeYard && homeMetres !== null && homeMetres <= homeYard.radiusM) {
    return { location: 'in_yard', otherDepotId: null, distanceFromYardKm };
  }

  let nearest: { readonly id: string; readonly metres: number } | null = null;
  for (const id of [...yards.keys()].sort()) {
    if (id === row.depotId) continue;
    const yard = yards.get(id);
    if (!yard) continue;
    const metres = distanceM(latitude, longitude, yard.lat, yard.lng);
    if (metres > yard.radiusM) continue;
    if (nearest === null || metres < nearest.metres) nearest = { id, metres };
  }
  if (nearest) {
    return { location: 'at_other_yard', otherDepotId: nearest.id, distanceFromYardKm };
  }

  if (homeYard) return { location: 'away', otherDepotId: null, distanceFromYardKm };
  return UNKNOWN;
}

/** Small seeded generator so a failure reproduces. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE = { lat: 26.85, lng: 80.95 };
const SPREAD_DEG = 0.02;

function bus(depotId: string | null, lat: number, lng: number): DepotBusRow {
  return {
    registrationNumber: 'UP32TEST',
    latitude: lat,
    longitude: lng,
    speedKmph: 0,
    ignitionOn: false,
    gpsTimestamp: null,
    receivedAt: null,
    depotId,
    depotName: null,
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
  };
}

/** Yards whose insertion order differs from sorted order, several sharing one centre (ties). */
function randomYards(random: () => number, count: number): Map<string, Yard> {
  const yards = new Map<string, Yard>();
  const centres: { lat: number; lng: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = String(Math.floor(random() * 200));
    const shared = centres.length > 0 && random() < 0.4;
    const reused = shared ? centres[Math.floor(random() * centres.length)] : undefined;
    const centre = reused ?? {
      lat: BASE.lat + random() * SPREAD_DEG,
      lng: BASE.lng + random() * SPREAD_DEG,
    };
    centres.push(centre);
    yards.set(id, { ...centre, radiusM: 300 + random() * 1500, parked: 5, inCluster: 5 });
  }
  return yards;
}

function randomBuses(random: () => number, yards: ReadonlyMap<string, Yard>): DepotBusRow[] {
  const ids = [...yards.keys()];
  const pick = (): string => ids[Math.floor(random() * ids.length)] ?? '';
  return Array.from({ length: 150 }, () => {
    const roll = random();
    const depotId = roll < 0.1 ? null : roll < 0.9 ? pick() : '999';
    // Some buses sit exactly on a yard centre so distances tie.
    const yard = random() < 0.3 ? yards.get(pick()) : undefined;
    const lat = yard ? yard.lat : BASE.lat + random() * SPREAD_DEG;
    const lng = yard ? yard.lng : BASE.lng + random() * SPREAD_DEG;
    return bus(depotId, lat, lng);
  });
}

const SHARED: Yard = { lat: BASE.lat, lng: BASE.lng, radiusM: 500, parked: 5, inCluster: 5 };

describe('locateBus sorted-id cache', () => {
  it('matches the uncached reference over seeded random buses and yards with ties', () => {
    const random = mulberry32(20261006);
    for (let round = 0; round < 25; round += 1) {
      const yards = randomYards(random, 2 + Math.floor(random() * 12));
      for (const row of randomBuses(random, yards)) {
        expect(locateBus(row, yards)).toEqual(referenceLocateBus(row, yards));
      }
    }
  });

  it('breaks an equal-distance tie by the first id in sort order, whatever insertion order', () => {
    const yards = new Map<string, Yard>([
      ['9', SHARED],
      ['10', SHARED],
      ['2', SHARED],
    ]);
    const row = bus('1', BASE.lat, BASE.lng);
    expect(locateBus(row, yards).otherDepotId).toBe('10');
    expect(locateBus(row, yards)).toEqual(referenceLocateBus(row, yards));
  });

  it('gives fresh results for a new map after an earlier one was cached', () => {
    const first = new Map<string, Yard>([['5', SHARED]]);
    const row = bus('1', BASE.lat, BASE.lng);
    expect(locateBus(row, first).otherDepotId).toBe('5');

    const second = new Map<string, Yard>([
      ['3', SHARED],
      ['5', SHARED],
    ]);
    expect(locateBus(row, second).otherDepotId).toBe('3');
    // The first map is unchanged and still answers as before.
    expect(locateBus(row, first).otherDepotId).toBe('5');
    const empty = new Map<string, Yard>();
    expect(locateBus(row, empty)).toEqual(referenceLocateBus(row, empty));
  });
});
