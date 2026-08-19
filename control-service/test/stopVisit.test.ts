// Detecting the end of a stop occupancy, and the departure-to-departure
// headway built on top of it.
//
// This pair is the only thing in the system that measures spacing WHERE
// PASSENGERS WAIT. Everything else measures a gap/speed model taken wherever
// the buses happened to be. So the assertions that matter most here are the
// ones about not recording a visit: a spurious departure produces a headway
// nobody ran, and it lands in an append-only table where it stays.
import { describe, it, expect } from 'vitest';
import { detectCompletedStopVisit } from '../src/state-estimation/stopVisit.js';
import { computeStopHeadways, dwellSeconds } from '../src/headway/stopHeadway.js';
import type { PriorVehicleState, VehicleStateEstimate } from '../src/state-estimation/types.js';

const T0 = '2026-08-19T10:00:00.000Z';
const T1 = '2026-08-19T10:00:45.000Z';

function prior(overrides: Partial<PriorVehicleState> = {}): PriorVehicleState {
  return {
    routeDirectionId: 'rd-1',
    kalmanState: null,
    confidence: 0.9,
    currentStopId: 'stop-A',
    stopEnteredAt: T0,
    ...overrides,
  };
}

function estimate(overrides: Partial<VehicleStateEstimate> = {}): VehicleStateEstimate {
  return {
    vehicleId: 'UP25FT4823',
    rawPosition: { lat: 26.8, lon: 80.9 },
    routeDirectionId: 'rd-1',
    tripId: null,
    distanceAlongRouteMeters: 1200,
    speedKmph: 22,
    headingDegrees: 90,
    stopState: 'departed_stop',
    currentStopId: 'stop-B',
    stopEnteredAt: T1,
    confidence: 0.9,
    isLowConfidence: false,
    observedAt: T1,
    kalmanState: null,
    ...overrides,
  };
}

describe('detectCompletedStopVisit', () => {
  it('records the visit when the vehicle has moved on to the next stop', () => {
    const visit = detectCompletedStopVisit(prior(), estimate());
    expect(visit).toEqual({
      vehicleId: 'UP25FT4823',
      routeDirectionId: 'rd-1',
      stopId: 'stop-A',
      tripId: null,
      arrivedAt: T0,
      departedAt: T1,
    });
  });

  it('records the visit when the vehicle has left the stop but reached no other', () => {
    const visit = detectCompletedStopVisit(prior(), estimate({ currentStopId: null }));
    expect(visit?.stopId).toBe('stop-A');
    expect(visit?.departedAt).toBe(T1);
  });

  it('carries the trip id through, so a visit can be matched to a scheduled trip later', () => {
    const visit = detectCompletedStopVisit(prior(), estimate({ tripId: 'trip-7' }));
    expect(visit?.tripId).toBe('trip-7');
  });

  // ─── THE REFUSALS ──────────────────────────────────────────────────────

  it('records nothing while the vehicle is still at the same stop', () => {
    expect(detectCompletedStopVisit(prior(), estimate({ currentStopId: 'stop-A' }))).toBeNull();
  });

  // A held bus has not departed. Recording a departure the moment a hold
  // began would make every successful hold look like a visit that ended
  // early - corrupting the measurement used to judge whether holds work.
  it('records nothing when a controller hold changes the state but not the stop', () => {
    const held = estimate({ currentStopId: 'stop-A', stopState: 'held_by_controller' });
    expect(detectCompletedStopVisit(prior(), held)).toBeNull();
  });

  it('records nothing when there was no prior state at all', () => {
    expect(detectCompletedStopVisit(null, estimate())).toBeNull();
  });

  it('records nothing when the vehicle was not at a stop to begin with', () => {
    expect(detectCompletedStopVisit(prior({ currentStopId: null }), estimate())).toBeNull();
  });

  it('records nothing without an arrival time, rather than inventing one', () => {
    expect(detectCompletedStopVisit(prior({ stopEnteredAt: null }), estimate())).toBeNull();
  });

  // "The previous bus at this stop" is only meaningful within one direction
  // of travel. A visit with no direction would pair northbound against
  // southbound and report a headway neither bus ran.
  it('discards a visit that cannot be attributed to a route-direction', () => {
    const orphan = detectCompletedStopVisit(
      prior({ routeDirectionId: null }),
      estimate({ routeDirectionId: null }),
    );
    expect(orphan).toBeNull();
  });

  it('falls back to the current estimate direction when the prior one is missing', () => {
    const visit = detectCompletedStopVisit(prior({ routeDirectionId: null }), estimate());
    expect(visit?.routeDirectionId).toBe('rd-1');
  });

  // An append-only table keeps a wrong row forever, so a fix that would
  // close a visit before it opened is dropped rather than stored.
  it('refuses an out-of-order fix that would produce a negative dwell', () => {
    const backwards = estimate({ observedAt: '2026-08-19T09:59:00.000Z' });
    expect(detectCompletedStopVisit(prior(), backwards)).toBeNull();
  });
});

