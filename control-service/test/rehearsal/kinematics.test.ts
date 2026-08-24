// Where a simulated vehicle is at an arbitrary instant.
//
// This is the piece that lets a controller be handed a synchronized
// snapshot of two vehicles, which is what the deployed headway computation
// consumes. Its edges matter more than its middle: every "null" below is a
// case where reporting a position would put a bus somewhere it is not.
import { describe, it, expect } from 'vitest';
import { corridorStateAt } from '../../src/simulation/kinematics.js';
import type { StopVisitRecord } from '../../src/simulation/types.js';

function visit(overrides: Partial<StopVisitRecord> & Pick<StopVisitRecord, 'stopIndex' | 'arrivalSeconds' | 'departureSeconds'>): StopVisitRecord {
  return {
    vehicleId: 'SIM-01',
    stopId: `stop-${overrides.stopIndex}`,
    waitWindowSeconds: 0,
    boardings: 0,
    boardingLimitedPassengers: 0,
    boardingWaitPassengerSeconds: 0,
    onboardDelayPassengerSeconds: 0,
    dwellPassengerSeconds: 0,
    alightings: 0,
    deniedBoardings: 0,
    firstTimeDeniedBoardings: 0,
    onboardAfter: 0,
    dwellSeconds: 0,
    intendedHoldSeconds: 0,
    appliedHoldSeconds: 0,
    compliant: true,
    leaderHeadwaySeconds: null,
    isStateStale: false,
    ...overrides,
  };
}

// Terminal at 0 m; stops at 1 km, 3 km, 6 km.
const CUMULATIVE = [1000, 3000, 6000];
const DISPATCH_SECONDS = 100;
const TIMELINE: StopVisitRecord[] = [
  visit({ stopIndex: 0, arrivalSeconds: 200, departureSeconds: 230 }), // 1 km in 100 s
  visit({ stopIndex: 1, arrivalSeconds: 430, departureSeconds: 460 }), // +2 km in 200 s
  visit({ stopIndex: 2, arrivalSeconds: 760, departureSeconds: 800 }), // +3 km in 300 s
];

describe('corridorStateAt', () => {
  it('reports no position before the vehicle has been dispatched', () => {
    expect(corridorStateAt(TIMELINE, DISPATCH_SECONDS, CUMULATIVE, 50)).toBeNull();
  });

  it('interpolates the terminal-to-first-stop leg at its average pace', () => {
    // Halfway through a 100 s leg covering 1 km: 500 m at 36 km/h.
    const state = corridorStateAt(TIMELINE, DISPATCH_SECONDS, CUMULATIVE, 150);
    expect(state!.distanceAlongRouteMeters).toBeCloseTo(500, 5);
    expect(state!.speedKmph).toBeCloseTo(36, 5);
  });

  // Zero, not null. A bus standing at a stop IS closing on nothing, and the
  // deployed metrics floor it to a minimum speed and report a large finite
  // headway - the correct reading. Null would mean "pace unknown" and would
  // suppress the pair entirely.
  it('reports a stationary vehicle at a stop as speed zero, not as unknown', () => {
    const state = corridorStateAt(TIMELINE, DISPATCH_SECONDS, CUMULATIVE, 215);
    expect(state).toEqual({ distanceAlongRouteMeters: 1000, speedKmph: 0 });
  });

  it('interpolates a mid-route leg from departure to next arrival', () => {
    // Leg 2: departs 1 km at t=230, arrives 3 km at t=430. At t=330 it is
    // halfway: 2 km, at 36 km/h.
    const state = corridorStateAt(TIMELINE, DISPATCH_SECONDS, CUMULATIVE, 330);
    expect(state!.distanceAlongRouteMeters).toBeCloseTo(2000, 5);
    expect(state!.speedKmph).toBeCloseTo(36, 5);
  });

  it('reports no position once the trip is over, so a finished bus is never followed', () => {
    expect(corridorStateAt(TIMELINE, DISPATCH_SECONDS, CUMULATIVE, 801)).toBeNull();
  });

  it('reports no position for a vehicle with no visits at all', () => {
    expect(corridorStateAt([], DISPATCH_SECONDS, CUMULATIVE, 300)).toBeNull();
  });

  // An unbounded speed would sail through the deployed MIN_SPEED_KMPH floor
  // and produce a headway of about zero, which reads as the most severe
  // bunching this system can report - from a division by zero.
  it('reports an unknown pace rather than an infinite one on a zero-duration leg', () => {
    const instant: StopVisitRecord[] = [visit({ stopIndex: 0, arrivalSeconds: 100, departureSeconds: 100 })];
    const state = corridorStateAt(instant, 100, CUMULATIVE, 100);
    expect(state!.speedKmph).toBe(0);

    const zeroLeg = corridorStateAt(
      [visit({ stopIndex: 0, arrivalSeconds: 100, departureSeconds: 120 })],
      100,
      CUMULATIVE,
      100,
    );
    expect(zeroLeg!.speedKmph).toBe(0);
  });

  it('reports no position when the corridor has no distance for a visited stop', () => {
    expect(corridorStateAt(TIMELINE, DISPATCH_SECONDS, [1000], 500)).toBeNull();
  });
});
