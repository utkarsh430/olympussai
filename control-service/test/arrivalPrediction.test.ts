// Unit tests for the pure arrival-prediction core.
//
// The bulk of these are HONESTY tests rather than arithmetic tests: they assert
// that a bad input produces a named refusal and an empty arrivals array, not a
// plausible-looking number. Each one names the real, observed condition it
// guards against - a `latitude 0.000` fix, an `observed_at` in 2046, a Kalman
// speed of -82.7 kmph - because those are the inputs this subsystem actually
// gets, not hypotheticals.
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HORIZON_SECONDS,
  MAX_STATE_AGE_SECONDS,
  MAX_STOP_LIMIT,
  MIN_PUBLISHABLE_CONFIDENCE,
  bandFor,
  computeArrivalConfidence,
  orderDownstreamStops,
  predictArrivals,
  type PredictArrivalsInput,
} from '../src/arrival-prediction/predict.js';
import { DEFAULT_DWELL_SECONDS } from '../src/arrival-prediction/dwell.js';
import type {
  PredictionStop,
  VehicleStateForPrediction,
} from '../src/arrival-prediction/types.js';

const NOW = new Date('2026-08-14T10:00:00.000Z');
const OBSERVED_AT = '2026-08-14T09:59:30.000Z'; // 30 s old

function stops(): PredictionStop[] {
  return [
    { stopId: 's1', stopName: 'Bareilly Old Bus Station', sequence: 1, cumulativeDistanceMeters: 0, isControlPoint: true },
    { stopId: 's2', stopName: 'Faridpur', sequence: 2, cumulativeDistanceMeters: 8_000, isControlPoint: false },
    { stopId: 's3', stopName: 'Tilhar', sequence: 3, cumulativeDistanceMeters: 16_000, isControlPoint: false },
    { stopId: 's4', stopName: 'Shahjahanpur', sequence: 4, cumulativeDistanceMeters: 24_000, isControlPoint: true },
  ];
}

function state(overrides: Partial<VehicleStateForPrediction> = {}): VehicleStateForPrediction {
  return {
    vehicleId: 'UP78JT5520',
    routeDirectionId: 'rd-1',
    distanceAlongRouteMeters: 4_000,
    speedKmph: 40,
    stopState: 'departed_stop',
    currentStopId: 's1',
    stopEnteredAt: null,
    confidence: 0.8,
    isLowConfidence: false,
    observedAt: OBSERVED_AT,
    position: { lat: 28.35, lon: 79.42 },
    velocityVarianceMeters2PerSecond2: 1,
    ...overrides,
  };
}

function input(overrides: Partial<PredictArrivalsInput> = {}): PredictArrivalsInput {
  return {
    vehicleId: 'UP78JT5520',
    now: NOW,
    vehicleKnown: true,
    state: state(),
    geometry: { routeDirectionId: 'rd-1', isLoop: false, totalDistanceMeters: 24_000 },
    stops: stops(),
    peers: [],
    isHeldByController: false,
    ...overrides,
  };
}

