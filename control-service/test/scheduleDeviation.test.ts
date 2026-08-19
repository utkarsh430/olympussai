// Schedule deviation: how late a bus is, and - more importantly - when the
// system must refuse to say.
//
// The refusals carry most of the weight here. `trips` and `trip_stop_times`
// are empty on this deployment, so a null deviation is what every vehicle
// reports today, and every consumer's degraded path is the deployed path. A
// bug that turned an unknown deviation into a confident zero would not fail
// loudly - it would quietly shorten holds on buses nobody had established
// were late, and let the punctuality guardrail vouch for a bound it never
// measured.
import { describe, it, expect } from 'vitest';
import {
  buildScheduleCurve,
  computeScheduleDeviationSeconds,
  scheduledEpochMsAt,
  wouldBreachLateness,
} from '../src/schedule/deviation.js';

const T0 = Date.UTC(2026, 7, 19, 6, 0, 0);
const MIN = 60_000;

/** Four stops, 1 km apart, five scheduled minutes between each. */
function curve() {
  return buildScheduleCurve('trip-1', [
    { distanceMeters: 0, epochMs: T0 },
    { distanceMeters: 1000, epochMs: T0 + 5 * MIN },
    { distanceMeters: 2000, epochMs: T0 + 10 * MIN },
    { distanceMeters: 3000, epochMs: T0 + 15 * MIN },
  ])!;
}

describe('buildScheduleCurve', () => {
  it('builds a curve from at least two usable points', () => {
    expect(curve().points).toHaveLength(4);
  });

  it('sorts by distance so a feed that publishes stops out of order still works', () => {
    const c = buildScheduleCurve('t', [
      { distanceMeters: 2000, epochMs: T0 + 10 * MIN },
      { distanceMeters: 0, epochMs: T0 },
    ]);
    expect(c!.points[0]!.distanceMeters).toBe(0);
  });

  it('returns null for fewer than two points, because one point defines no segment', () => {
    expect(buildScheduleCurve('t', [{ distanceMeters: 0, epochMs: T0 }])).toBeNull();
    expect(buildScheduleCurve('t', [])).toBeNull();
  });

  // Rejects rather than repairs. Sorting or dropping points would produce a
  // curve that disagrees with the published schedule the operator is
  // measured against, and nothing downstream would know.
  it('rejects a timetable whose times run backwards against its own stop order', () => {
    expect(
      buildScheduleCurve('t', [
        { distanceMeters: 0, epochMs: T0 + 10 * MIN },
        { distanceMeters: 1000, epochMs: T0 },
      ]),
    ).toBeNull();
  });

  it('rejects two stops surveyed at the same distance, which has no single scheduled instant', () => {
    expect(
      buildScheduleCurve('t', [
        { distanceMeters: 500, epochMs: T0 },
        { distanceMeters: 500, epochMs: T0 + 5 * MIN },
      ]),
    ).toBeNull();
  });

  it('drops non-finite points rather than propagating NaN into a control law', () => {
    expect(
      buildScheduleCurve('t', [
        { distanceMeters: 0, epochMs: T0 },
        { distanceMeters: Number.NaN, epochMs: T0 + MIN },
      ]),
    ).toBeNull();
  });
});

describe('scheduledEpochMsAt', () => {
  it('returns the stop time exactly at a stop', () => {
    expect(scheduledEpochMsAt(curve(), 2000)).toBe(T0 + 10 * MIN);
  });

  it('interpolates linearly between stops', () => {
    // Halfway along the 1 km link into stop 2 is 2.5 scheduled minutes in.
    expect(scheduledEpochMsAt(curve(), 1500)).toBe(T0 + 7.5 * MIN);
  });

  // Extending the curve past its ends would invent a lateness for a bus that
  // is laying over or has not started - the reading most likely to provoke a
  // hold on a vehicle needing none.
  it('does not extrapolate before the origin or past the final stop', () => {
    expect(scheduledEpochMsAt(curve(), -1)).toBeNull();
    expect(scheduledEpochMsAt(curve(), 3001)).toBeNull();
  });
});

describe('computeScheduleDeviationSeconds', () => {
  it('reports a bus behind its timetable as positive seconds late', () => {
    // Schedule says it should be at 2 km at T0+10min; it is there at T0+13min.
    const now = new Date(T0 + 13 * MIN);
    expect(computeScheduleDeviationSeconds(curve(), 2000, now)).toBe(180);
  });

  it('reports a bus ahead of its timetable as negative seconds', () => {
    const now = new Date(T0 + 8 * MIN);
    expect(computeScheduleDeviationSeconds(curve(), 2000, now)).toBe(-120);
  });

  it('reports exactly zero for a bus running to time', () => {
    expect(computeScheduleDeviationSeconds(curve(), 1000, new Date(T0 + 5 * MIN))).toBe(0);
  });

  // The deployed case, on every corridor, today.
  it('returns null when no schedule is loaded for the trip', () => {
    expect(computeScheduleDeviationSeconds(null, 2000, new Date(T0))).toBeNull();
  });

  it('returns null when the vehicle has no map-matched position', () => {
    expect(computeScheduleDeviationSeconds(curve(), null, new Date(T0))).toBeNull();
  });

  it('returns null rather than a number when the vehicle is off the scheduled extent', () => {
    expect(computeScheduleDeviationSeconds(curve(), 99_000, new Date(T0))).toBeNull();
  });
});

describe('wouldBreachLateness', () => {
  it('rejects a hold that would push the vehicle past the bound', () => {
    expect(wouldBreachLateness(240, 120, 300)).toBe(true);
  });

  it('permits a hold that lands exactly on the bound', () => {
    expect(wouldBreachLateness(180, 120, 300)).toBe(false);
  });

  // An early bus has slack of its own to spend, which is the whole reason
  // the schedule term prefers holding one.
  it('permits a long hold on a bus running far enough ahead to absorb it', () => {
    expect(wouldBreachLateness(-400, 300, 300)).toBe(false);
  });

  // Not a fail-open hole: there is nothing to compare, and inventing a
  // deviation to have something to reject would make the guardrail vouch for
  // a bound it never measured. `max_hold_seconds` still bounds every
  // candidate unconditionally.
  it('permits when the deviation is unknown, because an unmeasured bound cannot reject', () => {
    expect(wouldBreachLateness(null, 600, 300)).toBe(false);
  });

  it('permits when the corridor has configured no bound', () => {
    expect(wouldBreachLateness(9999, 600, null)).toBe(false);
  });
});
