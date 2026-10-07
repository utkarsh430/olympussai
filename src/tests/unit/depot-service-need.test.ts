// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hourOf, minuteOfDay, spanMinutes } from '@/lib/depot/service/feedMinutes';
import {
  busesNeededByHour,
  journeyMinutesFromLedger,
  needInputsFor,
  serviceClassOfRoute,
  TRIP_MODEL_DURATION_MIN,
  tripsNeededByHour,
} from '@/lib/depot/service/need';
import type { LedgerJourney, NeedInputs } from '@/lib/depot/service/types';
import { SEATS_BY_CLASS } from '@/lib/depot/sim/config';
import {
  BUSIEST_STRETCH_SHARE,
  LAYOVER_MIN,
  TARGET_LOAD,
} from '@/lib/depot/sim/hourlyDemandConfig';

function journey(over: Partial<LedgerJourney>): LedgerJourney {
  return {
    operatingDate: '2026-10-06',
    journeyId: 'J1',
    routeName: 'R1',
    registrationNumber: 'UP32AB1234',
    scheduledStart: '07:00',
    scheduledEnd: '08:40',
    actualStart: '07:05',
    delayMinutes: 5,
    lastSeen: '07:30',
    ...over,
  };
}

describe('feed minutes', () => {
  it('reads HH:MM, refuses malformed times and spans midnight', () => {
    expect(minuteOfDay('07:30')).toBe(450);
    expect(minuteOfDay('24:00')).toBeNull();
    expect(minuteOfDay('7:30')).toBeNull();
    expect(minuteOfDay(null)).toBeNull();
    expect(hourOf('23:59')).toBe(23);
    expect(spanMinutes('23:30', '00:45')).toBe(75);
    expect(spanMinutes('07:00', null)).toBeNull();
  });
});

const HOURS = 24;

