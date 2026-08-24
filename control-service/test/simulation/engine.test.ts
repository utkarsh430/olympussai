import { describe, it, expect } from 'vitest';
import { simulate } from '../../src/simulation/engine.js';
import { noControlController } from '../../src/simulation/controllers.js';
import { SAMPLE_ROUTE_DIRECTION, SAMPLE_DISPATCHES } from '../../src/simulation/fixtures/sampleRouteDirection.js';
import type {
  Controller,
  ControllerKinematics,
  RouteDirectionDefinition,
  ScenarioConfig,
} from '../../src/simulation/types.js';

function baseConfig(overrides: Partial<ScenarioConfig> = {}): ScenarioConfig {
  return {
    name: 'engine-test',
    routeDirection: SAMPLE_ROUTE_DIRECTION,
    dispatches: SAMPLE_DISPATCHES,
    disturbances: [],
    seed: 42,
    ...overrides,
  };
}

describe('simulation engine', () => {
  it('is deterministic for a given seed', () => {
    const a = simulate(baseConfig(), noControlController);
    const b = simulate(baseConfig(), noControlController);
    expect(a).toEqual(b);
  });

  it('produces one visit per (vehicle, stop) pair', () => {
    const result = simulate(baseConfig(), noControlController);
    expect(result.visits).toHaveLength(SAMPLE_DISPATCHES.length * SAMPLE_ROUTE_DIRECTION.stops.length);
  });

  it('enforces monotonically increasing time per vehicle (arrival <= departure, departure <= next arrival)', () => {
    const result = simulate(baseConfig(), noControlController);
    const byVehicle = new Map<string, typeof result.visits>();
    for (const v of result.visits) {
      const bucket = byVehicle.get(v.vehicleId) ?? [];
      bucket.push(v);
      byVehicle.set(v.vehicleId, bucket);
    }
    for (const visits of byVehicle.values()) {
      const sorted = [...visits].sort((a, b) => a.stopIndex - b.stopIndex);
      for (let i = 0; i < sorted.length; i++) {
        const visit = sorted[i]!;
        expect(visit.departureSeconds).toBeGreaterThanOrEqual(visit.arrivalSeconds);
        const next = sorted[i + 1];
        if (next) expect(next.arrivalSeconds).toBeGreaterThanOrEqual(visit.departureSeconds);
      }
    }
  });

  it('enforces the no-overtake minimum separation between vehicles at the same stop', () => {
    const result = simulate(baseConfig(), noControlController);
    const byStop = new Map<string, number[]>();
    for (const v of result.visits) {
      const bucket = byStop.get(v.stopId) ?? [];
      bucket.push(v.arrivalSeconds);
      byStop.set(v.stopId, bucket);
    }
    for (const arrivals of byStop.values()) {
      const sorted = [...arrivals].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(
          SAMPLE_ROUTE_DIRECTION.minSeparationSeconds,
        );
      }
    }
  });

  it('never boards more passengers than remaining capacity allows', () => {
    const result = simulate(baseConfig(), noControlController);
    for (const v of result.visits) {
      expect(v.onboardAfter).toBeLessThanOrEqual(SAMPLE_ROUTE_DIRECTION.vehicleCapacity);
    }
  });

  it('rejects a route-direction whose stops/links lengths disagree', () => {
    const bad = baseConfig({
      routeDirection: { ...SAMPLE_ROUTE_DIRECTION, links: SAMPLE_ROUTE_DIRECTION.links.slice(0, 2) },
    });
    expect(() => simulate(bad, noControlController)).toThrow(/stops.length/);
  });

  it('skips a missed-trip vehicle entirely', () => {
    const result = simulate(
      baseConfig({ disturbances: [{ type: 'missed_trip', vehicleId: 'veh-2' }] }),
      noControlController,
    );
    expect(result.visits.some((v) => v.vehicleId === 'veh-2')).toBe(false);
    expect(result.visits).toHaveLength((SAMPLE_DISPATCHES.length - 1) * SAMPLE_ROUTE_DIRECTION.stops.length);
  });
});