describe('predictArrivals - the happy path is measured, not asserted', () => {
  it('predicts each downstream stop from measured distance and measured speed', () => {
    const res = predictArrivals(input());
    expect(res.prediction.status).toBe('available');
    if (res.prediction.status !== 'available') throw new Error('unreachable');

    expect(res.prediction.speed.basis).toBe('vehicle_smoothed_speed');
    expect(res.prediction.speed.speedKmph).toBe(40);
    expect(res.prediction.arrivals.map((a) => a.stopId)).toEqual(['s2', 's3', 's4']);

    const first = res.prediction.arrivals[0]!;
    if (first.status !== 'predicted') throw new Error('expected a prediction for s2');
    // 4 km remaining at 40 kmph = 360 s of travel, no intermediate stops, minus
    // the 30 s the fix has aged. Every term is checkable by hand on purpose.
    expect(first.distanceRemainingMeters).toBe(4_000);
    expect(first.components.travelSeconds).toBe(360);
    expect(first.components.dwellSeconds).toBe(0);
    expect(first.components.stateAgeSeconds).toBe(30);
    expect(first.etaSeconds).toBe(330);
    expect(first.etaAt).toBe('2026-08-14T10:05:30.000Z');
  });

  it('charges one modelled dwell per intermediate stop and reports it separately from travel', () => {
    const res = predictArrivals(input());
    if (res.prediction.status !== 'available') throw new Error('unreachable');

    const third = res.prediction.arrivals[2]!;
    if (third.status !== 'predicted') throw new Error('expected a prediction for s4');
    expect(third.intermediateStopCount).toBe(2);
    expect(third.components.dwellSeconds).toBe(2 * DEFAULT_DWELL_SECONDS);
    // 20 km at 40 kmph = 1800 s travel, + 90 s modelled dwell, - 30 s age.
    expect(third.components.travelSeconds).toBe(1_800);
    expect(third.etaSeconds).toBe(1_860);
  });

  it('names the dwell contribution as modelled, never as measured', () => {
    const res = predictArrivals(input());
    if (res.prediction.status !== 'available') throw new Error('unreachable');
    expect(res.prediction.dwell.measured).toBe(false);
    expect(res.prediction.dwell.basis).toBe('configured_default');
    expect(res.prediction.dwell.secondsPerIntermediateStop).toBe(DEFAULT_DWELL_SECONDS);
  });

  it('keeps arrival times non-decreasing down the stop list', () => {
    const res = predictArrivals(input());
    if (res.prediction.status !== 'available') throw new Error('unreachable');
    const etas = res.prediction.arrivals
      .filter((a) => a.status === 'predicted')
      .map((a) => (a.status === 'predicted' ? a.etaSeconds : 0));
    expect(etas).toEqual([...etas].sort((a, b) => a - b));
  });

  it('brackets the point estimate with its bounds, after integer rounding', () => {
    const res = predictArrivals(input());
    if (res.prediction.status !== 'available') throw new Error('unreachable');
    for (const arrival of res.prediction.arrivals) {
      if (arrival.status !== 'predicted') continue;
      expect(arrival.lowerBoundSeconds).toBeLessThanOrEqual(arrival.etaSeconds);
      expect(arrival.upperBoundSeconds).toBeGreaterThanOrEqual(arrival.etaSeconds);
      expect(arrival.lowerBoundSeconds).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('predictArrivals - refuses rather than invents', () => {
  // Every case here asserts BOTH the named reason and the empty arrivals array.
  // The empty array is the structural half of the contract: a consumer that
  // ignores `status` entirely still renders nothing.
  const cases: Array<[string, Partial<PredictArrivalsInput>, string]> = [
    ['an unregistered vehicle', { vehicleKnown: false }, 'vehicle_unknown'],
    ['a vehicle that has never been estimated', { state: null }, 'no_live_state'],
    [
      'an unreadable observation timestamp',
      { state: state({ observedAt: 'not-a-date' }) },
      'unreadable_observation_time',
    ],
    [
      'the observed 2046-dated reading',
      { state: state({ observedAt: '2046-03-27T00:00:00.000Z' }) },
      'future_dated_state',
    ],
    [
      'a fix older than the staleness bound',
      { state: state({ observedAt: new Date(NOW.getTime() - (MAX_STATE_AGE_SECONDS + 1) * 1000).toISOString() }) },
      'stale_state',
    ],
    [
      'the observed latitude 0.000 reading',
      { state: state({ position: { lat: 0, lon: 79.42 } }) },
      'implausible_position',
    ],
    ['a vehicle under a controller hold', { isHeldByController: true }, 'held_by_controller'],
    [
      'a vehicle the estimator could not map-match',
      { state: state({ routeDirectionId: null, distanceAlongRouteMeters: null, stopState: 'off_route' }) },
      'off_route',
    ],
    [
      'a match the estimator itself flags as low confidence',
      { state: state({ confidence: 0.2, isLowConfidence: true }) },
      'low_match_confidence',
    ],
    ['a route with no surveyed shape', { geometry: null }, 'no_route_geometry'],
    [
      'a vehicle past the last stop',
      { state: state({ distanceAlongRouteMeters: 24_000, currentStopId: 's4' }) },
      'no_stops_ahead',
    ],
    [
      'a stationary vehicle with no moving neighbours',
      { state: state({ speedKmph: 0, stopState: 'stopped_in_traffic', currentStopId: null }) },
      'no_speed_basis',
    ],
  ];

  for (const [label, override, reason] of cases) {
    it(`refuses ${label} with reason "${reason}" and an empty arrivals array`, () => {
      const res = predictArrivals(input(override));
      expect(res.prediction.status).toBe('unavailable');
      if (res.prediction.status !== 'unavailable') throw new Error('unreachable');
      expect(res.prediction.reason).toBe(reason);
      expect(res.prediction.arrivals).toEqual([]);
      expect(res.prediction.detail.length).toBeGreaterThan(0);
    });
  }

  it('refuses a NEGATIVE smoothed speed rather than projecting the bus backwards', () => {
    // The live table carries Kalman velocities down to -82.7 kmph. Divided into
    // a remaining distance that is a negative ETA, which arithmetic will happily
    // produce and a screen will happily render.
    const res = predictArrivals(
      input({ state: state({ speedKmph: -82.7, stopState: 'stopped_in_traffic', currentStopId: null }) }),
    );
    expect(res.prediction.status).toBe('unavailable');
    if (res.prediction.status !== 'unavailable') throw new Error('unreachable');
    expect(res.prediction.reason).toBe('no_speed_basis');
  });

  it('refuses an implausibly high smoothed speed rather than clamping it down', () => {
    // 116.3 kmph is in the live table. It is filter overshoot after a position
    // jump, i.e. evidence the filter is wrong about this bus - not evidence the
    // bus is fast. Quietly clamping it to 90 would launder that.
    const res = predictArrivals(input({ state: state({ speedKmph: 116.3 }) }));
    expect(res.prediction.status).toBe('unavailable');
    if (res.prediction.status !== 'unavailable') throw new Error('unreachable');
    expect(res.prediction.reason).toBe('no_speed_basis');
  });

  it('carries the state age on a refusal so a caller can say HOW stale', () => {
    const res = predictArrivals(
      input({ state: state({ observedAt: new Date(NOW.getTime() - 1_200_000).toISOString() }) }),
    );
    if (res.prediction.status !== 'unavailable') throw new Error('unreachable');
    expect(res.prediction.reason).toBe('stale_state');
    expect(res.prediction.stateAgeSeconds).toBe(1_200);
    expect(res.prediction.detail).toContain('20 minutes old');
  });
});

describe('predictArrivals - peer speed', () => {
  const dwelling = state({
    speedKmph: 0,
    stopState: 'dwelling_at_stop',
    currentStopId: 's1',
    distanceAlongRouteMeters: 0,
    stopEnteredAt: '2026-08-14T09:59:15.000Z', // 15 s before the fix
  });

  it('measures a speed from neighbours on the same stretch when the bus itself is stopped', () => {
    const res = predictArrivals(
      input({
        state: dwelling,
        peers: [
          { vehicleId: 'peer-a', distanceAlongRouteMeters: 2_000, speedKmph: 30 },
          { vehicleId: 'peer-b', distanceAlongRouteMeters: 5_000, speedKmph: 40 },
        ],
      }),
    );
    if (res.prediction.status !== 'available') throw new Error('unreachable');
    expect(res.prediction.speed.basis).toBe('route_peer_median_speed');
    expect(res.prediction.speed.speedKmph).toBe(35);
    expect(res.prediction.speed.sampleCount).toBe(2);
    expect(res.prediction.speed.peerWindowMeters).toBe(15_000);
  });

  it('ignores neighbours too far along the route to be on the same road', () => {
    // These corridors run to 842 km. A bus 80 km away is in different traffic,
    // and its speed is not evidence about this bus's next stop.
    const res = predictArrivals(
      input({
        state: dwelling,
        peers: [
          { vehicleId: 'peer-a', distanceAlongRouteMeters: 80_000, speedKmph: 30 },
          { vehicleId: 'peer-b', distanceAlongRouteMeters: 90_000, speedKmph: 40 },
        ],
      }),
    );
    expect(res.prediction.status).toBe('unavailable');
    if (res.prediction.status !== 'unavailable') throw new Error('unreachable');
    expect(res.prediction.reason).toBe('no_speed_basis');
  });

  it('refuses to call a single neighbour a measurement', () => {
    const res = predictArrivals(
      input({ state: dwelling, peers: [{ vehicleId: 'peer-a', distanceAlongRouteMeters: 2_000, speedKmph: 30 }] }),
    );
    expect(res.prediction.status).toBe('unavailable');
    if (res.prediction.status !== 'unavailable') throw new Error('unreachable');
    expect(res.prediction.reason).toBe('no_speed_basis');
  });

  it('trusts a neighbour-derived speed less than the vehicle’s own', () => {
    const own = predictArrivals(input());
    const peer = predictArrivals(
      input({
        state: dwelling,
        peers: [
          { vehicleId: 'peer-a', distanceAlongRouteMeters: 2_000, speedKmph: 40 },
          { vehicleId: 'peer-b', distanceAlongRouteMeters: 5_000, speedKmph: 40 },
        ],
      }),
    );
    if (own.prediction.status !== 'available' || peer.prediction.status !== 'available') {
      throw new Error('unreachable');
    }
    const ownFirst = own.prediction.arrivals[0]!;
    const peerFirst = peer.prediction.arrivals[0]!;
    if (ownFirst.status !== 'predicted' || peerFirst.status !== 'predicted') throw new Error('unreachable');
    expect(peerFirst.confidence).toBeLessThan(ownFirst.confidence);
  });

  it('widens the band when neighbours disagree with each other', () => {
    const agreeing = predictArrivals(
      input({
        state: dwelling,
        peers: [
          { vehicleId: 'a', distanceAlongRouteMeters: 1_000, speedKmph: 40 },
          { vehicleId: 'b', distanceAlongRouteMeters: 2_000, speedKmph: 40 },
          { vehicleId: 'c', distanceAlongRouteMeters: 3_000, speedKmph: 40 },
        ],
      }),
    );
    const disagreeing = predictArrivals(
      input({
        state: dwelling,
        peers: [
          { vehicleId: 'a', distanceAlongRouteMeters: 1_000, speedKmph: 10 },
          { vehicleId: 'b', distanceAlongRouteMeters: 2_000, speedKmph: 40 },
          { vehicleId: 'c', distanceAlongRouteMeters: 3_000, speedKmph: 80 },
        ],
      }),
    );
    if (agreeing.prediction.status !== 'available' || disagreeing.prediction.status !== 'available') {
      throw new Error('unreachable');
    }
    expect(disagreeing.prediction.speed.relativeSpread).toBeGreaterThan(
      agreeing.prediction.speed.relativeSpread,
    );
  });
});

describe('predictArrivals - dwell handling at the current stop', () => {
  it('charges only the dwell that is left, measured from when the bus arrived', () => {
    const res = predictArrivals(
      input({
        state: state({
          stopState: 'dwelling_at_stop',
          currentStopId: 's1',
          distanceAlongRouteMeters: 0,
          stopEnteredAt: '2026-08-14T09:59:15.000Z', // 15 s before the fix
        }),
      }),
    );
    if (res.prediction.status !== 'available') throw new Error('unreachable');
    expect(res.prediction.dwell.currentStop.basis).toBe('observed_dwell_elapsed');
    expect(res.prediction.dwell.currentStop.remainingSeconds).toBe(DEFAULT_DWELL_SECONDS - 15);
  });

  it('charges the full dwell when it cannot tell how long the bus has been there', () => {
    const res = predictArrivals(
      input({
        state: state({
          stopState: 'dwelling_at_stop',
          currentStopId: 's1',
          distanceAlongRouteMeters: 0,
          stopEnteredAt: 'not-a-date',
        }),
      }),
    );
    if (res.prediction.status !== 'available') throw new Error('unreachable');
    expect(res.prediction.dwell.currentStop.basis).toBe('dwell_elapsed_unknown');
    expect(res.prediction.dwell.currentStop.remainingSeconds).toBe(DEFAULT_DWELL_SECONDS);
  });

  it('does not offer an arrival at the stop the bus is standing at', () => {
    const res = predictArrivals(
      input({
        state: state({
          stopState: 'dwelling_at_stop',
          currentStopId: 's2',
          // Geofenced a few metres SHORT of the surveyed distance, which is what
          // makes this a real hazard: purely geometric ordering would offer the
          // stop the bus is parked at as a 5-second arrival.
          distanceAlongRouteMeters: 7_990,
          stopEnteredAt: OBSERVED_AT,
        }),
      }),
    );
    if (res.prediction.status !== 'available') throw new Error('unreachable');
    expect(res.prediction.arrivals.map((a) => a.stopId)).toEqual(['s3', 's4']);
  });

  it('DOES offer the stop it is approaching, since that is the arrival being asked about', () => {
    const res = predictArrivals(
      input({
        state: state({ stopState: 'approaching_stop', currentStopId: 's2', distanceAlongRouteMeters: 7_900 }),
      }),
    );
    if (res.prediction.status !== 'available') throw new Error('unreachable');
    expect(res.prediction.arrivals[0]!.stopId).toBe('s2');
  });
});

describe('predictArrivals - per-stop withdrawals', () => {
  it('lists a stop beyond the horizon by name, with no time on it', () => {
    // 24 km at 6 kmph is nearly four hours - well past the default hour.
    const res = predictArrivals(
      input({ state: state({ speedKmph: 6, distanceAlongRouteMeters: 0, currentStopId: null, stopState: 'departed_stop' }) }),
    );
    if (res.prediction.status !== 'available') throw new Error('unreachable');
    const last = res.prediction.arrivals.at(-1)!;
    expect(last.status).toBe('unavailable');
    if (last.status !== 'unavailable') throw new Error('unreachable');
    expect(last.reason).toBe('beyond_prediction_horizon');
    // The stop is still named and still carries its measured distance - a driver
    // sees the stop and why it has no time, rather than an unexplained gap.
    expect(last.stopName).toBe('Shahjahanpur');
    expect(last.distanceRemainingMeters).toBe(24_000);
  });

  it('withdraws a stop whose confidence falls under the floor', () => {
    const res = predictArrivals(
      input({
        // Barely-trusted match, plus a fix that has spent most of its budget.
        state: state({
          confidence: 0.41,
          observedAt: new Date(NOW.getTime() - 570_000).toISOString(),
        }),
        horizonSeconds: MAX_STOP_LIMIT * 3_600,
      }),
    );
    if (res.prediction.status !== 'available') throw new Error('unreachable');
    const withdrawn = res.prediction.arrivals.filter(
      (a) => a.status === 'unavailable' && a.reason === 'confidence_below_floor',
    );
    expect(withdrawn.length).toBeGreaterThan(0);
  });

  it('marks a stop the model says is already reached as due, not as a zero-minute arrival', () => {
    const res = predictArrivals(
      input({
        // Fix is 300 s old and the next stop was 1 km away at 40 kmph (90 s).
        state: state({
          distanceAlongRouteMeters: 7_000,
          observedAt: new Date(NOW.getTime() - 300_000).toISOString(),
        }),
      }),
    );
    if (res.prediction.status !== 'available') throw new Error('unreachable');
    const first = res.prediction.arrivals[0]!;
    expect(first.status).toBe('unavailable');
    if (first.status !== 'unavailable') throw new Error('unreachable');
    expect(first.reason).toBe('due_or_passed');
  });
});

describe('predictArrivals - request clamping', () => {
  it('clamps an absurd stop limit and horizon and reports what it actually applied', () => {
    const res = predictArrivals(input({ stopLimit: 10_000, horizonSeconds: 999_999 }));
    expect(res.stopLimit).toBe(MAX_STOP_LIMIT);
    expect(res.horizonSeconds).toBe(7_200);
  });

  it('defaults the horizon and stop limit when the caller asks for neither', () => {
    const res = predictArrivals(input());
    expect(res.horizonSeconds).toBe(DEFAULT_HORIZON_SECONDS);
    expect(res.stopLimit).toBe(8);
  });
});

describe('orderDownstreamStops', () => {
  it('wraps around the terminus on a loop route-direction', () => {
    // A 30 km lap, so the last stop at 24 km is genuinely before the wrap. (A
    // loop whose last stop sits exactly at `total` puts that stop at the same
    // physical point as the stop at 0, which is a degenerate shape rather than
    // a wrap-around case.)
    const ordered = orderDownstreamStops(
      stops(),
      20_000,
      { routeDirectionId: 'rd-1', isLoop: true, totalDistanceMeters: 30_000 },
      null,
    );
    // From 20 km: s4 at 24 km is 4 km ahead, then the lap wraps through s1
    // (10 km), s2 (18 km) and s3 (26 km).
    expect(ordered.map((s) => s.stopId)).toEqual(['s4', 's1', 's2', 's3']);
    expect(ordered.map((s) => s.forwardDistanceMeters)).toEqual([4_000, 10_000, 18_000, 26_000]);
  });

  it('drops everything behind the vehicle on a non-loop route-direction', () => {
    const ordered = orderDownstreamStops(
      stops(),
      20_000,
      { routeDirectionId: 'rd-1', isLoop: false, totalDistanceMeters: 24_000 },
      null,
    );
    expect(ordered.map((s) => s.stopId)).toEqual(['s4']);
  });

  it('breaks a distance tie by timetable sequence, not by input order', () => {
    const tied: PredictionStop[] = [
      { stopId: 'later', stopName: 'B', sequence: 9, cumulativeDistanceMeters: 5_000, isControlPoint: false },
      { stopId: 'earlier', stopName: 'A', sequence: 4, cumulativeDistanceMeters: 5_000, isControlPoint: false },
    ];
    const ordered = orderDownstreamStops(
      tied,
      0,
      { routeDirectionId: 'rd-1', isLoop: false, totalDistanceMeters: 24_000 },
      null,
    );
    expect(ordered.map((s) => s.stopId)).toEqual(['earlier', 'later']);
  });
});

describe('computeArrivalConfidence', () => {
  it('multiplies its four factors instead of averaging them', () => {
    // A perfect match, a perfectly fresh fix and the bus's own speed still do
    // not rescue an hour-out extrapolation. An average would score this ~0.84.
    const hourOut = computeArrivalConfidence({
      matchConfidence: 1,
      stateAgeSeconds: 0,
      basis: 'vehicle_smoothed_speed',
      etaSeconds: 3_600,
    });
    expect(hourOut).toBeLessThan(0.4);
    expect(hourOut).toBeCloseTo(Math.exp(-1), 3);
  });

  it('decays to nothing as the fix approaches the staleness bound', () => {
    const atBound = computeArrivalConfidence({
      matchConfidence: 1,
      stateAgeSeconds: MAX_STATE_AGE_SECONDS,
      basis: 'vehicle_smoothed_speed',
      etaSeconds: 60,
    });
    expect(atBound).toBe(0);
  });

  it('bands split at the documented thresholds', () => {
    expect(bandFor(0.6)).toBe('firm');
    expect(bandFor(0.59)).toBe('usable');
    expect(bandFor(0.35)).toBe('usable');
    expect(bandFor(0.34)).toBe('rough');
    expect(bandFor(MIN_PUBLISHABLE_CONFIDENCE)).toBe('rough');
  });
});
