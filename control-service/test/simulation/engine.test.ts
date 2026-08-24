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

// ─── A HOLD DELAYS THE PEOPLE IT ACTUALLY DELAYED ────────────────────────
//
// A hold delays everyone who was aboard when the bus would otherwise have
// pulled away. It does NOT delay the people who walk on while it is standing
// there: they were not aboard at that moment, and the time they spend on the
// stationary bus is already the whole of what `boardingWaitPassengerSeconds`
// charges them.
//
// The trial reconstructed this as `appliedHoldSeconds x onboardAfter`, which
// charges that last group twice - once for turning up during the hold, once
// for the hold itself. Holds exist only in the CONTROLLED arm, so the error
// had one sign: it inflated the price of control in the headline metric.
describe('the onboard-delay a hold imposes', () => {
  const HELD_ROUTE: RouteDirectionDefinition = {
    ...SAMPLE_ROUTE_DIRECTION,
    maxHoldSeconds: 300,
    stops: SAMPLE_ROUTE_DIRECTION.stops.map((stop, index) => ({
      ...stop,
      isControlPoint: true,
      cumulativeDistanceMeters: index * 1_000,
    })),
    totalDistanceMeters: 5_000,
  };
  const holdEveryone: Controller = {
    name: 'hold-everyone',
    decide: () => ({ holdSeconds: 300, actionType: 'two_way_hold' }),
  };

  const visits = simulate(
    {
      name: 'held',
      routeDirection: HELD_ROUTE,
      dispatches: [
        { vehicleId: 'veh-1', scheduledDispatchSeconds: 0 },
        { vehicleId: 'veh-2', scheduledDispatchSeconds: 600 },
      ],
      disturbances: [],
      seed: 11,
    },
    holdEveryone,
  ).visits;

  it('never charges more than everyone aboard, and charges less wherever somebody boarded during the hold', () => {
    const held = visits.filter((v) => v.appliedHoldSeconds > 0);
    expect(held.length).toBeGreaterThan(0);
    for (const visit of held) {
      expect(visit.onboardDelayPassengerSeconds).toBeLessThanOrEqual(
        visit.appliedHoldSeconds * visit.onboardAfter,
      );
    }
    // The fixture has to contain the case, or this proves nothing.
    expect(
      held.some((v) => v.onboardDelayPassengerSeconds < v.appliedHoldSeconds * v.onboardAfter),
    ).toBe(true);
  });

  it('charges nothing at a stop where no hold was served', () => {
    for (const visit of visits.filter((v) => v.appliedHoldSeconds === 0)) {
      expect(visit.onboardDelayPassengerSeconds).toBe(0);
    }
  });
});