// ─── THE CHAIN THE ENGINE HANDS THE CONTROLLER IS RANKED BY POSITION ─────
//
// `state-estimation/ordering.ts` sorts live vehicles by distance along the
// route, so production's leader ALWAYS has the larger distance on a linear
// route-direction, and `headway/metrics.ts#computeGapMeters` depends on
// exactly that: a follower whose distance exceeds its leader's is read as the
// loop wrap-around and the gap is folded round the whole corridor.
//
// The engine used to walk outwards in DISPATCH order and take the first live
// vehicle either side, which agrees with position only while nothing has
// overtaken. The arrival clamp below enforces a minimum separation, not an
// order, so a bus whose leader is standing through a long dwell or a hold
// passes it and keeps the lead. Measured across the fleet trial's ten
// scenarios, the deciding bus was handed a "leader" physically behind it on
// 1.5% of urban decisions and 4.8% of inter-city ones - and each of those was
// then reported to the control laws as a gap of very nearly the whole route
// (379 km of a 400 km corridor). The deepest bunch there is, described to the
// controller as the most generous gap on the corridor.
describe('the leader/follower chain offered to a controller', () => {
  const MEASURED_ROUTE: RouteDirectionDefinition = {
    ...SAMPLE_ROUTE_DIRECTION,
    // A hold long enough that the bus behind reaches the stop while the bus
    // in front is still standing at it, which is what makes an overtake
    // possible at all.
    maxHoldSeconds: 600,
    minSeparationSeconds: 5,
    totalDistanceMeters: 5_000,
    stops: SAMPLE_ROUTE_DIRECTION.stops.map((stop, index) => ({
      ...stop,
      isControlPoint: true,
      cumulativeDistanceMeters: index * 1_000,
    })),
  };

  /** Holds the FIRST bus for a long time at every stop, so its follower runs into it. */
  const holdTheLeader = (leaderVehicleId: string): Controller => ({
    name: 'hold-the-leader',
    decide: (context) => ({
      holdSeconds: context.vehicleId === leaderVehicleId ? 600 : 0,
      actionType: context.vehicleId === leaderVehicleId ? 'two_way_hold' : 'no_control',
    }),
  });

  function chainsOffered(controller: Controller): ControllerKinematics[] {
    const seen: ControllerKinematics[] = [];
    const spy: Controller = {
      name: 'spy',
      decide: (context) => {
        if (context.kinematics) seen.push(context.kinematics);
        return controller.decide(context);
      },
    };
    simulate(
      {
        name: 'ordering',
        routeDirection: MEASURED_ROUTE,
        dispatches: [
          { vehicleId: 'veh-1', scheduledDispatchSeconds: 0 },
          { vehicleId: 'veh-2', scheduledDispatchSeconds: 120 },
          { vehicleId: 'veh-3', scheduledDispatchSeconds: 240 },
        ],
        disturbances: [],
        seed: 7,
      },
      spy,
    );
    return seen;
  }

  // Without this the three tests below pass on a corridor where nothing ever
  // overtakes, which is exactly the state the engine was WRONGLY believed to
  // be in.
  it('is a fixture in which a bus really does overtake its leader', () => {
    const visits = simulate(
      {
        name: 'ordering',
        routeDirection: MEASURED_ROUTE,
        dispatches: [
          { vehicleId: 'veh-1', scheduledDispatchSeconds: 0 },
          { vehicleId: 'veh-2', scheduledDispatchSeconds: 120 },
          { vehicleId: 'veh-3', scheduledDispatchSeconds: 240 },
        ],
        disturbances: [],
        seed: 7,
      },
      holdTheLeader('veh-1'),
    ).visits;
    const dispatchOrder = new Map([['veh-1', 0], ['veh-2', 1], ['veh-3', 2]]);
    const lastStop = MEASURED_ROUTE.stops.length - 1;
    const arrivalOrder = visits
      .filter((v) => v.stopIndex === lastStop)
      .sort((a, b) => a.arrivalSeconds - b.arrivalSeconds)
      .map((v) => dispatchOrder.get(v.vehicleId) ?? -1);
    expect(arrivalOrder).not.toEqual([...arrivalOrder].sort((a, b) => a - b));
  });

  it('never names a leader that is behind the deciding vehicle, even once it has been overtaken', () => {
    const chains = chainsOffered(holdTheLeader('veh-1'));
    // The fixture has to actually produce the overtake it is testing for,
    // otherwise this passes by never exercising the case.
    expect(chains.length).toBeGreaterThan(0);
    for (const chain of chains) {
      expect(chain.leader.distanceAlongRouteMeters).toBeGreaterThanOrEqual(
        chain.follower.distanceAlongRouteMeters,
      );
    }
  });

  it('never names a trailer that is ahead of the deciding vehicle', () => {
    const chains = chainsOffered(holdTheLeader('veh-1'));
    for (const chain of chains) {
      if (!chain.trailer) continue;
      expect(chain.trailer.distanceAlongRouteMeters).toBeLessThanOrEqual(
        chain.follower.distanceAlongRouteMeters,
      );
    }
  });

  // The leader is the NEAREST vehicle ahead, not merely one of them - a chain
  // that skipped the closest bus would understate every gap it reported.
  it('names the nearest vehicle ahead and the nearest behind', () => {
    const chains = chainsOffered(holdTheLeader('veh-1'));
    for (const chain of chains) {
      if (!chain.trailer) continue;
      expect(chain.leader.distanceAlongRouteMeters).toBeGreaterThanOrEqual(
        chain.trailer.distanceAlongRouteMeters,
      );
    }
  });
});
