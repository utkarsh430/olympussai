// @vitest-environment node
//
// Joining a per-stop PREDICTION to a published TIMETABLE without letting
// either become the other.
//
// This is the module the product's central honesty claim runs through on the
// driver's screen. The prediction comes from control-service and is measured;
// the timetable comes from the UPSRTC upstream and is published. They are
// different kinds of claim about the same stop, and the whole point of this
// join is that they arrive at the renderer as two separate fields that no
// amount of downstream carelessness can merge - see
// docs/olympuss/DRIVER_SURFACE.md and rule 3 in the arrival subsystem's own
// rendering rules.
import { describe, it, expect } from 'vitest';
import { joinScheduleToArrivals } from '@/lib/ops/driverJourney';
import { normalizeSchedulePayload } from '@/lib/upsrtc/normalizer';
import type { StopArrival } from '@/models/control';
import type { CanonicalStop } from '@/models/canonical';

function predicted(overrides: Partial<StopArrival> = {}): StopArrival {
  return {
    stopId: '12921',
    stopName: 'BANKEPUR',
    sequence: 2,
    isControlPoint: false,
    distanceRemainingMeters: 4000,
    intermediateStopCount: 0,
    latitude: 26.25366,
    longitude: 82.00331,
    status: 'predicted',
    etaSeconds: 330,
    etaAt: '2026-08-14T10:05:30.000Z',
    lowerBoundSeconds: 264,
    upperBoundSeconds: 450,
    confidence: 0.68,
    confidenceBand: 'firm',
    components: { travelSeconds: 330, dwellSeconds: 0, currentStopDwellSeconds: 0, stateAgeSeconds: 30 },
    ...overrides,
  } as StopArrival;
}

function scheduleStop(overrides: Partial<CanonicalStop> = {}): CanonicalStop {
  return {
    id: '12921',
    name: 'BANKEPUR',
    sequence: 2,
    latitude: 26.25366,
    longitude: 82.00331,
    scheduledArrival: '2026-08-14T10:04:00.000Z',
    scheduledDeparture: '2026-08-14T10:06:00.000Z',
    ...overrides,
  };
}

