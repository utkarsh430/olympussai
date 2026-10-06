import { describe, expect, it } from 'vitest';
import { buildAllocationInput } from '@/lib/depot/routes/allocationInput';
import type { DepotPosition } from '@/lib/depot/routes/depotPositions';
import type { RouteRow } from '@/lib/depot/routes/routeTableTypes';
import type { RouteProfile, RouteStop } from '@/lib/depot/routes/types';
import { modelDepotMaster } from '@/lib/depot/sim/depotMaster';
import { modelTripsPerDay } from '@/lib/depot/sim/tripFrequency';
import { MAX_BUSES_PER_ROUTE } from '@/lib/depot/sim/tripFrequencyConfig';
import type { DepotKind, DepotSummary } from '@/lib/depot/types';

const DATE = '2026-10-06';

function depot(id: string, kind: DepotKind, fleet: number, lat: number): DepotSummary {
  return {
    id,
    name: `Depot ${id}`,
    kind,
    fleet,
    status: {} as DepotSummary['status'],
    states: {} as DepotSummary['states'],
    reporting: 0,
    positioned: 0,
    assigned: 0,
    powerCut: 0,
    tamperFlagged: 0,
    centroid: { lat, lng: 80.9 },
  };
}

function route(name: string, depotId: string, buses: number): RouteRow {
  return {
    routeName: name,
    routeId: null,
    description: null,
    serviceToken: 'ORD',
    direction: 'OUT',
    buses,
    operators: [{ depotId, depotName: `Depot ${depotId}`, buses }],
    primaryDepotId: depotId,
    states: {} as RouteRow['states'],
    delay: { medianMin: null, lateShare: null, coverage: { n: 0, of: buses } },
  };
}

const stop = (sequence: number, lat: number): RouteStop => ({
  name: `S${sequence}`,
  sequence,
  lat,
  lng: 80.9,
  scheduled: '08:00:00',
});

function profile(name: string): RouteProfile {
  const stops = [stop(1, 26.81), stop(2, 26.85)];
  return {
    routeName: name,
    routeNameConfirmed: true,
    routeId: null,
    description: null,
    direction: 'OUT',
    origin: stops[0]!,
    destination: stops[1]!,
    stops,
    unlocatedStops: 0,
    mislocatedStops: 0,
    scheduledDurationMin: 120,
    lengthKm: 4.4,
    sampledFrom: 'UP32X1',
    operatingDate: DATE,
  };
}

const A = depot('101', 'depot', 10, 26.8);
const B = depot('102', 'depot', 2, 27.8);
const U = depot('unassigned', 'unassigned', 3, 26.9);
const H = depot('201', 'hired', 4, 26.9);
const DEPOTS = [A, B, U, H];
const POSITIONS = new Map<string, DepotPosition>(
  DEPOTS.map((d) => [d.id, { position: d.centroid!, kind: 'median' as const }]),
);

function inputFor(table: readonly RouteRow[]) {
  const profiles = new Map(table.map((r) => [r.routeName, profile(r.routeName)]));
  return buildAllocationInput({
    table,
    profiles,
    depots: DEPOTS,
    positions: POSITIONS,
    operatingDate: DATE,
    detourFactor: 1.3,
  });
}

describe('buildAllocationInput', () => {
  it('gives the unassigned bucket its own reason, apart from hired units', () => {
    const input = inputFor([route('R_1_ORD_OUT', 'unassigned', 2), route('R_2_ORD_OUT', '201', 2)]);
    expect(input.excluded.map((e) => [e.routeName, e.reason])).toEqual([
      ['R_1_ORD_OUT', 'unassigned_bucket'],
      ['R_2_ORD_OUT', 'operator_not_depot'],
    ]);
  });

  it('leaves out a route whose own depot has no dead-km figure, instead of planning it uncosted', () => {
    // Depot 101 has a position the distance cannot be measured from; 102 is measurable.
    const positions = new Map<string, DepotPosition>([
      ['101', { position: { lat: Number.NaN, lng: 80.9 }, kind: 'median' }],
      ['102', { position: B.centroid!, kind: 'median' }],
    ]);
    const table = [route('R_1_ORD_OUT', '101', 2), route('R_2_ORD_OUT', '102', 2)];
    const input = buildAllocationInput({
      table,
      profiles: new Map(table.map((r) => [r.routeName, profile(r.routeName)])),
      depots: DEPOTS,
      positions,
      operatingDate: DATE,
      detourFactor: 1.3,
    });
    expect(input.excluded.map((e) => [e.routeName, e.reason])).toEqual([
      ['R_1_ORD_OUT', 'no_depot_position'],
    ]);
    expect(input.routes.map((r) => r.routeName)).toEqual(['R_2_ORD_OUT']);
    expect(input.routes[0]!.deadKmByDepot['102']).toBeTypeOf('number');
  });

  it('names the depot of each excluded route', () => {
    const input = inputFor([route('R_2_ORD_OUT', '201', 2)]);
    expect(input.excluded[0]!.depotName).toBe('Depot 201');
  });

  it('refuses a route above the bus cap, as the trip model does, with a reason', () => {
    const big = route('R_9_ORD_OUT', '101', MAX_BUSES_PER_ROUTE + 1);
    const input = inputFor([big]);
    expect(input.routes).toEqual([]);
    expect(input.excluded.map((e) => e.reason)).toEqual(['bus_count_over_cap']);
    const trips = modelTripsPerDay(
      { routeName: big.routeName, buses: big.buses, scheduledDurationMin: 120 },
      DATE,
    );
    expect(trips).toMatchObject({ tripsPerDay: 0, basis: 'bus_count_over_cap' });
  });

  it('plans a route at the cap with trips no fewer than its buses', () => {
    const input = inputFor([route('R_8_ORD_OUT', '101', MAX_BUSES_PER_ROUTE)]);
    expect(input.routes[0]!.busesNeeded).toBe(MAX_BUSES_PER_ROUTE);
    expect(input.routes[0]!.tripsPerDay).toBeGreaterThanOrEqual(MAX_BUSES_PER_ROUTE);
  });

  it('gives each depot its parking less the buses it keeps off the plan (hand-worked)', () => {
    // A: fleet 10, plans 4 buses, so keeps 6. B: fleet 2, plans 5, so keeps none.
    const input = inputFor([route('R_1_ORD_OUT', '101', 4), route('R_2_ORD_OUT', '102', 5)]);
    const parkingA = modelDepotMaster(A).parkingCapacity;
    const parkingB = modelDepotMaster(B).parkingCapacity;
    expect(input.depots).toEqual([
      { depotId: '101', capacity: parkingA - 6 },
      { depotId: '102', capacity: parkingB },
    ]);
  });
});
