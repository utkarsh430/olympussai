// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { fromMetres } from '@/lib/depot/infer/geo';
import { summariseDepots } from '@/lib/depot/live/aggregate';
import {
  PEAK_REQUIREMENT_MAX_DEPOTS,
  createPeakRequirementStore,
  holdPeakRequirements,
  resetPeakRequirementStore,
} from '@/lib/depot/live/peakRequirementHold';
import type { DepotBalance } from '@/lib/depot/optimise/types';
import { DEFAULT_REQUIREMENT_PARAMS } from '@/lib/depot/sim/config';
import { modelBalances, spareTargetFor } from '@/lib/depot/sim/requirement';

/*
 * A depot's peak requirement does not fall during an operating date: each
 * snapshot's computed peak is floored by the highest peak computed for the
 * depot earlier in the date, and that floor is capped at what is available now,
 * so a real loss of buses still shows. The spare target, the requirement and
 * the balance are read from the floored peak.
 */

const DATE = '2026-10-07';
const NEXT = '2026-10-08';
const FEED = `${DATE}T09:00:00Z`;
const HOME = { lat: 26.85, lng: 80.95 };

function row(depotId: string, i: number, kind: 'out' | 'in' | 'off'): DepotBusRow {
  const out = kind === 'out';
  const p = fromMetres({ x: out ? 8_000 + i * 50 : 0, y: Number(depotId) * 30_000 }, HOME.lat, HOME.lng);
  return {
    registrationNumber: `D${depotId}B${i}`,
    latitude: p.lat,
    longitude: p.lng,
    speedKmph: out ? 30 : 0,
    ignitionOn: out,
    gpsTimestamp: FEED,
    receivedAt: FEED,
    depotId,
    depotName: `Depot ${depotId}`,
    vehicleStatus: kind === 'off' ? 'under_maintenance' : out ? 'live' : 'stationary',
    tripStatus: out ? 'Running' : 'Stationary',
    routeId: null,
    routeName: `ORD_${depotId}_${i % 3}`,
    routeDescription: null,
    journeyId: null,
    journeyCode: null,
    scheduledStart: null,
    scheduledEnd: null,
    actualStart: null,
    delayMinutes: null,
    odometerRaw: null,
    mainPowerOn: true,
    mainVoltage: null,
    tamperCode: 'C',
    emergency: false,
  };
}

function rowsOf(id: string, fleet: number, out: number, off = 0): DepotBusRow[] {
  return Array.from({ length: fleet }, (_, i) =>
    row(id, i, i < out ? 'out' : i >= fleet - off ? 'off' : 'in'),
  );
}

const depots = summariseDepots(
  [...rowsOf('1', 72, 60, 6), ...rowsOf('2', 40, 30), ...rowsOf('3', 40, 25)],
  FEED,
);
const NO_YARDS = new Map();
const RATIO = DEFAULT_REQUIREMENT_PARAMS.spareRatio;

function balances(floors?: ReadonlyMap<string, number>): DepotBalance[] {
  return modelBalances(depots, NO_YARDS, DATE, DEFAULT_REQUIREMENT_PARAMS, undefined, floors);
}

const one = (list: readonly DepotBalance[], id = '1'): DepotBalance => {
  const found = list.find((b) => b.depotId === id);
  if (!found) throw new Error(`no balance for depot ${id}`);
  return found;
};

function expectConsistent(b: DepotBalance): void {
  expect(b.available).toBe(b.fleet - b.offRoad);
  expect(b.spareTarget).toBe(spareTargetFor(b.peakRequirement, RATIO));
  expect(b.required).toBe(b.peakRequirement + b.spareTarget);
  expect(b.balance).toBe(b.available - b.required);
}

describe('the peak requirement floored by its highest earlier in the date', () => {
  const plain = one(balances());

  it('is unchanged with no floors, or with a floor below the computed peak', () => {
    expect(balances(new Map())).toEqual(balances());
    expect(one(balances(new Map([['1', plain.peakRequirement - 3]])))).toEqual(plain);
  });

  it('lifts the peak to a higher floor and reads spare, requirement and balance from it', () => {
    const floor = plain.peakRequirement + 2;
    expect(floor).toBeLessThanOrEqual(plain.available);
    const held = one(balances(new Map([['1', floor]])));
    expect(held.peakRequirement).toBe(floor);
    expectConsistent(held);
    expect(held.available).toBe(plain.available);
  });

  it('caps the floor at what is available now, so a real loss still shows', () => {
    const held = one(balances(new Map([['1', plain.available + 25]])));
    expect(held.peakRequirement).toBe(plain.available);
    expectConsistent(held);
  });

  it('touches only the depot the floor names, and ignores a floor that is not finite', () => {
    const list = balances(new Map([['1', plain.peakRequirement + 2], ['2', Number.NaN]]));
    expect(one(list, '2')).toEqual(one(balances(), '2'));
    expect(one(list, '3')).toEqual(one(balances(), '3'));
  });
});

describe('the held peak requirements', () => {
  it('keeps the larger peak within one operating date', () => {
    const store = createPeakRequirementStore();
    expect(holdPeakRequirements(store, new Map([['1', 166], ['2', 40]]), DATE)).toEqual(
      new Map([['1', 166], ['2', 40]]),
    );
    expect(holdPeakRequirements(store, new Map([['1', 165], ['2', 41]]), DATE)).toEqual(
      new Map([['1', 166], ['2', 41]]),
    );
  });

  it('starts afresh on a later date and is neither read nor written for an earlier one', () => {
    const store = createPeakRequirementStore();
    holdPeakRequirements(store, new Map([['1', 166]]), DATE);
    expect(holdPeakRequirements(store, new Map([['1', 120]]), NEXT)).toEqual(new Map([['1', 120]]));
    expect(holdPeakRequirements(store, new Map([['1', 90]]), DATE)).toEqual(new Map([['1', 90]]));
    expect(holdPeakRequirements(store, new Map([['1', 80]]), null)).toEqual(new Map([['1', 80]]));
    expect(store.operatingDate).toBe(NEXT);
    expect(store.maxima).toEqual(new Map([['1', 120]]));
  });

  it('holds no more than the depot bound and empties on reset', () => {
    const store = createPeakRequirementStore();
    const many = new Map(
      Array.from({ length: PEAK_REQUIREMENT_MAX_DEPOTS + 5 }, (_, i) => [String(i), 10] as const),
    );
    holdPeakRequirements(store, many, DATE);
    expect(store.maxima.size).toBe(PEAK_REQUIREMENT_MAX_DEPOTS);
    resetPeakRequirementStore(store);
    expect(store.operatingDate).toBeNull();
    expect(store.maxima.size).toBe(0);
  });
});
