// On-time performance - the operator's first priority, measured for the
// first time.
//
// The assertion that matters most is the one about UNSCHEDULED departures
// contributing nothing. Counting them as on time would make on-time
// performance RISE as timetable coverage FALLS, which is the most misleading
// direction this number can move in: it would look like the service
// improving. With `trip_stop_times` empty today, that is not a hypothetical
// - it is every departure on the network.
import { describe, it, expect } from 'vitest';
import { buildScheduleCurve } from '../src/schedule/deviation.js';
import {
  buildPunctualityObservations,
  summarisePunctuality,
} from '../src/schedule/punctuality.js';
import type { StopVisitRecord } from '../src/headway/stopHeadway.js';

const T0 = Date.UTC(2026, 7, 19, 6, 0, 0);
const MIN = 60_000;

const CURVE = buildScheduleCurve('trip-1', [
  { distanceMeters: 0, epochMs: T0 },
  { distanceMeters: 1000, epochMs: T0 + 10 * MIN },
  { distanceMeters: 2000, epochMs: T0 + 20 * MIN },
])!;

const STOP_DISTANCES = new Map([
  ['stop-A', 0],
  ['stop-B', 1000],
  ['stop-C', 2000],
]);

function visit(
  stopId: string,
  departedAtMs: number,
  vehicleId = 'bus-1',
  tripId: string | null = 'trip-1',
): StopVisitRecord {
  return {
    vehicleId,
    stopId,
    routeDirectionId: 'rd-1',
    arrivedAt: new Date(departedAtMs - 30_000).toISOString(),
    departedAt: new Date(departedAtMs).toISOString(),
    tripId,
  };
}

describe('buildPunctualityObservations', () => {
  it('measures each departure against the time the timetable gave that stop', () => {
    const visits = [visit('stop-B', T0 + 13 * MIN)];
    const observations = buildPunctualityObservations(
      visits,
      new Map([['trip-1', CURVE]]),
      STOP_DISTANCES,
    );

    expect(observations).toHaveLength(1);
    expect(observations[0]!.deviationSeconds).toBe(180);
  });

  it('reports an early departure as a negative deviation', () => {
    const visits = [visit('stop-B', T0 + 8 * MIN)];
    const observations = buildPunctualityObservations(
      visits,
      new Map([['trip-1', CURVE]]),
      STOP_DISTANCES,
    );
    expect(observations[0]!.deviationSeconds).toBe(-120);
  });

  // The deployed state on every corridor today.
  it('contributes nothing for a departure with no loaded schedule', () => {
    const visits = [visit('stop-B', T0 + 13 * MIN)];
    expect(
      buildPunctualityObservations(visits, new Map(), STOP_DISTANCES),
    ).toHaveLength(0);
  });

  it('contributes nothing when the visit cannot be tied to a trip', () => {
    const visits = [visit('stop-B', T0 + 13 * MIN, 'bus-1', null)];
    expect(
      buildPunctualityObservations(visits, new Map([['trip-1', CURVE]]), STOP_DISTANCES),
    ).toHaveLength(0);
  });

  it('contributes nothing for a stop with no surveyed distance to place on the curve', () => {
    const visits = [visit('stop-UNKNOWN', T0 + 13 * MIN)];
    expect(
      buildPunctualityObservations(visits, new Map([['trip-1', CURVE]]), STOP_DISTANCES),
    ).toHaveLength(0);
  });
});

describe('summarisePunctuality', () => {
  function observations(deviations: number[]) {
    return deviations.map((deviationSeconds, i) => ({
      stopId: 'stop-B',
      routeDirectionId: 'rd-1',
      vehicleId: `bus-${i}`,
      departedAt: new Date(T0).toISOString(),
      deviationSeconds,
    }));
  }

  it('counts a departure inside the window as on time', () => {
    const summary = summarisePunctuality(observations([0, 30, -30, 120, 280]), 'rd-1');
    expect(summary.onTimeRate).toBe(1);
    expect(summary.earlyRate).toBe(0);
    expect(summary.lateRate).toBe(0);
  });

  // Asymmetric on purpose: a late bus is still catchable, an early one has
  // left people who arrived on time standing at the stop.
  it('applies a tighter bound to running early than to running late', () => {
    const summary = summarisePunctuality(observations([-90, 240]), 'rd-1');
    expect(summary.earlyRate).toBe(0.5); // -90s breaches the 60s early bound
    expect(summary.lateRate).toBe(0); // +240s is inside the 300s late bound
  });

  // Two departures in ten ran half an hour late. The mean calls that a
  // six-minute problem; the p90 calls it a thirty-minute one, and the p90 is
  // what the passengers on those two buses experienced.
  it('reports a p90 lateness the mean flattens away', () => {
    const summary = summarisePunctuality(
      observations([0, 0, 0, 0, 0, 0, 0, 0, 1800, 1800]),
      'rd-1',
    );
    expect(summary.meanDeviationSeconds).toBe(360);
    expect(summary.p90LatenessSeconds).toBe(1800);
    expect(summary.lateRate).toBe(0.2);
  });

  // The complement, and the reason the percentile is nearest-rank rather
  // than a maximum: one bad departure in ten does not make the ninetieth
  // percentile bad, and a metric that said otherwise would be unusable for
  // spotting a genuine deterioration.
  it('does not let a single outlier drag the p90', () => {
    const summary = summarisePunctuality(
      observations([0, 0, 0, 0, 0, 0, 0, 0, 0, 1800]),
      'rd-1',
    );
    expect(summary.p90LatenessSeconds).toBe(0);
    expect(summary.lateRate).toBe(0.1);
  });

  it('honours a window tuned for a different service pattern', () => {
    const summary = summarisePunctuality(observations([-90]), 'rd-1', 120, 600);
    expect(summary.earlyRate).toBe(0);
    expect(summary.onTimeRate).toBe(1);
  });

  // A zero on-time rate and an unmeasured one look identical on a dashboard
  // and mean opposite things.
  it('reports null rather than zero when there is nothing to measure', () => {
    const summary = summarisePunctuality([], 'rd-1');
    expect(summary.sampleCount).toBe(0);
    expect(summary.onTimeRate).toBeNull();
    expect(summary.p90LatenessSeconds).toBeNull();
  });
});
