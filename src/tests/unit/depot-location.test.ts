import { describe, it, expect } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import type { Yard } from '@/lib/depot/infer/types';
import { distanceM, fromMetres } from '@/lib/depot/infer/geo';
import { locateBus } from '@/lib/depot/infer/location';

const HOME = { lat: 26.85, lng: 80.95 };

function row(over: Partial<DepotBusRow> = {}): DepotBusRow {
  return {
    registrationNumber: 'UP32TEST',
    latitude: HOME.lat,
    longitude: HOME.lng,
    speedKmph: 0,
    ignitionOn: false,
    gpsTimestamp: null,
    receivedAt: null,
    depotId: '1',
    depotName: 'Home',
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

const yardAt = (lat: number, lng: number, radiusM = 200): Yard => ({
  lat,
  lng,
  radiusM,
  parked: 10,
  inCluster: 10,
});

const east = (metres: number) => fromMetres({ x: metres, y: 0 }, HOME.lat, HOME.lng);
const place = (p: { lat: number; lng: number }): Partial<DepotBusRow> => ({
  latitude: p.lat,
  longitude: p.lng,
});

describe('locateBus', () => {
  const homeYard = yardAt(HOME.lat, HOME.lng);

  it('is unknown with no position', () => {
    const result = locateBus(row({ latitude: null, longitude: null }), new Map([['1', homeYard]]));
    expect(result).toEqual({ location: 'unknown', otherDepotId: null, distanceFromYardKm: null });
  });

  it('is in_yard inside its own yard', () => {
    const result = locateBus(row(place(east(50))), new Map([['1', homeYard]]));
    expect(result.location).toBe('in_yard');
    expect(result.otherDepotId).toBeNull();
    expect(result.distanceFromYardKm).toBe(0.1);
  });

  it('counts a bus exactly on the radius as inside', () => {
    const p = east(150);
    const radiusM = distanceM(HOME.lat, HOME.lng, p.lat, p.lng);
    const result = locateBus(row(place(p)), new Map([['1', yardAt(HOME.lat, HOME.lng, radiusM)]]));
    expect(result.location).toBe('in_yard');
  });

  it('is away just outside the radius, with the distance to the home yard', () => {
    const p = east(5000);
    const result = locateBus(row(place(p)), new Map([['1', homeYard]]));
    expect(result).toEqual({ location: 'away', otherDepotId: null, distanceFromYardKm: 5 });
  });

  it('rounds the distance to one decimal', () => {
    const result = locateBus(row(place(east(5240))), new Map([['1', homeYard]]));
    expect(result.distanceFromYardKm).toBe(5.2);
  });

  it('is at_other_yard inside another depot yard', () => {
    const other = east(20000);
    const yards = new Map([
      ['1', homeYard],
      ['2', yardAt(other.lat, other.lng)],
    ]);
    const result = locateBus(row(place(other)), yards);
    expect(result.location).toBe('at_other_yard');
    expect(result.otherDepotId).toBe('2');
    expect(result.distanceFromYardKm).toBe(20);
  });

  it('resolves a shared yard to home for each depot', () => {
    const yards = new Map([
      ['1', homeYard],
      ['2', homeYard],
    ]);
    expect(locateBus(row({ depotId: '1' }), yards).location).toBe('in_yard');
    expect(locateBus(row({ depotId: '2' }), yards).location).toBe('in_yard');
    expect(locateBus(row({ depotId: '2' }), yards).otherDepotId).toBeNull();
  });

  it('picks the nearest centre when several other yards match', () => {
    const p = east(10000);
    const near = east(10050);
    const nearer = east(10010);
    const yards = new Map([
      ['1', homeYard],
      ['5', yardAt(near.lat, near.lng, 500)],
      ['3', yardAt(nearer.lat, nearer.lng, 500)],
    ]);
    expect(locateBus(row(place(p)), yards).otherDepotId).toBe('3');
  });

  it('breaks an exact tie between other yards by lowest depot id', () => {
    const p = east(10000);
    const yards = new Map([
      ['9', yardAt(p.lat, p.lng)],
      ['4', yardAt(p.lat, p.lng)],
    ]);
    expect(locateBus(row({ depotId: '1', ...place(p) }), yards).otherDepotId).toBe('4');
  });

  it('is unknown when the home yard is unknown and the bus is in no yard', () => {
    const result = locateBus(row(place(east(5000))), new Map());
    expect(result).toEqual({ location: 'unknown', otherDepotId: null, distanceFromYardKm: null });
  });

  it('is unknown for a bus with no home depot outside every yard', () => {
    const result = locateBus(row({ depotId: null, ...place(east(5000)) }), new Map([['1', homeYard]]));
    expect(result.location).toBe('unknown');
    expect(result.distanceFromYardKm).toBeNull();
  });

  it('is at_other_yard without a distance when the home yard is unknown', () => {
    const other = east(20000);
    const result = locateBus(row(place(other)), new Map([['2', yardAt(other.lat, other.lng)]]));
    expect(result).toEqual({
      location: 'at_other_yard',
      otherDepotId: '2',
      distanceFromYardKm: null,
    });
  });

  it('does not mutate the yards map or the row', () => {
    const yards = new Map([['1', homeYard]]);
    const input = Object.freeze(row());
    Object.freeze(homeYard);
    locateBus(input, yards);
    expect([...yards.keys()]).toEqual(['1']);
  });
});