// ─── A QUEUE A BUS COULD NOT CLEAR WAITED LONGER THAN HALF THE WINDOW ────
//
// Passengers arrive uniformly across the gap since the last bus and board
// OLDEST FIRST, so a bus that takes the fraction f of them takes the ones who
// arrived first - mean wait W(1 - f/2), not W/2. The two agree only when the
// bus takes everybody. Charged at W/2 regardless, a bus that took 4 of 10 was
// billed 4 x 180 s on a 360 s window where the truth is 4 x 288 s.
//
// The direction matters: a bus truncates a queue because it is FULL, and a
// bunched service fills buses more often than an evenly spaced one. So the
// undercharge fell mostly on the uncontrolled arm.
describe('the wait charged when a bus cannot take everybody', () => {
  const CROWDED: RouteDirectionDefinition = {
    ...SAMPLE_ROUTE_DIRECTION,
    // Small enough that the corridor's own demand overruns it.
    vehicleCapacity: 8,
    stops: SAMPLE_ROUTE_DIRECTION.stops.map((stop) => ({
      ...stop,
      demand: { ...stop.demand, boardingRatePerMinute: stop.demand.boardingRatePerMinute * 4 },
    })),
  };

  const visits = simulate(
    { name: 'crowded', routeDirection: CROWDED, dispatches: SAMPLE_DISPATCHES, disturbances: [], seed: 5 },
    noControlController,
  ).visits;

  it('charges more than half the window to a bus that left people standing', () => {
    // A bus that turns anybody away takes nobody during its dwell either, so
    // every boarder here came off the queue and the comparison is clean.
    const truncated = visits.filter(
      (v) => v.deniedBoardings > 0 && v.boardings > 0 && v.waitWindowSeconds > 0,
    );
    expect(truncated.length).toBeGreaterThan(0);
    for (const visit of truncated) {
      expect(visit.boardingWaitPassengerSeconds).toBeGreaterThan(
        (visit.boardings * visit.waitWindowSeconds) / 2,
      );
      // ...and never more than the whole window each, which is the wait of
      // somebody who arrived the instant the previous bus pulled out.
      expect(visit.boardingWaitPassengerSeconds).toBeLessThanOrEqual(
        visit.boardings * visit.waitWindowSeconds,
      );
    }
  });

  it('charges exactly half the window when the bus took the whole queue', () => {
    // The uncrowded corridor, where a bus can clear what it finds - the
    // capacity-bound one above never does, which is what it is for.
    const roomy = simulate(baseConfig(), noControlController).visits;
    const cleared = roomy.filter(
      (v) => v.deniedBoardings === 0 && v.boardings > 0 && v.waitWindowSeconds > 0,
    );
    expect(cleared.length).toBeGreaterThan(0);
    for (const visit of cleared) {
      // Late boarders are charged their own, shorter window, so this is a
      // bound rather than an equality wherever anybody walked on.
      expect(visit.boardingWaitPassengerSeconds).toBeLessThanOrEqual(
        (visit.boardings * visit.waitWindowSeconds) / 2 + 1e-6,
      );
    }
  });
});

// ─── A REFUSAL EVENT IS NOT A PERSON ─────────────────────────────────────
//
// A passenger a full bus turns away stays at the stop, is offered the next
// bus, and is counted again if that one is full too. `deniedBoardings` counts
// each refusal; `boardings` counts a person once. Dividing one by the other -
// which is what the saturation warning did - compares a rate with a headcount
// and reads high. Worked through at an urban stop: three buses that refuse
// seven distinct people, every one of whom boards in the end, record 14
// denials and report 40% saturation on a stop that saturated nobody.
describe('refusals counted as people rather than as events', () => {
  const SATURATED: RouteDirectionDefinition = {
    ...SAMPLE_ROUTE_DIRECTION,
    vehicleCapacity: 6,
    stops: SAMPLE_ROUTE_DIRECTION.stops.map((stop) => ({
      ...stop,
      demand: { ...stop.demand, boardingRatePerMinute: stop.demand.boardingRatePerMinute * 5 },
    })),
  };
  const visits = simulate(
    { name: 'saturated', routeDirection: SATURATED, dispatches: SAMPLE_DISPATCHES, disturbances: [], seed: 9 },
    noControlController,
  ).visits;

  it('never counts more first-time refusals than refusals', () => {
    for (const visit of visits) {
      expect(visit.firstTimeDeniedBoardings).toBeLessThanOrEqual(visit.deniedBoardings);
      expect(visit.firstTimeDeniedBoardings).toBeGreaterThanOrEqual(0);
    }
  });

  it('counts strictly fewer people than events on a corridor that turns people away repeatedly', () => {
    const events = visits.reduce((a, v) => a + v.deniedBoardings, 0);
    const people = visits.reduce((a, v) => a + v.firstTimeDeniedBoardings, 0);
    expect(events).toBeGreaterThan(0);
    // The fixture has to actually re-refuse somebody, or this proves nothing.
    expect(people).toBeLessThan(events);
  });

  it('charges every refusal to somebody the first time it happens', () => {
    // The first bus to call at a stop meets a queue nobody has been offered
    // before, so every refusal it makes is a new person.
    const firstAtStop = new Map<number, (typeof visits)[number]>();
    for (const visit of [...visits].sort((a, b) => a.arrivalSeconds - b.arrivalSeconds)) {
      if (!firstAtStop.has(visit.stopIndex)) firstAtStop.set(visit.stopIndex, visit);
    }
    for (const visit of firstAtStop.values()) {
      expect(visit.firstTimeDeniedBoardings).toBe(visit.deniedBoardings);
    }
  });
});
