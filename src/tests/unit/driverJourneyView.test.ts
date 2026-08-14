// @vitest-environment node
//
// How a prediction is allowed to READ on a driver's screen.
//
// Every test here corresponds to one of the arrival subsystem's rendering
// rules, and each exists because the wrong version of it puts a confident
// number in front of somebody driving a bus:
//
//   rule 1  never render a time unless the stop was actually predicted
//   rule 2  never render a point estimate without its band
//   rule 4  a neighbour-derived speed must read visibly weaker
//   rule 6  etaSeconds is relative to generatedAt, not to when it was received
//   rule 9  an outage is not the same as "we looked and cannot predict this"
import { describe, it, expect } from 'vitest';
import {
  arrivalReadout,
  describeSpeedBasis,
  describeStopWithdrawal,
  fixQuality,
  formatScheduledClock,
  freshnessNote,
  SAMPLE_TOO_OLD_SECONDS,
} from '@/lib/ops/driverJourneyView';
import type { StopArrival } from '@/models/control';

const GENERATED_AT = '2026-08-14T10:00:00.000Z';
const AT_GENERATION = Date.parse(GENERATED_AT);

function predicted(overrides: Record<string, unknown> = {}): StopArrival {
  return {
    stopId: 's2',
    stopName: 'ALAMBAGH',
    sequence: 2,
    isControlPoint: true,
    distanceRemainingMeters: 14_000,
    intermediateStopCount: 1,
    latitude: 26.8,
    longitude: 80.9,
    status: 'predicted',
    etaSeconds: 1320, // 22 min
    etaAt: '2026-08-14T10:22:00.000Z',
    lowerBoundSeconds: 900, // 15 min
    upperBoundSeconds: 2580, // 43 min
    confidence: 0.41,
    confidenceBand: 'usable',
    components: { travelSeconds: 1275, dwellSeconds: 45, currentStopDwellSeconds: 0, stateAgeSeconds: 86 },
    ...overrides,
  } as StopArrival;
}

describe('arrivalReadout - rule 1: a time only ever appears for a predicted stop', () => {
  it('gives a withdrawn stop no time at all, only a reason', () => {
    const readout = arrivalReadout(
      { stopId: 's', stopName: 'X', sequence: 1, isControlPoint: false, distanceRemainingMeters: 1, intermediateStopCount: 0, latitude: null, longitude: null, status: 'unavailable', reason: 'confidence_below_floor' } as StopArrival,
      GENERATED_AT,
      AT_GENERATION,
    );
    expect(readout.kind).toBe('none');
    expect(readout).not.toHaveProperty('headline');
    if (readout.kind === 'time') throw new Error('unreachable');
    expect(readout.reason).toBe('Not confident enough to give a time');
  });

  it('produces a time for a predicted stop', () => {
    const readout = arrivalReadout(predicted(), GENERATED_AT, AT_GENERATION);
    expect(readout.kind).toBe('time');
    if (readout.kind !== 'time') throw new Error('unreachable');
    expect(readout.headline).toBe('22 min');
  });
});

describe('arrivalReadout - rule 2: the band is not optional', () => {
  it('always carries the window alongside the point estimate', () => {
    const readout = arrivalReadout(predicted(), GENERATED_AT, AT_GENERATION);
    if (readout.kind !== 'time') throw new Error('unreachable');
    // The measured median band width on this data is 112% of the ETA. "22 min"
    // on its own claims a precision this model does not have.
    expect(readout.window).toBe('15-43 min');
  });

  it('has no shape in which a headline exists without a window', () => {
    // Structural, not incidental: every predicted case must populate both, so
    // a renderer cannot pick the reassuring half. Swept across a wide range of
    // bands rather than asserted once.
    for (const [lower, eta, upper] of [
      [0, 30, 120],
      [900, 1320, 2580],
      [10, 11, 12],
      [3600, 7200, 20_000],
    ]) {
      const readout = arrivalReadout(
        predicted({ lowerBoundSeconds: lower, etaSeconds: eta, upperBoundSeconds: upper }),
        GENERATED_AT,
        AT_GENERATION,
      );
      if (readout.kind !== 'time') throw new Error('unreachable');
      expect(readout.headline.length).toBeGreaterThan(0);
      expect(readout.window.length).toBeGreaterThan(0);
    }
  });
});