describe('computeStopHeadways', () => {
  function visit(vehicleId: string, departedAt: string, stopId = 'stop-A', routeDirectionId = 'rd-1') {
    return { vehicleId, stopId, routeDirectionId, arrivedAt: departedAt, departedAt };
  }

  it('differences consecutive departures at one stop', () => {
    const result = computeStopHeadways(
      [
        visit('bus-1', '2026-08-19T10:00:00.000Z'),
        visit('bus-2', '2026-08-19T10:10:00.000Z'),
        visit('bus-3', '2026-08-19T10:30:00.000Z'),
      ],
      600,
      0.25,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.headwaySeconds).toEqual([600, 1200]);
    expect(result[0]!.meanHeadwaySeconds).toBe(900);
  });

  it('orders by departure, so visits arriving out of order still difference correctly', () => {
    const result = computeStopHeadways(
      [
        visit('bus-3', '2026-08-19T10:30:00.000Z'),
        visit('bus-1', '2026-08-19T10:00:00.000Z'),
        visit('bus-2', '2026-08-19T10:10:00.000Z'),
      ],
      600,
      0.25,
    );
    expect(result[0]!.headwaySeconds).toEqual([600, 1200]);
  });

  // A shared kerbside stop serving both directions is the normal case.
  // Pairing across them reports a headway neither bus ran.
  it('never differences a departure in one direction against one in the other', () => {
    const result = computeStopHeadways(
      [
        visit('bus-1', '2026-08-19T10:00:00.000Z', 'stop-A', 'rd-IN'),
        visit('bus-2', '2026-08-19T10:02:00.000Z', 'stop-A', 'rd-OUT'),
        visit('bus-3', '2026-08-19T10:20:00.000Z', 'stop-A', 'rd-IN'),
      ],
      600,
      0.25,
    );

    expect(result).toHaveLength(2);
    const inbound = result.find((r) => r.routeDirectionId === 'rd-IN')!;
    expect(inbound.headwaySeconds).toEqual([1200]);
    const outbound = result.find((r) => r.routeDirectionId === 'rd-OUT')!;
    expect(outbound.headwaySeconds).toEqual([]);
  });

  it('separates stops, so one busy stop does not colour another', () => {
    const result = computeStopHeadways(
      [
        visit('bus-1', '2026-08-19T10:00:00.000Z', 'stop-A'),
        visit('bus-2', '2026-08-19T10:10:00.000Z', 'stop-A'),
        visit('bus-1', '2026-08-19T10:05:00.000Z', 'stop-B'),
        visit('bus-2', '2026-08-19T10:07:00.000Z', 'stop-B'),
      ],
      600,
      0.25,
    );
    expect(result.map((r) => r.stopId)).toEqual(['stop-A', 'stop-B']);
    expect(result.find((r) => r.stopId === 'stop-B')!.headwaySeconds).toEqual([120]);
  });

  it('reports the share of gaps that count as bunched', () => {
    const result = computeStopHeadways(
      [
        visit('bus-1', '2026-08-19T10:00:00.000Z'),
        visit('bus-2', '2026-08-19T10:01:00.000Z'), // 60s - under 0.25 x 600
        visit('bus-3', '2026-08-19T10:20:00.000Z'), // 1140s - a long gap
      ],
      600,
      0.25,
    );
    expect(result[0]!.bunchedShare).toBe(0.5);
  });

  // The second-moment EWT is what makes bunching expensive: the one long gap
  // costs more than the short one saves, so EWT is positive even though the
  // MEAN headway sits exactly on target.
  it('charges a gap-then-bunch pattern even when the mean headway is on target', () => {
    const even = computeStopHeadways(
      [
        visit('bus-1', '2026-08-19T10:00:00.000Z'),
        visit('bus-2', '2026-08-19T10:10:00.000Z'),
        visit('bus-3', '2026-08-19T10:20:00.000Z'),
      ],
      600,
      0.25,
    );
    const bunched = computeStopHeadways(
      [
        visit('bus-1', '2026-08-19T10:00:00.000Z'),
        visit('bus-2', '2026-08-19T10:01:00.000Z'),
        visit('bus-3', '2026-08-19T10:20:00.000Z'),
      ],
      600,
      0.25,
    );

    // Identical mean headway, wildly different experience for a passenger.
    expect(even[0]!.meanHeadwaySeconds).toBe(600);
    expect(bunched[0]!.meanHeadwaySeconds).toBe(600);

    // Evenly spaced: the actual mean wait IS the scheduled one, so no excess.
    expect(even[0]!.ewtSeconds).toBe(0);
    // Bunched into 60s + 1140s: E[h^2]/(2E[h]) = 543s against a 300s
    // scheduled wait, so 243s of excess that a mean-headway metric reports
    // as zero. This gap between the two readings is the entire reason the
    // objective is quadratic in headway.
    expect(bunched[0]!.ewtSeconds).toBeCloseTo(243, 5);
    expect(bunched[0]!.cv).toBeCloseTo(0.9, 5);
  });

  it('reports a stop seen once with no headway rather than omitting it', () => {
    const result = computeStopHeadways([visit('bus-1', '2026-08-19T10:00:00.000Z')], 600, 0.25);
    expect(result[0]!.sampleCount).toBe(0);
    expect(result[0]!.cv).toBeNull();
    expect(result[0]!.bunchedShare).toBeNull();
  });

  // Two buses cannot depart at the same instant; identical stamps mean two
  // fixes landed in one polling tick, and a zero would drag the mean toward
  // a bunching that did not necessarily happen.
  it('drops a zero-second gap rather than recording it as perfect bunching', () => {
    const result = computeStopHeadways(
      [
        visit('bus-1', '2026-08-19T10:00:00.000Z'),
        visit('bus-2', '2026-08-19T10:00:00.000Z'),
        visit('bus-3', '2026-08-19T10:10:00.000Z'),
      ],
      600,
      0.25,
    );
    expect(result[0]!.headwaySeconds).toEqual([600]);
  });
});

describe('dwellSeconds', () => {
  it('is the time between the geofence entry and exit fixes', () => {
    expect(
      dwellSeconds({
        vehicleId: 'v',
        stopId: 's',
        routeDirectionId: 'rd-1',
        arrivedAt: '2026-08-19T10:00:00.000Z',
        departedAt: '2026-08-19T10:00:45.000Z',
      }),
    ).toBe(45);
  });

  it('reports zero rather than a negative for an unusable pair of timestamps', () => {
    expect(
      dwellSeconds({
        vehicleId: 'v',
        stopId: 's',
        routeDirectionId: 'rd-1',
        arrivedAt: '2026-08-19T10:00:45.000Z',
        departedAt: '2026-08-19T10:00:00.000Z',
      }),
    ).toBe(0);
  });
});