/** 24 hourly boardings: `value` in the listed hours, none elsewhere. */
function day(value: number, hours: readonly number[]): number[] {
  return Array.from({ length: HOURS }, (_, h) => (hours.includes(h) ? value : 0));
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

function needWith(journeyMinutes: number): NeedInputs {
  return {
    routeName: 'R1',
    serviceClass: 'ordinary',
    seatsPerBus: 52,
    journeyMinutes,
    journeyMinutesProvenance: 'derived',
    layoverMinutes: 15,
    targetLoad: 0.75,
    busiestStretchShare: 0.6,
  };
}

describe('tripsNeededByHour', () => {
  it('turns each hour of boardings into trips that must start in it', () => {
    // 520 boardings x 0.6 on the busiest stretch = 312 seats wanted; a trip offers 52 x 0.75 = 39.
    const trips = tripsNeededByHour(day(520, [8]), needWith(105));
    expect(trips).toHaveLength(HOURS);
    expect(trips[8]).toBeCloseTo(8, 9);
    expect(trips[7]).toBe(0);
  });

  it('needs no trip for no demand, a corrupt figure or a missing hour', () => {
    const trips = tripsNeededByHour([0, -3, Number.NaN], needWith(105));
    expect(trips).toEqual(Array.from({ length: HOURS }, () => 0));
  });
});

describe('busesNeededByHour: the trips started within the last cycle', () => {
  it('equals trips times the cycle on a cycle of an hour or less (a 30-minute route)', () => {
    // 30 + 15 minutes: three quarters of an hour; 8 trips x 0.75 = 6 buses.
    const buses = busesNeededByHour(day(520, [8, 9]), needWith(30));
    expect(buses[8]).toBe(6);
    expect(buses[9]).toBe(6);
    expect(buses[10]).toBe(0);
    // 100 boardings: 1.54 trips x 0.75 = 1.15, rounded up.
    expect(busesNeededByHour(day(100, [8]), needWith(30))[8]).toBe(2);
  });

  it('on a steady day reaches the round-trip figure: 8 trips an hour on a 2-hour cycle is 16', () => {
    const buses = busesNeededByHour(day(520, range(5, 21)), needWith(105));
    expect(buses[5]).toBe(8);
    expect(buses[6]).toBe(16);
    expect(buses[21]).toBe(16);
    // Trips started at 21:00 are still out at 22:00; none is out by 23:00.
    expect(buses[22]).toBe(8);
    expect(buses[23]).toBe(0);
  });

  it('weights the oldest hour by the share of it inside a part-hour cycle', () => {
    // 75 + 15 minutes: an hour and a half. 4 trips start at 07:00 (260 boardings).
    const buses = busesNeededByHour(day(260, [7]), needWith(75));
    expect(buses[7]).toBe(4);
    expect(buses[8]).toBe(2);
    expect(buses[9]).toBe(0);
  });

  it('starts the day clean: nothing wraps from the evening before', () => {
    const buses = busesNeededByHour(day(520, [23]), needWith(105));
    expect(buses[0]).toBe(0);
    expect(buses[23]).toBe(8);
  });

  it('on a 493-minute route needs no more than about nine hours of trips at once', () => {
    // An intercity day: departures through 05:00-22:00, leaning to the morning.
    const need = needWith(493);
    const boardings = range(0, 23).map((h) => (h >= 5 && h <= 22 ? (h <= 9 ? 220 : 120) : 0));
    const trips = tripsNeededByHour(boardings, need);
    const buses = busesNeededByHour(boardings, need);
    const nineHours = Math.max(
      ...range(0, 15).map((h) => trips.slice(h, h + 9).reduce((s, t) => s + t, 0)),
    );
    const peak = Math.max(...buses);
    expect(peak).toBeLessThanOrEqual(Math.ceil(nineHours));
    // The old figure charged the busiest hour with the whole cycle: about 29 buses here.
    const busiest = Math.max(...trips);
    expect(Math.ceil(busiest * (508 / 60))).toBeGreaterThan(peak + 5);
  });

  it('keeps a long route within its fleet when the day balances (21 buses, 48 journeys a day)', () => {
    // 48 one-way journeys spread over 04:00-23:59, about what 21 buses on a 508-minute cycle
    // run in that span (21 x 20 h / 8.47 h = 49.6): at most the fleet is out at once.
    const need = needWith(493);
    const perTrip = (52 * 0.75) / 0.6;
    const boardings = range(0, 23).map((h) => (h >= 4 ? (48 * perTrip) / 20 : 0));
    const peak = Math.max(...busesNeededByHour(boardings, need));
    expect(peak).toBeLessThanOrEqual(21);
  });
});

describe('needInputsFor', () => {
  it('takes the journey time from the feed schedule first, as a median of the route', () => {
    const ledger = [
      journey({ journeyId: 'a', scheduledStart: '06:00', scheduledEnd: '07:30' }),
      journey({ journeyId: 'b', scheduledStart: '09:00', scheduledEnd: '10:40' }),
      journey({ journeyId: 'c', scheduledStart: '12:00', scheduledEnd: '14:00' }),
      journey({
        journeyId: 'd',
        routeName: 'OTHER',
        scheduledStart: '06:00',
        scheduledEnd: '12:00',
      }),
      journey({ journeyId: 'e', scheduledEnd: null }),
    ];
    expect(journeyMinutesFromLedger('R1', ledger)).toBe(100);
    const need = needInputsFor({ routeName: 'R1', ledger, profileDurationMin: 300 });
    expect(need.journeyMinutes).toBe(100);
    expect(need.journeyMinutesProvenance).toBe('derived');
  });

  it('falls back to the route profile, then to the trip model', () => {
    const profiled = needInputsFor({ routeName: 'R1', ledger: [], profileDurationMin: 180 });
    expect(profiled.journeyMinutes).toBe(180);
    expect(profiled.journeyMinutesProvenance).toBe('derived');
    const modelled = needInputsFor({ routeName: 'R1', ledger: [], profileDurationMin: null });
    expect(modelled.journeyMinutes).toBe(TRIP_MODEL_DURATION_MIN);
    expect(modelled.journeyMinutesProvenance).toBe('modelled');
    const corrupt = needInputsFor({ routeName: 'R1', ledger: [], profileDurationMin: -4 });
    expect(corrupt.journeyMinutesProvenance).toBe('modelled');
  });

  it('takes seats from the class and the planning constants', () => {
    const need = needInputsFor({ routeName: 'LKO_DEL_AC', ledger: [], profileDurationMin: null });
    expect(need.serviceClass).toBe('ac');
    expect(need.seatsPerBus).toBe(SEATS_BY_CLASS.ac);
    expect(need.layoverMinutes).toBe(LAYOVER_MIN);
    expect(need.targetLoad).toBe(TARGET_LOAD);
    expect(need.busiestStretchShare).toBe(BUSIEST_STRETCH_SHARE);
  });

  it('reads an unnamed class as ordinary, as the modelled day does', () => {
    expect(serviceClassOfRoute('R1')).toBe('ordinary');
  });

  it('the trip model duration is the one its unknown-duration factor implies', () => {
    expect(TRIP_MODEL_DURATION_MIN).toBe(285);
  });
});