describe('arrivalReadout - rule 6: relative to generatedAt, not to receipt', () => {
  // Elapsed values here stay inside SAMPLE_TOO_OLD_SECONDS on purpose: the
  // view polls every 20 s, so a live screen is always a few seconds past
  // `generatedAt`, never minutes. Minutes past means polling has stopped,
  // which is the separate case the last test in this block covers.
  it('counts down as time passes since the response was computed', () => {
    const oneMinuteLater = AT_GENERATION + 60_000;
    const readout = arrivalReadout(predicted(), GENERATED_AT, oneMinuteLater);
    if (readout.kind !== 'time') throw new Error('unreachable');
    expect(readout.headline).toBe('21 min');
  });

  it('shifts the whole window, not just the middle of it', () => {
    const eightySecondsLater = AT_GENERATION + 80_000;
    const readout = arrivalReadout(predicted(), GENERATED_AT, eightySecondsLater);
    if (readout.kind !== 'time') throw new Error('unreachable');
    expect(readout.headline).toBe('20 min');
    expect(readout.window).toBe('13-41 min');
  });

  it('says "due now" rather than running a countdown into negative numbers', () => {
    // A stop 30 s out when the response was computed, read 60 s later.
    const readout = arrivalReadout(
      predicted({ etaSeconds: 30, lowerBoundSeconds: 20, upperBoundSeconds: 90 }),
      GENERATED_AT,
      AT_GENERATION + 60_000,
    );
    expect(readout.kind).toBe('due');
    if (readout.kind === 'time') throw new Error('unreachable');
    expect(readout.reason).toBe('Due now');
  });

  it('stops offering a countdown once the response itself is too old to stand behind', () => {
    // The model is not tracking the bus between polls. Past this, the number
    // is arithmetic on a position that has since moved, and the honest answer
    // is to say the reading is old rather than keep counting.
    const stalePoll = AT_GENERATION + (SAMPLE_TOO_OLD_SECONDS + 1) * 1000;
    const readout = arrivalReadout(predicted({ etaSeconds: 7200, upperBoundSeconds: 9000 }), GENERATED_AT, stalePoll);
    expect(readout.kind).toBe('none');
    if (readout.kind === 'time') throw new Error('unreachable');
    expect(readout.reason).toMatch(/out of date/i);
  });
});

describe('describeSpeedBasis - rule 4', () => {
  it('names the vehicle’s own speed as its own', () => {
    const described = describeSpeedBasis('vehicle_smoothed_speed');
    expect(described.label).toBe('From this bus’s own speed');
    expect(described.weaker).toBe(false);
  });

  it('says a neighbour-derived speed is other buses, and marks it weaker', () => {
    const described = describeSpeedBasis('route_peer_median_speed');
    // A driver reading "38 kmph" must not think that is their speedometer.
    expect(described.label).toBe('From other buses on this stretch, not this one');
    expect(described.weaker).toBe(true);
  });
});

describe('describeStopWithdrawal - every reason says something a driver can act on', () => {
  it('translates all three withdrawal reasons into plain language', () => {
    expect(describeStopWithdrawal('beyond_prediction_horizon')).toBe('Too far ahead to time yet');
    expect(describeStopWithdrawal('due_or_passed')).toBe('Due now or just passed');
    expect(describeStopWithdrawal('confidence_below_floor')).toBe('Not confident enough to give a time');
  });
});

describe('freshnessNote - rule 7', () => {
  it('describes a recent fix without alarm', () => {
    expect(freshnessNote(30).tone).toBe('default');
  });

  it('flags a fix old enough to matter', () => {
    expect(freshnessNote(300).tone).toBe('warn');
  });
});

describe('fixQuality - the map colours this bus by the same rule as every other bus', () => {
  it('maps fix age onto the renderer’s own quality tiers', () => {
    expect(fixQuality(10)).toBe('good');
    expect(fixQuality(120)).toBe('degraded');
    expect(fixQuality(400)).toBe('stale');
  });
});

describe('formatScheduledClock - rule 3: a timetable is a clock time, never a countdown', () => {
  it('renders the bare clock string the upstream actually sends', () => {
    // `scheduled_time` arrives as "10:05:00" and the normalizer passes it
    // through unchanged. Parsing this as a timestamp yields NaN - which is how
    // the timetable line came to render for no stop at all on a real page while
    // every unit test stayed green.
    expect(formatScheduledClock('10:05:00')).toBe('10:05');
    expect(formatScheduledClock('22:15')).toBe('22:15');
  });

  it('renders a published time as a clock reading', () => {
    // If this ever produced "in 18 min", the timetable would be wearing the
    // prediction's clothes and a driver could not tell them apart.
    const formatted = formatScheduledClock('2026-08-14T10:18:00.000Z');
    expect(formatted).toMatch(/^\d{2}:\d{2}$/);
    expect(formatted).not.toMatch(/min/);
  });

  it('has nothing to show when the timetable gives no time', () => {
    expect(formatScheduledClock(null)).toBeNull();
  });

  it('refuses an unparseable timestamp rather than rendering "Invalid Date"', () => {
    expect(formatScheduledClock('not-a-time')).toBeNull();
  });
});
