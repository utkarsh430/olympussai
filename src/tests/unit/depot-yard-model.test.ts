import { describe, expect, it } from 'vitest';
import type { DepotBusView, DepotDetailResponse, VisitorBus } from '@/lib/depot/api';
import type { BusLocation, Yard } from '@/lib/depot/infer/types';
import type { BusOpState } from '@/lib/depot/types';
import {
  AWAY_LIST_CAP,
  DISPLAY_RADIUS_FACTOR,
  YARD_STATE_ORDER,
  buildYardModel,
} from '@/lib/depot/yard/yardModel';

const YARD: Yard = { lat: 18.5, lng: 73.8, radiusM: 200, parked: 44, inCluster: 38 };
/** About 111 km per degree of latitude. */
const M_PER_DEG_LAT = 111_195;

function bus(
  reg: string,
  state: BusOpState,
  location: BusLocation,
  over: Partial<DepotBusView> = {},
): DepotBusView {
  return {
    registrationNumber: reg,
    state,
    location,
    otherDepotId: null,
    distanceFromYardKm: null,
    latitude: YARD.lat,
    longitude: YARD.lng,
    speedKmph: 0,
    gpsAgeMin: 3,
    ...over,
  } as DepotBusView;
}

function response(
  buses: readonly DepotBusView[],
  yard: Yard | null = YARD,
  visitors: readonly VisitorBus[] = [],
): DepotDetailResponse {
  return {
    feedNow: null,
    fetchedAt: '2026-10-06T00:00:00Z',
    source: 'live',
    stale: false,
    yard: {
      value: yard,
      provenance: 'derived',
      ...(yard ? { coverage: { n: yard.inCluster, of: yard.parked } } : {}),
    },
    buses,
    visitors,
  } as unknown as DepotDetailResponse;
}

const SAMPLE = response(
  [
    bus('B1', 'standing', 'in_yard'),
    bus('B2', 'in_service', 'in_yard'),
    bus('B3', 'standing', 'in_yard'),
    bus('A1', 'in_service', 'away', { distanceFromYardKm: 12.5, latitude: YARD.lat + 0.1 }),
    bus('A2', 'on_road', 'away', { distanceFromYardKm: 2.1, latitude: YARD.lat + 0.01 }),
    bus('O1', 'standing', 'at_other_yard', { distanceFromYardKm: 30, latitude: YARD.lat + 0.3 }),
    bus('U1', 'dark', 'unknown', { latitude: null, longitude: null }),
  ],
  YARD,
  [
    { registrationNumber: 'V1', homeDepotId: 'x', homeDepotName: 'Xton', state: 'standing' },
    { registrationNumber: 'V2', homeDepotId: 'x', homeDepotName: 'Xton', state: 'dark' },
    { registrationNumber: 'V3', homeDepotId: null, homeDepotName: null, state: 'standing' },
  ],
);

describe('buildYardModel', () => {
  it('groups buses in the yard by state in fixed order with counts', () => {
    const m = buildYardModel(SAMPLE);
    expect(m.established).toBe(true);
    expect(m.inYardGroups.map((g) => [g.state, g.buses.length])).toEqual([
      ['in_service', 1],
      ['standing', 2],
    ]);
    expect(m.counts).toEqual({ inYard: 3, visitors: 3, away: 3, unknown: 1 });
    expect(YARD_STATE_ORDER[0]).toBe('in_service');
  });

  it('words the basis from the coverage', () => {
    expect(buildYardModel(SAMPLE).basis).toBe(
      "Learned from where this depot's buses park: 38 of 44 parked buses stand together.",
    );
  });

  it('groups visitors by home depot, unknown home last', () => {
    const groups = buildYardModel(SAMPLE).visitorGroups;
    expect(groups.map((g) => [g.homeDepotName, g.buses.length])).toEqual([
      ['Xton', 2],
      ['Home depot not known', 1],
    ]);
  });

  it('orders away buses nearest first and caps the list with the true total', () => {
    const away = buildYardModel(SAMPLE).away;
    expect(away.buses.map((b) => b.registrationNumber)).toEqual(['A2', 'A1', 'O1']);
    expect(away.total).toBe(3);
    const many = response(
      Array.from({ length: AWAY_LIST_CAP + 5 }, (_, i) =>
        bus(`M${i}`, 'on_road', 'away', { distanceFromYardKm: i + 1 }),
      ),
    );
    const capped = buildYardModel(many).away;
    expect(capped.buses).toHaveLength(AWAY_LIST_CAP);
    expect(capped.total).toBe(AWAY_LIST_CAP + 5);
    expect(capped.buses[0]?.registrationNumber).toBe('M0');
  });

  it('draws buses inside the display distance and counts those beyond', () => {
    const m = buildYardModel(SAMPLE);
    const limit = YARD.radiusM * DISPLAY_RADIUS_FACTOR;
    expect(limit).toBeLessThan(0.01 * M_PER_DEG_LAT);
    expect(m.points.map((p) => p.registration).sort()).toEqual(['B1', 'B2', 'B3']);
    expect(m.beyondCount).toBe(3);
    expect(m.points.every((p) => p.relation === 'home')).toBe(true);
  });

  it('never draws a bus with a null position', () => {
    const m = buildYardModel(SAMPLE);
    expect(m.points.find((p) => p.registration === 'U1')).toBeUndefined();
    expect(m.beyondCount).toBe(3);
    expect(m.unknown.map((b) => b.registrationNumber)).toEqual(['U1']);
  });

  it('explains a yard that is not established', () => {
    const r = response(
      [
        bus('P1', 'standing', 'unknown', { speedKmph: 0 }),
        bus('P2', 'standing', 'unknown', { speedKmph: 40 }),
        bus('P3', 'dark', 'unknown', { latitude: null, longitude: null }),
      ],
      null,
    );
    const m = buildYardModel(r);
    expect(m.established).toBe(false);
    expect(m.points).toEqual([]);
    expect(m.basis).toMatch(/could not be established/i);
    expect(m.rule).toMatch(/six parked buses/);
    expect(m.parkedWithPosition).toBe(1);
    expect(m.allGroups.flatMap((g) => g.buses)).toHaveLength(3);
  });

  it('handles a depot with no buses', () => {
    const m = buildYardModel(response([], null));
    expect(m.established).toBe(false);
    expect(m.parkedWithPosition).toBe(0);
    expect(m.counts).toEqual({ inYard: 0, visitors: 0, away: 0, unknown: 0 });
  });

  it('produces no NaN and does not mutate its input', () => {
    const frozen = JSON.stringify(SAMPLE);
    const m = buildYardModel(SAMPLE);
    expect(JSON.stringify(SAMPLE)).toBe(frozen);
    expect(JSON.stringify(m)).not.toMatch(/NaN/);
    m.points.forEach((p) => {
      expect(Number.isFinite(p.distanceM)).toBe(true);
    });
  });
});