describe('joinScheduleToArrivals', () => {
  it('keeps every arrival, in the order the prediction gave them', () => {
    const arrivals = [
      predicted({ stopId: 'a', sequence: 1 }),
      predicted({ stopId: 'b', sequence: 2 }),
      predicted({ stopId: 'c', sequence: 3 }),
    ];
    const joined = joinScheduleToArrivals(arrivals, [scheduleStop({ id: 'c' })]);
    expect(joined.map((s) => s.stopId)).toEqual(['a', 'b', 'c']);
  });

  it('passes the prediction through byte-for-byte, so nothing can be rewritten on the way', () => {
    const arrival = predicted();
    const [joined] = joinScheduleToArrivals([arrival], [scheduleStop()]);
    expect(joined!.arrival).toEqual(arrival);
  });

  it('attaches the published times as a SEPARATE field, never into the prediction', () => {
    const [joined] = joinScheduleToArrivals([predicted()], [scheduleStop()]);
    expect(joined!.scheduled).toEqual({
      arrival: '2026-08-14T10:04:00.000Z',
      departure: '2026-08-14T10:06:00.000Z',
    });
    // The prediction half is untouched: its own eta is still its own eta.
    expect(joined!.arrival.status).toBe('predicted');
    if (joined!.arrival.status !== 'predicted') throw new Error('unreachable');
    expect(joined!.arrival.etaSeconds).toBe(330);
  });

  it('leaves a stop the timetable does not list with no scheduled time, rather than borrowing a neighbour’s', () => {
    const [joined] = joinScheduleToArrivals([predicted({ stopId: 'unlisted' })], [scheduleStop({ id: '12921' })]);
    expect(joined!.scheduled).toBeNull();
  });

  it('still attaches the timetable to a stop the model could not put a time on', () => {
    // Rule 8: an unavailable stop is still a stop. If the timetable knows when
    // it is meant to be served, that is the only thing the driver has - and
    // withholding it because the prediction failed would be withholding the
    // one honest fact available.
    const withdrawn = predicted({ status: 'unavailable', reason: 'beyond_prediction_horizon' } as Partial<StopArrival>);
    const [joined] = joinScheduleToArrivals([withdrawn], [scheduleStop()]);
    expect(joined!.arrival.status).toBe('unavailable');
    expect(joined!.scheduled?.arrival).toBe('2026-08-14T10:04:00.000Z');
  });

  it('matches a stop the upstream sequence-suffixed as a repeat visit', () => {
    // The `#n` half of the id decoration in isolation. The normalizer appends
    // it to break a collision that survives `${atco_code}-${sequence}`;
    // control-service keys `stops.id` on the bare atco_code and never suffixes
    // it. Without stripping it, the second half of every loop working would
    // show no timetable. The block at the end of this file covers the full
    // real id format against the normalizer itself.
    const [joined] = joinScheduleToArrivals(
      [predicted({ stopId: '12921', sequence: 9 })],
      [scheduleStop({ id: '12921#2', sequence: 9 })],
    );
    expect(joined!.scheduled?.arrival).toBe('2026-08-14T10:04:00.000Z');
  });

  it('prefers the timetable row whose sequence matches, when a loop lists the same stop twice', () => {
    const [joined] = joinScheduleToArrivals(
      [predicted({ stopId: '12921', sequence: 14 })],
      [
        scheduleStop({ id: '12921', sequence: 2, scheduledArrival: '2026-08-14T08:00:00.000Z' }),
        scheduleStop({ id: '12921#2', sequence: 14, scheduledArrival: '2026-08-14T12:00:00.000Z' }),
      ],
    );
    expect(joined!.scheduled?.arrival).toBe('2026-08-14T12:00:00.000Z');
  });

  it('refuses to guess when a repeated stop cannot be told apart by sequence', () => {
    // Two candidate timetable rows, neither matching this stop's sequence.
    // Picking either would put a specific, wrong, confident-looking clock time
    // beside a prediction. Showing nothing is the honest answer.
    const [joined] = joinScheduleToArrivals(
      [predicted({ stopId: '12921', sequence: 99 })],
      [
        scheduleStop({ id: '12921', sequence: 2, scheduledArrival: '2026-08-14T08:00:00.000Z' }),
        scheduleStop({ id: '12921#2', sequence: 14, scheduledArrival: '2026-08-14T12:00:00.000Z' }),
      ],
    );
    expect(joined!.scheduled).toBeNull();
  });

  it('reports a timetable row with no arrival time as having none, not as an empty string', () => {
    const [joined] = joinScheduleToArrivals(
      [predicted()],
      [scheduleStop({ scheduledArrival: null, scheduledDeparture: null })],
    );
    expect(joined!.scheduled).toEqual({ arrival: null, departure: null });
  });

  it('produces the same stops when there is no timetable at all', () => {
    const arrivals = [predicted({ stopId: 'a' }), predicted({ stopId: 'b' })];
    const joined = joinScheduleToArrivals(arrivals, []);
    expect(joined.map((s) => s.stopId)).toEqual(['a', 'b']);
    expect(joined.every((s) => s.scheduled === null)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// THE JOIN KEY, AGAINST THE REAL NORMALIZER
//
// These do not hand-write a `CanonicalStop.id`. They run a raw upstream
// payload through `normalizeSchedulePayload` - the same function the journey
// route's timetable half goes through - and join the result against
// control-service-shaped stop ids (the bare atco_code).
//
// This block exists because the hand-written fixtures above were WRONG and
// still passed. They assumed `CanonicalStop.id` was the bare atco_code; it is
// actually `${atco_code}-${stop_sequence}`. Every stop silently failed to
// match, the timetable never rendered, and the suite stayed green. Deriving
// the fixture from the producer is what makes that failure impossible to
// repeat.
// ─────────────────────────────────────────────────────────────────────────
function upstreamRow(atco: string, sequence: number, name: string, time: string) {
  return {
    atco_code: atco,
    stop_sequence: sequence,
    stop_name: name,
    scheduled_time: time,
    Latitude: 26.8,
    Longitude: 80.9,
    vj_id: 90001,
    RouteName: 'LKO_BBK_ORD_OUT',
  };
}

describe('joinScheduleToArrivals - against ids the real normalizer produces', () => {
  it('matches a control-service stop id to the normalizer’s decorated id', () => {
    const schedule = normalizeSchedulePayload(
      [
        upstreamRow('12921', 1, 'ALAMBAGH', '09:40:00'),
        upstreamRow('17151', 2, 'CHARBAGH', '09:52:00'),
      ],
      'UP32AN1234',
      '2026-08-14',
      null,
    );
    expect(schedule).not.toBeNull();

    // The thing the first version of this join got wrong: these are NOT the
    // bare atco codes.
    expect(schedule!.stops.map((s) => s.id)).toEqual(['12921-1', '17151-2']);

    const joined = joinScheduleToArrivals(
      [predicted({ stopId: '17151', sequence: 2, stopName: 'CHARBAGH' })],
      schedule!.stops,
    );
    expect(joined[0]!.scheduled?.arrival).toBe('09:52:00');
  });

  it('matches every stop of a whole normalized working, not just the first', () => {
    const schedule = normalizeSchedulePayload(
      [
        upstreamRow('12921', 1, 'ALAMBAGH', '09:40:00'),
        upstreamRow('17151', 2, 'CHARBAGH', '09:52:00'),
        upstreamRow('12027', 3, 'KAISERBAGH', '10:05:00'),
      ],
      'UP32AN1234',
      '2026-08-14',
      null,
    );
    const joined = joinScheduleToArrivals(
      [
        predicted({ stopId: '17151', sequence: 2 }),
        predicted({ stopId: '12027', sequence: 3 }),
      ],
      schedule!.stops,
    );
    expect(joined.map((s) => s.scheduled?.arrival)).toEqual(['09:52:00', '10:05:00']);
  });

  it('keeps a stop code that itself contains a dash', () => {
    // The seeded demo corridor uses ids like `demo-kaiserbagh`; stripping more
    // than the trailing sequence group would destroy them.
    const schedule = normalizeSchedulePayload(
      [upstreamRow('demo-kaiserbagh', 3, 'KAISERBAGH', '10:05:00')],
      'UP32AN1234',
      '2026-08-14',
      null,
    );
    expect(schedule!.stops[0]!.id).toBe('demo-kaiserbagh-3');
    const joined = joinScheduleToArrivals(
      [predicted({ stopId: 'demo-kaiserbagh', sequence: 3 })],
      schedule!.stops,
    );
    expect(joined[0]!.scheduled?.arrival).toBe('10:05:00');
  });

  it('separates two visits to the same stop on a loop by sequence', () => {
    const schedule = normalizeSchedulePayload(
      [
        upstreamRow('12921', 2, 'ALAMBAGH', '09:40:00'),
        upstreamRow('12921', 14, 'ALAMBAGH', '12:10:00'),
      ],
      'UP32AN1234',
      '2026-08-14',
      null,
    );
    const joined = joinScheduleToArrivals([predicted({ stopId: '12921', sequence: 14 })], schedule!.stops);
    expect(joined[0]!.scheduled?.arrival).toBe('12:10:00');
  });
});
